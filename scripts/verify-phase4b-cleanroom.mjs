import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const [kitArg, submissionArg, receiptArg] = process.argv.slice(2);
if (kitArg === undefined || submissionArg === undefined || receiptArg === undefined) {
  throw new Error("usage: verify-phase4b-cleanroom <kit> <submission-capsule> <receipt>");
}

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const artifactRef = (kind) => z.string().regex(new RegExp(`^\\.eval/${kind}/[0-9a-f]{64}\\.json$`));
const receiptSchema = z
  .strictObject({
    schema_version: z.literal(1),
    kit_id: z.literal("phase4b-contributor-v1"),
    participant_id: z.string().min(1),
    observer_id: z.string().min(1),
    participant_prior_experience: z.literal("none"),
    oral_help_received: z.literal(false),
    repository_source_read: z.literal(false),
    compare_completed: z.literal(true),
    started_at: z.iso.datetime(),
    completed_at: z.iso.datetime(),
    lab_package_sha256: digestSchema,
    capsule_release_sha256: digestSchema,
    calibration_ref: artifactRef("calibrations"),
    run_ref: artifactRef("runs"),
    observer_attestation: z.literal("observed_no_oral_help"),
    notes: z.string(),
  })
  .superRefine((value, context) => {
    if (value.participant_id === value.observer_id) {
      context.addIssue({
        code: "custom",
        path: ["observer_id"],
        message: "participant and observer must be independent people",
      });
    }
    if (Date.parse(value.completed_at) <= Date.parse(value.started_at)) {
      context.addIssue({
        code: "custom",
        path: ["completed_at"],
        message: "completion must occur after start",
      });
    }
  });

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function collect(root, prefix, skipEval = false) {
  const entries = [];
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (skipEval && item.name === ".eval") continue;
      const path = resolve(directory, item.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error("clean-room evidence cannot contain symlinks");
      if (item.isDirectory()) {
        await walk(path);
      } else if (item.isFile() && stat.nlink === 1) {
        const bytes = await readFile(path);
        entries.push({
          path: `${prefix}/${relative(root, path).split("\\").join("/")}`,
          sha256: sha256(bytes),
          size: bytes.byteLength,
        });
      } else {
        throw new Error("clean-room evidence contains an unsupported entry");
      }
    }
  }
  await walk(root);
  return entries;
}

const receipt = receiptSchema.parse(JSON.parse(await readFile(resolve(receiptArg), "utf8")));
const kitRoot = resolve(kitArg);
const manifest = JSON.parse(await readFile(resolve(kitRoot, "kit-manifest.json"), "utf8"));
if (manifest.kit_id !== receipt.kit_id) throw new Error("receipt binds another clean-room kit");
if (manifest.lab_package_sha256 !== receipt.lab_package_sha256) {
  throw new Error("receipt Lab package digest does not match the kit");
}
const actualEntries = [
  ...(await collect(resolve(kitRoot, "inputs"), "inputs")),
  ...(await collect(resolve(kitRoot, "package"), "package")),
].sort((left, right) => left.path.localeCompare(right.path));
if (JSON.stringify(actualEntries) !== JSON.stringify(manifest.entries)) {
  throw new Error("clean-room kit bytes drifted");
}

const repositoryRoot = new URL("..", import.meta.url);
const capsuleApi = await import(
  pathToFileURL(resolve(repositoryRoot.pathname, "packages/lab/dist/capsule.js")).href
);
const evaluatorApi = await import(
  pathToFileURL(resolve(repositoryRoot.pathname, "packages/lab/dist/evaluator.js")).href
);
const submission = resolve(submissionArg);
const capsule = await capsuleApi.loadCapsule(submission);
const readiness = await capsuleApi.inspectCapsuleReadiness(capsule);
if (readiness.stage !== "publishable") throw new Error("submission Capsule is not publishable");
if (!readiness.release.calibration_refs.includes(receipt.calibration_ref)) {
  throw new Error("receipt calibration is not current for the submission release");
}
const release = await capsuleApi.previewCapsuleRelease(capsule);
if (release.sha256 !== receipt.capsule_release_sha256) {
  throw new Error("receipt Capsule release digest does not match submission");
}
const calibration = await evaluatorApi.readCalibrationReport(submission, receipt.calibration_ref);
if (!calibration.qualified) throw new Error("receipt calibration is not qualified");
const run = await evaluatorApi.replayEvaluationRun(submission, receipt.run_ref);
if (run.capsule_release_sha256 !== release.sha256 || run.verdict !== "accept") {
  throw new Error("receipt Run is not an accepted Run for the current release");
}

const submissionHashes = new Set(
  (await collect(submission, "submission", true)).map((entry) => entry.sha256),
);
const requiredInputEntries = manifest.entries.filter(
  (entry) =>
    /^inputs\/sources\/(?!LICENSE$)/.test(entry.path) ||
    /^inputs\/candidate-pool\/[^/]+\/candidate\.mjs$/.test(entry.path),
);
for (const entry of requiredInputEntries) {
  if (!submissionHashes.has(entry.sha256)) {
    throw new Error(`submission does not bind clean-room input: ${entry.path}`);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      schema_version: 1,
      mechanically_valid: true,
      kit_id: receipt.kit_id,
      participant_id: receipt.participant_id,
      observer_id: receipt.observer_id,
      capsule_release_sha256: release.sha256,
      calibration_ref: receipt.calibration_ref,
      run_ref: receipt.run_ref,
      run_id: run.run_id,
    },
    null,
    2,
  )}\n`,
);
