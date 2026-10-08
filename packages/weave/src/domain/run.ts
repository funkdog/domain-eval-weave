import { lstat, open, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { canonicalJson, canonicalJsonDigest } from "../canonical-json.js";
import { DomainCompilerError } from "./errors.js";
import { type GraderValidationResult, validateDomainGraderDirectory } from "./validation.js";

const gradeOutcomeSchema = z.enum([
  "pass",
  "fail",
  "not_applicable",
  "insufficient_evidence",
  "indeterminate",
]);

const validationResultSchema = z.strictObject({
  status: z.enum(["validated", "invalid"]),
  closureDigest: z.string().regex(/^[0-9a-f]{64}$/),
  graderDigest: z.string().regex(/^[0-9a-f]{64}$/),
  cohortDigests: z.strictObject({
    development: z.string().regex(/^[0-9a-f]{64}$/),
    calibration: z.string().regex(/^[0-9a-f]{64}$/),
    validation: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  evidenceDigest: z.string().regex(/^[0-9a-f]{64}$/),
  caseEvidence: z.array(
    z.strictObject({
      caseId: z.string().min(1),
      cohort: z.enum(["development", "calibration", "validation"]),
      observationDigest: z.string().regex(/^[0-9a-f]{64}$/),
      expectedAtoms: z.record(z.string().min(1), gradeOutcomeSchema),
      observedAtoms: z.record(z.string().min(1), gradeOutcomeSchema),
      expectedOverall: gradeOutcomeSchema,
      observedOverall: gradeOutcomeSchema,
    }),
  ),
});

const validationRunSchema = z.strictObject({
  schemaVersion: z.literal("domain-first-validation-run-v0"),
  runDigest: z.string().regex(/^[0-9a-f]{64}$/),
  result: validationResultSchema,
});

export interface StoredDomainValidationRun {
  readonly runId: string;
  readonly runPath: string;
  readonly result: GraderValidationResult;
}

async function requirePhysicalDirectory(path: string): Promise<string> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new DomainCompilerError(
      "invalid_run_output_directory",
      "Run output directory does not exist",
      path,
    );
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new DomainCompilerError(
      "invalid_run_output_directory",
      "Run output must be one physical directory",
      path,
    );
  }
  return realpath(path);
}

function runPayload(result: GraderValidationResult) {
  return { schemaVersion: "domain-first-validation-run-v0" as const, result };
}

export async function writeDomainValidationRunDirectory(
  inputRoot: string,
  outputRoot: string,
): Promise<StoredDomainValidationRun> {
  const result = await validateDomainGraderDirectory(inputRoot);
  const payload = runPayload(result);
  const runId = canonicalJsonDigest(payload);
  const artifact = { ...payload, runDigest: runId };
  const bytes = `${canonicalJson(artifact)}\n`;
  const physicalOutputRoot = await requirePhysicalDirectory(outputRoot);
  const runPath = join(physicalOutputRoot, `${runId}.json`);
  try {
    const handle = await open(runPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(runPath, "utf8")) !== bytes) {
      throw new DomainCompilerError(
        "validation_run_collision",
        "Existing Run bytes do not match their content address",
        runId,
      );
    }
  }
  return { runId, runPath, result };
}

export async function replayDomainValidationRunFile(
  runPath: string,
): Promise<GraderValidationResult> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(runPath);
  } catch {
    throw new DomainCompilerError("validation_run_not_found", "Run artifact is unavailable");
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new DomainCompilerError(
      "validation_run_not_physical",
      "Run artifact must be one physical file",
      runPath,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(runPath, "utf8"));
  } catch {
    throw new DomainCompilerError("invalid_validation_run", "Run artifact is not valid JSON");
  }
  const parsed = validationRunSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainCompilerError(
      "invalid_validation_run",
      parsed.error.issues[0]?.message ?? "Run artifact is invalid",
    );
  }
  const expectedRunDigest = canonicalJsonDigest(runPayload(parsed.data.result));
  const expectedEvidenceDigest = canonicalJsonDigest({
    closureDigest: parsed.data.result.closureDigest,
    graderDigest: parsed.data.result.graderDigest,
    cohortDigests: parsed.data.result.cohortDigests,
    caseEvidence: parsed.data.result.caseEvidence,
  });
  if (
    parsed.data.runDigest !== expectedRunDigest ||
    parsed.data.result.evidenceDigest !== expectedEvidenceDigest
  ) {
    throw new DomainCompilerError(
      "validation_run_digest_mismatch",
      "Run artifact content does not match its bound digests",
      parsed.data.runDigest,
    );
  }
  return parsed.data.result;
}
