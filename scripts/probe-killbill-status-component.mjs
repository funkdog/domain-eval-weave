import { readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { StrictProcessRunner } from "../legacy/dsh-eval-lab/src/process/strict-runner.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../packages/weave/src/capsule/artifact-store.ts";
import {
  dependencies,
  driver,
  executeStatusSource,
  fingerprintJdk,
  loadStatusSources,
} from "./lib/killbill-status-profile.mjs";

// Existing feasibility entry, now sharing the same component executor as submitted-code evaluation.
const [outputRoot, jdkHome, ...extra] = process.argv.slice(2);
if (!outputRoot || !jdkHome || extra.length)
  throw new Error(
    "Usage: node --import tsx scripts/probe-killbill-status-component.mjs <prepared-runtime-directory> <jdk-home>",
  );
const root = await realpath(outputRoot);
const jdk = await realpath(jdkHome);
const sanctuary = await realpath("/Users/slipshod/AIBuild/dsh-eval-lab-runtime");
const relation = relative(sanctuary, root);
if (!relation || relation.startsWith("..") || relation.startsWith("/"))
  throw new Error("probe requires a child of the isolated runtime directory");
const { revision, sourcePath, reference, variants } = await loadStatusSources();
const results = [];
for (const [name, source] of Object.entries(variants)) {
  results.push({
    name,
    ...(await executeStatusSource({
      source,
      workspace: join(root, name),
      dependencyDirectory: root,
      jdk,
    })),
  });
}
const runtime = await new StrictProcessRunner().run({
  executable: join(jdk, "bin/java"),
  args: ["-version"],
  cwd: root,
  readableRoots: [jdk],
  writableRoot: join(root, "runtime-info"),
  timeoutMs: 5000,
  maxOutputBytes: 4096,
});
const regression = results.find((result) => result.name === "seeded_regression");
const discriminationVerified =
  results.every((result) => result.measurement_valid) &&
  results
    .filter((result) => result.name !== "seeded_regression")
    .every((result) => result.mismatches.length === 0) &&
  regression.mismatches.length === 2 &&
  regression.mismatches.every(
    (row) => row.input === "NULL_STATUS" && row.observed === "THREW:java.lang.NullPointerException",
  );
const body = {
  format: "killbill-status-component-feasibility-v2",
  stage: "feasibility_only",
  qualification: "not_qualified",
  discrimination_verified: discriminationVerified,
  subject: "real Java converter component; not a full Kill Bill build or an Agent run",
  source: { revision, path: sourcePath, sha256: sha256Hex(reference) },
  issue: "https://github.com/killbill/killbill/issues/366",
  historical_fix: "f6e13d42af033ac09305d8206fb800ee072b2239",
  derivation:
    "explicitly reintroduce the historical null-switch defect into 0.24.21; not the 2015 environment",
  dependencies,
  jdk: { path: jdk, fingerprint: await fingerprintJdk(jdk) },
  driver_sha256: sha256Hex(driver),
  probe_sha256: sha256Hex(await readFile(new URL(import.meta.url))),
  profile_sha256: sha256Hex(
    await readFile(new URL("./lib/killbill-status-profile.mjs", import.meta.url)),
  ),
  sandbox_runner_sha256: sha256Hex(
    await readFile(new URL("../legacy/dsh-eval-lab/src/process/strict-runner.ts", import.meta.url)),
  ),
  runtime,
  results,
};
const digest = canonicalJsonDigest(body);
const reportPath = join(root, `${digest}.json`);
await writeExclusiveOrVerify(
  reportPath,
  Buffer.from(`${canonicalJson({ ...body, digest })}\n`),
  () => new Error("probe artifact collision"),
);
console.log(
  JSON.stringify(
    {
      reportPath,
      digest,
      qualification: body.qualification,
      discrimination_verified: discriminationVerified,
      results: results.map(({ name, measurement_valid, mismatches }) => ({
        name,
        measurement_valid,
        mismatches,
      })),
    },
    null,
    2,
  ),
);
if (results.some((result) => !result.measurement_valid)) process.exitCode = 2;
else if (!discriminationVerified) process.exitCode = 3;
