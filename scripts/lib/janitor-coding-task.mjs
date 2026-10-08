import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, realpath } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { StrictProcessRunner } from "../../legacy/dsh-eval-lab/src/process/strict-runner.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";
import { gradeJanitorEvidence, janitorGraderVersion } from "./janitor-observations.mjs";
import { fingerprintJdk } from "./killbill-status-profile.mjs";

// The local consumer kit binds its own dedicated state directory before importing this module.
// Existing repository/Harness callers retain their original runtime boundary.
const configuredRuntime = process.env.WEAVE_JANITOR_RUNTIME_ROOT;
if (configuredRuntime)
  assert.ok(
    isAbsolute(configuredRuntime) && basename(configuredRuntime) === "state",
    "consumer runtime must be an explicit dedicated state directory",
  );
const runtime = configuredRuntime ?? "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
const sourcePath = "src/IncompletePaymentTransactionTask.java";
const hash = /^[0-9a-f]{64}$/;
const host = () => ({ platform: platform(), arch: arch(), kernel: release() });
export const janitorEnvelope = (body) => ({ ...body, digest: canonicalJsonDigest(body) });
function checked(value, format) {
  assert.equal(value.format, format);
  const { digest, ...body } = value;
  assert.match(digest, hash);
  assert.equal(canonicalJsonDigest(body), digest, "artifact digest mismatch");
  return value;
}
async function rootPath(path) {
  const absolute = resolve(path),
    physical = await realpath(absolute);
  const rel = relative(await realpath(runtime), physical);
  assert.ok(
    absolute === physical && rel && !rel.startsWith("..") && !rel.startsWith("/"),
    "physical task directory outside runtime",
  );
  assert.ok((await lstat(physical)).isDirectory());
  return physical;
}
async function physicalBytes(root, name, limit = 32 * 1024 * 1024) {
  const parts = name.split("/");
  assert.ok(
    parts.every((part) => part && part !== "." && part !== ".."),
    "invalid relative path",
  );
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "symlink input denied");
  }
  const handle = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(
      before.isFile() && before.nlink === 1 && before.size <= limit,
      "bounded single-link physical input required",
    );
    const data = await handle.readFile(),
      after = await handle.stat();
    assert.ok(
      data.length === before.size &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
      "input changed while being captured",
    );
    return data;
  } finally {
    await handle.close();
  }
}
async function put(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  assert.equal(await realpath(dirname(path)), dirname(path), "output parent symlink denied");
  try {
    const stat = await lstat(path);
    assert.ok(
      stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
      "unsafe output collision",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeExclusiveOrVerify(
    path,
    Buffer.from(data),
    () => new Error("immutable artifact collision"),
  );
}
const putJson = (path, data) => put(path, `${canonicalJson(data)}\n`);
const readJson = async (root, path) =>
  JSON.parse((await physicalBytes(root, path)).toString("utf8"));
const assets = new URL("../../packages/weave/examples/killbill-janitor-recovery/", import.meta.url);
async function graderPin() {
  const source = await readFile(new URL("./janitor-observations.mjs", import.meta.url), "utf8");
  return { version: janitorGraderVersion, source, sha256: sha256Hex(source) };
}
async function implementationPins() {
  const files = {
    workflow: new URL(import.meta.url),
    sandbox: new URL("../../legacy/dsh-eval-lab/src/process/strict-runner.ts", import.meta.url),
    canonical: new URL("../../packages/weave/src/canonical-json.ts", import.meta.url),
    store: new URL("../../packages/weave/src/capsule/artifact-store.ts", import.meta.url),
    jdk_fingerprint: new URL("./killbill-status-profile.mjs", import.meta.url),
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([key, path]) => [key, sha256Hex(await readFile(path))]),
    ),
  );
}
export async function loadJanitorTask(taskRoot) {
  const root = await rootPath(taskRoot);
  const task = checked(await readJson(root, "control/task.json"), "janitor-prepared-task-v1");
  const contract = JSON.parse(await readFile(new URL("task-contract.json", assets), "utf8"));
  assert.deepEqual(task.contract, contract, "unsupported frozen task contract");
  assert.deepEqual(task.oracle.contract, contract);
  assert.equal(contract.editable_source, sourcePath);
  assert.equal(sha256Hex(task.baseline_source), task.baseline_sha256);
  assert.equal(sha256Hex(task.oracle.driver), task.oracle.driver_sha256);
  assert.equal(
    task.oracle.driver_sha256,
    sha256Hex(await readFile(new URL("../fixtures/JanitorProbe.java", import.meta.url))),
  );
  const lock = JSON.parse(await readFile(new URL("dependency-lock.json", assets), "utf8"));
  assert.deepEqual(task.upstream_dependencies, lock);
  const binaryNames = lock.artifacts.filter((a) => a.classifier === null).map((a) => a.filename);
  assert.deepEqual(Object.keys(task.environment.binaries).sort(), [...binaryNames].sort());
  const protectedNames = [
    "TASK.md",
    "ENVIRONMENT.json",
    "DEPENDENCIES.json",
    "LICENSE",
    ...binaryNames.map((n) => `lib/${n}`),
  ];
  assert.deepEqual(Object.keys(task.protected_files).sort(), protectedNames.sort());
  for (const name of binaryNames) {
    assert.ok(!name.includes("/") && !name.includes(".."));
    const expected =
      name === "killbill-payment-0.24.21.jar"
        ? task.packaging.sanitized_sha256
        : lock.artifacts.find((a) => a.filename === name).sha256;
    assert.match(expected, hash);
    assert.equal(task.environment.binaries[name], expected);
    assert.equal(task.protected_files[`lib/${name}`], expected);
    assert.equal(
      sha256Hex(await physicalBytes(root, `control/dependencies/${name}`)),
      expected,
      "trusted dependency drift",
    );
  }
  assert.deepEqual(task.packaging.removed_entries, contract.build.remove_payment_jar_entries);
  const preparation = checked(
    await readJson(root, "control/preparation.json"),
    "janitor-preparation-v1",
  );
  assert.equal(preparation.task_digest, task.digest);
  assert.equal(preparation.prepared, true, "task not prepared");
  assert.equal(preparation.observations.length, 2);
  for (const [i, evidence] of preparation.observations.entries()) {
    assert.equal(evidence.source_sha256, i === 0 ? task.reference_sha256 : task.baseline_sha256);
    const result = gradeJanitorEvidence(contract, evidence);
    assert.equal(result.measurement_validity, "valid");
    assert.deepEqual(
      result.checks.filter((c) => c.verdict === "fail").map((c) => c.scenario),
      i === 0 ? [] : ["concurrent_capture"],
    );
  }
  const pins = await implementationPins();
  for (const key of ["sandbox", "canonical", "store", "jdk_fingerprint"])
    assert.equal(task.implementation[key], pins[key], `frozen runtime dependency drift: ${key}`);
  return { root, task, preparation };
}

// Reinstantiate the same task without rerunning preparation or touching the original workspace.
export async function materializeJanitorTask(templateRoot) {
  const { root: template, task, preparation } = await loadJanitorTask(templateRoot);
  const root = await mkdtemp(join(runtime, "janitor-coding.")),
    workspace = join(root, "workspace");
  await mkdir(join(workspace, "build"), { recursive: true, mode: 0o700 });
  for (const [name, digest] of Object.entries(task.protected_files)) {
    const data = name.startsWith("lib/")
      ? await physicalBytes(template, `control/dependencies/${name.slice(4)}`)
      : await physicalBytes(template, `workspace/${name}`);
    assert.equal(sha256Hex(data), digest, `protected template drift: ${name}`);
    await put(join(workspace, name), data);
    if (name.startsWith("lib/")) await put(join(root, "control/dependencies", name.slice(4)), data);
  }
  await put(join(workspace, sourcePath), task.baseline_source);
  await putJson(join(root, "control/task.json"), task);
  await putJson(join(root, "control/preparation.json"), preparation);
  await putJson(
    join(root, "control/instance.json"),
    janitorEnvelope({
      format: "janitor-instance-v1",
      template_root: template,
      task_digest: task.digest,
      preparation_digest: preparation.digest,
    }),
  );
  return { root, workspace, task_digest: task.digest, qualification: "not_qualified" };
}
async function inspectWorkspace(root, task) {
  const workspace = await rootPath(join(root, "workspace"));
  const names = [],
    allowed = [...Object.keys(task.protected_files), sourcePath];
  const walk = async (directory, prefix = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), "workspace symlink denied");
      if (entry.isDirectory()) {
        if (name === "build") continue; // Never ingested or reused by evaluation.
        assert.ok(name === "src" || name === "lib", "unexpected workspace directory");
        await walk(join(directory, entry.name), `${name}/`);
      } else {
        assert.ok(entry.isFile() && allowed.includes(name), "unexpected workspace input");
        names.push(name);
      }
    }
  };
  await walk(workspace);
  assert.deepEqual(names.sort(), allowed.sort());
  for (const [name, digest] of Object.entries(task.protected_files))
    assert.equal(
      sha256Hex(await physicalBytes(workspace, name)),
      digest,
      `protected input drift: ${name}`,
    );
  return physicalBytes(workspace, sourcePath, 256 * 1024);
}
export async function submitJanitorSource(taskRoot) {
  const { root, task } = await loadJanitorTask(taskRoot);
  const data = await inspectWorkspace(root, task);
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  const submission = janitorEnvelope({
    format: "janitor-source-submission-v1",
    task_digest: task.digest,
    source_path: sourcePath,
    source_sha256: sha256Hex(data),
    source,
    provenance: "unattested_code_submission",
  });
  const path = join(root, "control/submissions", `${submission.digest}.json`);
  await putJson(path, submission);
  return { digest: submission.digest, task_digest: task.digest, path };
}
export async function runJanitorWorkspaceCommand(taskRoot, command) {
  assert.ok(typeof command === "string" && command.length > 0 && command.length <= 32768);
  const { root, task } = await loadJanitorTask(taskRoot);
  const workspace = await rootPath(join(root, "workspace"));
  return new StrictProcessRunner().run({
    executable: "/usr/bin/env",
    args: ["/bin/sh", "-c", command],
    cwd: workspace,
    readableRoots: [task.environment.java_home, dirname(dirname(process.execPath))],
    writableRoot: workspace,
    timeoutMs: 15000,
    maxOutputBytes: 128 * 1024,
  });
}
function resultFor(task, candidate, evidence) {
  return {
    task_digest: task.digest,
    candidate_digest: candidate.digest,
    claim_scope: task.contract.claim_scope,
    agent_execution: "not_observed",
    qualification: "not_qualified",
    ...gradeJanitorEvidence(task.contract, evidence),
  };
}
export async function evaluateJanitorSubmission(taskRoot, submissionDigest) {
  assert.match(submissionDigest, hash);
  const { root, task } = await loadJanitorTask(taskRoot);
  const candidate = checked(
    await readJson(root, `control/submissions/${submissionDigest}.json`),
    "janitor-source-submission-v1",
  );
  assert.equal(candidate.digest, submissionDigest);
  assert.equal(candidate.task_digest, task.digest, "submission belongs to another task");
  assert.equal(candidate.source_path, sourcePath);
  assert.equal(sha256Hex(candidate.source), candidate.source_sha256);
  assert.deepEqual(task.environment.host, host(), "host drift");
  assert.deepEqual(
    await fingerprintJdk(task.environment.java_home),
    task.environment.fingerprint,
    "JDK drift",
  );
  const grader = await graderPin(),
    implementation = await implementationPins();
  const directory = await mkdtemp(join(root, "execution.")),
    classes = join(directory, "classes");
  await put(
    join(classes, "mockito-extensions/org.mockito.plugins.MockMaker"),
    "mock-maker-subclass\n",
  );
  await put(join(directory, "IncompletePaymentTransactionTask.java"), candidate.source);
  await put(join(directory, "JanitorProbe.java"), task.oracle.driver);
  const jars = Object.keys(task.environment.binaries).map((name) =>
    join(root, "control/dependencies", name),
  );
  const jdk = task.environment.java_home;
  const common = {
    cwd: directory,
    readableRoots: [...jars, jdk],
    writableRoot: classes,
    timeoutMs: task.contract.build.timeout_ms,
    maxOutputBytes: task.contract.build.max_output_bytes,
  };
  const runner = new StrictProcessRunner();
  let compile = null,
    execution = null,
    failure = null;
  try {
    compile = await runner.run({
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
    if (compile.exitCode === 0 && !compile.timedOut && !compile.outputLimitExceeded)
      execution = await runner.run({
        ...common,
        executable: join(jdk, "bin/java"),
        args: [
          "-Xmx256m",
          "-XX:-UsePerfData",
          "-classpath",
          [classes, ...jars].join(delimiter),
          task.contract.observation.driver,
          classes,
        ],
      });
  } catch (error) {
    failure = { code: error.code ?? "UNKNOWN", message: error.message };
  }
  const evidence = {
    source_sha256: candidate.source_sha256,
    driver_sha256: task.oracle.driver_sha256,
    compile,
    execution,
    failure,
  };
  const result = resultFor(task, candidate, evidence);
  const run = janitorEnvelope({
    format: "janitor-code-run-v1",
    task,
    candidate,
    grader,
    implementation,
    evidence,
    result,
  });
  const path = join(root, "control/runs", `${run.digest}.json`);
  await putJson(path, run);
  return { digest: run.digest, path, result };
}
export async function replayJanitorRun(path) {
  const parent = await rootPath(dirname(resolve(path))),
    name = relative(parent, resolve(path));
  assert.match(name, /^[0-9a-f]{64}\.json$/);
  const run = checked(await readJson(parent, name), "janitor-code-run-v1");
  assert.equal(run.digest, name.slice(0, -5));
  checked(run.task, "janitor-prepared-task-v1");
  checked(run.candidate, "janitor-source-submission-v1");
  assert.equal(run.candidate.task_digest, run.task.digest);
  assert.equal(run.candidate.source_path, sourcePath);
  assert.equal(sha256Hex(run.candidate.source), run.candidate.source_sha256);
  assert.equal(run.evidence.source_sha256, run.candidate.source_sha256);
  assert.equal(run.evidence.driver_sha256, sha256Hex(run.task.oracle.driver));
  assert.deepEqual(
    run.grader,
    await graderPin(),
    "unsupported grader revision; use its pinned replay implementation",
  );
  const result = resultFor(run.task, run.candidate, run.evidence);
  assert.deepEqual(result, run.result, "replayed result differs");
  return result;
}
