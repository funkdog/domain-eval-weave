import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { delimiter, join, relative } from "node:path";
import { StrictProcessRunner } from "../legacy/dsh-eval-lab/src/process/strict-runner.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../packages/weave/src/canonical-json.ts";

const [dependencyRoot, jdk] = process.argv.slice(2);
const sanctuary = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
const deps = await realpath(dependencyRoot);
assert.ok(!relative(sanctuary, deps).startsWith(".."));
const manifest = JSON.parse(await readFile(join(deps, "dependencies.json"), "utf8"));
const locked = JSON.parse(
  await readFile(
    new URL(
      "../packages/weave/examples/killbill-janitor-recovery/dependency-lock.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.deepEqual(
  manifest.artifacts,
  locked.artifacts,
  "development dependency set differs from the pinned lock",
);
for (const artifact of manifest.artifacts)
  assert.equal(
    sha256Hex(await readFile(join(deps, artifact.filename))),
    artifact.sha256,
    artifact.filename,
  );
const bundleBytes = await readFile(
  new URL("../packages/weave/examples/killbill-orchestration/sources/core.json", import.meta.url),
);
assert.equal(
  sha256Hex(bundleBytes),
  "a6848aa19ba4b8483f8798f65aa68bc11aae43949637a82a33a825ec8544bebf",
);
const bundle = JSON.parse(bundleBytes);
const source = bundle.files.find((f) =>
  f.path.endsWith("/IncompletePaymentTransactionTask.java"),
).content;
assert.equal(sha256Hex(source), "23df7a78b85a803d61bb5dd228388b0eceebdd9a36c7055cfaae49f0bf742e7c");
const driver = await readFile(new URL("./fixtures/JanitorProbe.java", import.meta.url), "utf8");
const callback = `return updatePaymentAndTransactionIfNeeded(accountId,\n                                                           paymentTransactionId,\n                                                           paymentTransactionInfoPlugin,\n                                                           isApiPayment,\n                                                           internalTenantContext);`;
assert.equal(source.split(callback).length, 2);
const lockStart = "return tryToDoJanitorOperationWithAccountLock(new JanitorIterationCallback() {";
assert.equal(source.split(lockStart).length, 2);
const regression = source
  .replace(
    lockStart,
    "final PaymentTransactionModelDao stale = paymentDao.getPaymentTransaction(paymentTransactionId, internalTenantContext);\n        " +
      lockStart,
  )
  .replace(
    callback,
    "return updatePaymentAndTransactionInternal(accountId, stale, paymentTransactionInfoPlugin, isApiPayment, internalTenantContext);",
  );
const noOp = source.replace(callback, "return currentTransactionStatus;");
const guard =
  "if (!TRANSACTION_STATUSES_TO_CONSIDER.contains(paymentTransaction.getTransactionStatus())) {";
assert.equal(source.split(guard).length, 2);
const equivalent = source.replace(
  guard,
  "if (paymentTransaction.getTransactionStatus() != TransactionStatus.UNKNOWN && paymentTransaction.getTransactionStatus() != TransactionStatus.PENDING) {",
);
const root = await mkdtemp(join(sanctuary, "janitor-feasibility."));
console.log(JSON.stringify({ root }));
const jars = manifest.artifacts
  .filter((a) => a.classifier === null)
  .map((a) => join(deps, a.filename));
const classpath = jars.join(delimiter);
const variants = {
  upstream_reference: source,
  stale_snapshot_regression: regression,
  never_recover: noOp,
  authored_equivalent: equivalent,
};
const observations = [];
const runner = new StrictProcessRunner();
for (const [name, candidate] of Object.entries(variants)) {
  const directory = join(root, name),
    classes = join(directory, "classes");
  await mkdir(join(classes, "mockito-extensions"), { recursive: true });
  await writeFile(
    join(classes, "mockito-extensions/org.mockito.plugins.MockMaker"),
    "mock-maker-subclass\n",
    { flag: "wx" },
  );
  await writeFile(join(directory, "IncompletePaymentTransactionTask.java"), candidate, {
    flag: "wx",
  });
  await writeFile(join(directory, "JanitorProbe.java"), driver, { flag: "wx" });
  const common = {
    cwd: directory,
    readableRoots: [deps, jdk],
    writableRoot: classes,
    timeoutMs: 30000,
    maxOutputBytes: 256 * 1024,
  };
  const compile = await runner.run({
    ...common,
    executable: join(jdk, "bin/javac"),
    args: [
      "-proc:none",
      "--release",
      "11",
      "-classpath",
      classpath,
      "-d",
      classes,
      join(directory, "IncompletePaymentTransactionTask.java"),
      join(directory, "JanitorProbe.java"),
    ],
  });
  const execution =
    compile.exitCode === 0
      ? await runner.run({
          ...common,
          executable: join(jdk, "bin/java"),
          args: [
            "-Xmx256m",
            "-XX:-UsePerfData",
            "-classpath",
            [classes, classpath].join(delimiter),
            "org.killbill.billing.payment.core.janitor.JanitorProbe",
            classes,
          ],
        })
      : null;
  const lines = execution?.stdout.trim().split("\n") ?? [];
  const first = lines[0]?.split("\t"),
    last = lines.at(-1)?.split("\t");
  const token = first?.[1];
  const framed = first?.[0] === "BEGIN" && last?.[0] === "END" && token === last?.[1];
  const rows = framed
    ? lines
        .slice(1, -1)
        .filter((line) => line.startsWith(`${token}\t`))
        .map((line) => JSON.parse(line.slice(token.length + 1)))
    : [];
  const valid =
    compile.exitCode === 0 &&
    execution?.exitCode === 0 &&
    !compile.timedOut &&
    !execution.timedOut &&
    !compile.outputLimitExceeded &&
    !execution.outputLimitExceeded &&
    rows.length === 5;
  const evidence = {
    name,
    source_sha256: sha256Hex(candidate),
    compile,
    execution,
    measurement_valid: valid,
    rows,
  };
  observations.push(evidence);
  await writeFile(join(directory, "evidence.json"), canonicalJson(evidence), { flag: "wx" });
  console.log(
    JSON.stringify({
      variant: name,
      valid,
      compile_exit: compile.exitCode,
      execution_exit: execution?.exitCode ?? null,
      stderr: compile.stderr || execution?.stderr || "",
    }),
  );
  if (!valid) break; // Diagnose environment/observation failures before evaluating any other variant.
}
const report = {
  format: "janitor-feasibility-v1",
  root,
  source_revision: bundle.revision,
  source_bundle_sha256: sha256Hex(bundleBytes),
  driver_sha256: sha256Hex(driver),
  dependencies: manifest,
  observations,
  qualification: "not_qualified",
  agent_execution: "not_observed",
};
await writeFile(
  join(root, "report.json"),
  canonicalJson({ ...report, digest: canonicalJsonDigest(report) }),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    root,
    variants_observed: observations.length,
    all_measurements_valid:
      observations.length === 4 && observations.every((o) => o.measurement_valid),
  }),
);
if (observations.length !== 4 || !observations.every((o) => o.measurement_valid))
  process.exitCode = 1;
