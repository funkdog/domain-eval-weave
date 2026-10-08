import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, realpath } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { StrictProcessRunner } from "../legacy/dsh-eval-lab/src/process/strict-runner.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../packages/weave/src/capsule/artifact-store.ts";
import { fingerprintJdk } from "./lib/killbill-status-profile.mjs";

// Operator-side preparation only. No Agent loop, submission endpoint or public API.
const [dependencyRoot, assessmentPath, jdkHome] = process.argv.slice(2);
assert.ok(dependencyRoot && assessmentPath && jdkHome, "requires dependency root, assessment, JDK");
assert.equal(platform(), "darwin", "this prepared profile is macOS-only");
const sanctuary = await realpath("/Users/slipshod/AIBuild/dsh-eval-lab-runtime");
async function runtimePath(path) {
  const absolute = resolve(path),
    physical = await realpath(absolute);
  const rel = relative(sanctuary, physical);
  assert.ok(absolute === physical && rel && !rel.startsWith("..") && !rel.startsWith("/"));
  return physical;
}
async function bytes(path, limit = 32 * 1024 * 1024) {
  const physical = await realpath(path);
  assert.equal(physical, resolve(path), "symlink input denied");
  const handle = await open(physical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.nlink === 1 && before.size <= limit);
    const data = await handle.readFile(),
      after = await handle.stat();
    assert.ok(
      before.size === data.length &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
    );
    return data;
  } finally {
    await handle.close();
  }
}
async function put(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeExclusiveOrVerify(
    path,
    Buffer.from(data),
    () => new Error("immutable preparation collision"),
  );
}
const envelope = (body) => ({ ...body, digest: canonicalJsonDigest(body) });
const putJson = (path, value) => put(path, `${canonicalJson(value)}\n`);
function checked(value) {
  const { digest, ...body } = value;
  assert.equal(canonicalJsonDigest(body), digest, "evidence digest mismatch");
  return value;
}
const assets = new URL("../packages/weave/examples/killbill-janitor-recovery/", import.meta.url);
const contract = JSON.parse(await readFile(new URL("task-contract.json", assets), "utf8"));
const lock = JSON.parse(await readFile(new URL("dependency-lock.json", assets), "utf8"));
const taskText = await readFile(new URL("TASK.md", assets), "utf8");
const assessment = checked(JSON.parse(await bytes(await runtimePath(assessmentPath))));
assert.equal(assessment.digest, contract.development_assessment_digest);
assert.equal(assessment.feasibility_ready, true);
assert.equal(assessment.qualification, "not_qualified");
checked(assessment.raw_report);
assert.deepEqual(assessment.dependency_lock, lock);
assert.deepEqual(assessment.raw_report.dependencies.artifacts, lock.artifacts);
const bundleBytes = await readFile(
  new URL("../packages/weave/examples/killbill-orchestration/sources/core.json", import.meta.url),
);
assert.equal(sha256Hex(bundleBytes), contract.source_bundle_sha256);
const bundle = JSON.parse(bundleBytes);
assert.equal(bundle.revision, contract.source_revision);
const reference = bundle.files.find((f) =>
  f.path.endsWith("/IncompletePaymentTransactionTask.java"),
).content;
assert.equal(reference, assessment.source_snapshots.upstream_reference);
const baseline = assessment.source_snapshots[contract.baseline_variant];
assert.equal(
  sha256Hex(baseline),
  assessment.raw_report.observations.find((v) => v.name === contract.baseline_variant)
    .source_sha256,
);
const driver = await readFile(new URL("./fixtures/JanitorProbe.java", import.meta.url), "utf8");
assert.equal(driver, assessment.driver_source);
assert.equal(sha256Hex(driver), assessment.raw_report.driver_sha256);
const deps = await runtimePath(dependencyRoot),
  jdk = await realpath(jdkHome);
assert.ok((await lstat(deps)).isDirectory());
const dependencyBytes = {};
for (const artifact of lock.artifacts) {
  assert.equal(artifact.filename, artifact.filename.split("/").at(-1));
  const data = await bytes(join(deps, artifact.filename));
  assert.equal(sha256Hex(data), artifact.sha256, artifact.filename);
  if (artifact.classifier === null) dependencyBytes[artifact.filename] = data;
}
const root = await mkdtemp(join(sanctuary, "janitor-task."));
console.log(JSON.stringify({ root }));
const workspace = join(root, "workspace"),
  control = join(root, "control");
await mkdir(join(workspace, "build"), { recursive: true, mode: 0o700 });
await mkdir(join(control, "dependencies"), { recursive: true, mode: 0o700 });
// Rewrite only a fresh runtime copy. The downloaded original and previous evidence are never modified.
const paymentJar = "killbill-payment-0.24.21.jar";
const original = join(deps, paymentJar),
  sanitized = join(control, "dependencies", paymentJar);
await put(sanitized, dependencyBytes[paymentJar]);
const archive = (exe, args) =>
  execFileSync(exe, args, {
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
const list = (path) => archive("/usr/bin/unzip", ["-Z1", path]).toString("utf8").trim().split("\n");
const before = list(original),
  removed = contract.build.remove_payment_jar_entries;
assert.equal(new Set(before).size, before.length, "duplicate zip entries");
assert.deepEqual(
  before.filter((name) => name.includes("IncompletePaymentTransactionTask")).sort(),
  [...removed].sort(),
);
assert.ok(
  !before.some((name) => /^META-INF\/.*\.(SF|RSA|DSA|EC)$/i.test(name)),
  "signed archive requires a different packaging policy",
);
archive("/usr/bin/zip", ["-q", "-d", sanitized, ...removed]);
const after = list(sanitized),
  retained = before.filter((name) => !removed.includes(name));
assert.deepEqual(after, retained, "archive rewrite changed the retained entry set/order");
const files = retained.filter((name) => !name.endsWith("/"));
const originalRetained = archive("/usr/bin/unzip", ["-p", original, ...files]);
const sanitizedRetained = archive("/usr/bin/unzip", ["-p", sanitized, ...files]);
assert.ok(originalRetained.equals(sanitizedRetained), "retained helper/resource bytes changed");
dependencyBytes[paymentJar] = await bytes(sanitized);
const packaging = {
  original_sha256: lock.artifacts.find((a) => a.filename === paymentJar).sha256,
  sanitized_sha256: sha256Hex(dependencyBytes[paymentJar]),
  removed_entries: removed,
  retained_entry_count: retained.length,
  retained_content_sha256: sha256Hex(originalRetained),
  tools: {
    zip: sha256Hex(await readFile("/usr/bin/zip")),
    unzip: sha256Hex(await readFile("/usr/bin/unzip")),
  },
};
for (const [name, data] of Object.entries(dependencyBytes)) {
  await put(join(control, "dependencies", name), data);
  const entries = list(join(control, "dependencies", name));
  assert.ok(
    !entries.some((entry) => /IncompletePaymentTransactionTask|JanitorProbe/.test(entry)),
    `target/observer in dependency: ${name}`,
  );
  await put(join(workspace, "lib", name), data);
}
const binaryPins = Object.fromEntries(
  Object.entries(dependencyBytes).map(([name, data]) => [name, sha256Hex(data)]),
);
const environment = {
  profile: "killbill-janitor-on-the-fly-java-v1",
  java_home: jdk,
  build_target: contract.build.java_release,
  editable_source: contract.editable_source,
  compile_argv: [
    join(jdk, "bin/javac"),
    "-proc:none",
    "--release",
    "11",
    "-classpath",
    "lib/*",
    "-d",
    "build",
    contract.editable_source,
  ],
  note: "Development compilation only; only the final Java source is a deliverable. Evaluator rebuilds separately. No model run is authorized by preparation.",
};
const publicFiles = {
  "TASK.md": taskText,
  "ENVIRONMENT.json": `${canonicalJson(environment)}\n`,
  "DEPENDENCIES.json": `${canonicalJson({ binaries: binaryPins, payment_jar_derivation: packaging })}\n`,
  LICENSE: bundle.files.find((f) => f.path === "LICENSE").content,
};
for (const [name, content] of Object.entries(publicFiles))
  await put(join(workspace, name), content);
await put(join(workspace, contract.editable_source), baseline);
const implementation = {};
for (const [name, url] of Object.entries({
  preparer: new URL(import.meta.url),
  jdk_fingerprint: new URL("./lib/killbill-status-profile.mjs", import.meta.url),
  sandbox: new URL("../legacy/dsh-eval-lab/src/process/strict-runner.ts", import.meta.url),
  canonical: new URL("../packages/weave/src/canonical-json.ts", import.meta.url),
  store: new URL("../packages/weave/src/capsule/artifact-store.ts", import.meta.url),
}))
  implementation[name] = sha256Hex(await readFile(url));
const task = envelope({
  format: "janitor-prepared-task-v1",
  contract,
  task_text: taskText,
  baseline_source: baseline,
  baseline_sha256: sha256Hex(baseline),
  reference_sha256: sha256Hex(reference),
  protected_files: {
    ...Object.fromEntries(
      Object.entries(publicFiles).map(([name, text]) => [name, sha256Hex(text)]),
    ),
    ...Object.fromEntries(Object.entries(binaryPins).map(([name, hash]) => [`lib/${name}`, hash])),
  },
  environment: {
    ...environment,
    host: { platform: platform(), arch: arch(), kernel: release() },
    fingerprint: await fingerprintJdk(jdk),
    binaries: binaryPins,
  },
  oracle: { driver, driver_sha256: sha256Hex(driver), contract },
  packaging,
  upstream_dependencies: lock,
  implementation,
  qualification: "not_qualified",
  agent_execution: "not_observed",
});
await putJson(join(control, "task.json"), task);
await putJson(join(control, "development-evidence.json"), assessment);
await put(join(control, "oracle", "JanitorProbe.java"), driver);

// New dependency representation requires two bounded health checks, not another four-variant cohort.
const runner = new StrictProcessRunner();
const observations = [];
for (const [name, source] of [
  ["upstream_reference", reference],
  [contract.baseline_variant, baseline],
]) {
  const directory = join(control, "preparation", name),
    classes = join(directory, "classes");
  await put(
    join(classes, "mockito-extensions", "org.mockito.plugins.MockMaker"),
    "mock-maker-subclass\n",
  );
  await put(join(directory, "IncompletePaymentTransactionTask.java"), source);
  await put(join(directory, "JanitorProbe.java"), driver);
  const jars = Object.keys(binaryPins).map((jar) => join(control, "dependencies", jar));
  const common = {
    cwd: directory,
    readableRoots: [...jars, jdk],
    writableRoot: classes,
    timeoutMs: contract.build.timeout_ms,
    maxOutputBytes: contract.build.max_output_bytes,
  };
  const compile = await runner.run({
    ...common,
    executable: join(jdk, "bin/javac"),
    args: [
      "-proc:none",
      "--release",
      "11",
      "-classpath",
      jars.join(delimiter),
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
            [classes, ...jars].join(delimiter),
            contract.observation.driver,
            classes,
          ],
        })
      : null;
  const lines = execution?.stdout.trim().split("\n") ?? [];
  const [begin, token] = lines[0]?.split("\t") ?? [];
  let rows = [],
    parseError = null;
  try {
    rows = lines
      .slice(1, -1)
      .filter((line) => line.startsWith(`${token}\t`))
      .map((line) => JSON.parse(line.slice(token.length + 1)));
  } catch (error) {
    parseError = error.message;
  }
  const processOk = (p) =>
    p?.exitCode === 0 && p.signal === null && !p.timedOut && !p.outputLimitExceeded;
  const frameOk =
    begin === "BEGIN" && /^[0-9a-f-]{36}$/.test(token ?? "") && lines.at(-1) === `END\t${token}`;
  const casesOk =
    JSON.stringify(rows.map((r) => r.scenario)) === JSON.stringify(contract.observation.cases);
  const guardsOk =
    rows.length === 5 &&
    rows.every(
      (r) =>
        r.old_snapshot_unchanged === true &&
        r.lock_held === false &&
        r.acquired === r.released &&
        r.transaction_id === "00000000-0000-0000-0000-000000000003",
    ) &&
    rows[0].trace.indexOf("other-operation:AUTH_SUCCESS->CAPTURE_SUCCESS") >= 0 &&
    rows[0].trace.indexOf("other-operation:AUTH_SUCCESS->CAPTURE_SUCCESS") <
      rows[0].trace.indexOf("acquired");
  const valid =
    processOk(compile) && processOk(execution) && frameOk && casesOk && guardsOk && !parseError;
  const checks = valid
    ? rows.map((row) => ({
        scenario: row.scenario,
        differences: Object.entries(contract.expected[row.scenario])
          .filter(([field, value]) =>
            field === "processed_amount"
              ? !(value === "0" ? /^0(?:\.0+)?$/ : /^10(?:\.0+)?$/).test(row[field])
              : row[field] !== value,
          )
          .map(([field, expected]) => ({ field, expected, observed: row[field] })),
      }))
    : null;
  const failed = checks?.filter((c) => c.differences.length > 0).map((c) => c.scenario) ?? null;
  const expectedFailures = name === "upstream_reference" ? [] : ["concurrent_capture"];
  const ready = valid && JSON.stringify(failed) === JSON.stringify(expectedFailures);
  const evidence = {
    name,
    source_sha256: sha256Hex(source),
    compile,
    execution,
    rows,
    parse_error: parseError,
    measurement_valid: valid,
    checks,
    ready,
  };
  observations.push(evidence);
  await putJson(join(directory, "evidence.json"), evidence);
  if (!ready) break;
}
const ready = observations.length === 2 && observations.every((o) => o.ready);
const receipt = envelope({
  format: "janitor-preparation-v1",
  task_digest: task.digest,
  observations,
  prepared: ready,
  agent_ready: false,
  pending: [
    "candidate_submission_and_code_run_binding",
    "harness_workspace_permission_preflight",
    "bounded_model_authorization",
  ],
  qualification: "not_qualified",
  agent_execution: "not_observed",
});
await putJson(join(control, "preparation.json"), receipt);
console.log(
  JSON.stringify(
    {
      root,
      workspace,
      task_digest: task.digest,
      preparation_digest: receipt.digest,
      prepared: ready,
      agent_ready: false,
      qualification: "not_qualified",
    },
    null,
    2,
  ),
);
if (!ready) process.exitCode = 1;
