import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, realpath } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { StrictProcessRunner } from "../../legacy/dsh-eval-lab/src/process/strict-runner.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";
import {
  candidateName,
  dependencies,
  driver,
  executeStatusSource,
  expected,
  fingerprintJdk,
  loadStatusSources,
} from "./killbill-status-profile.mjs";

const runtimeRoot = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
const sourceRelative = `src/${candidateName}`;
const hashPattern = /^[0-9a-f]{64}$/;
const protectedPaths = [
  "TASK.md",
  "LICENSE",
  "ENVIRONMENT.json",
  ...Object.keys(dependencies).map((name) => `lib/${name}`),
];
const host = () => ({ platform: platform(), arch: arch(), kernel: release() });

async function physicalRoot(path) {
  const absolute = resolve(path);
  const physical = await realpath(absolute);
  const sanctuary = await realpath(runtimeRoot);
  const relation = relative(sanctuary, physical);
  if (
    absolute !== physical ||
    relation.startsWith("..") ||
    relation.startsWith("/") ||
    !(await lstat(physical)).isDirectory()
  ) {
    throw new Error("requires a physical directory under the isolated runtime");
  }
  return physical;
}

// Read one stable physical file; never follow a candidate-controlled symlink or hard link.
async function physicalBytes(root, path, maxBytes = 32 * 1024 * 1024) {
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    throw new Error("invalid relative file");
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("symlink or non-directory in input path");
  }
  const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes)
      throw new Error("input must be one bounded physical file");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      bytes.length !== before.size
    ) {
      throw new Error("input changed while being captured");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error("non-physical output collision");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeExclusiveOrVerify(
    path,
    Buffer.from(bytes),
    () => new Error("immutable artifact collision"),
  );
}
const putJson = (path, value) => put(path, `${canonicalJson(value)}\n`);
function envelope(body) {
  return { ...body, digest: canonicalJsonDigest(body) };
}
function checkedEnvelope(value, format) {
  assert.equal(value.format, format, "artifact format mismatch");
  const { digest, ...body } = value;
  assert.match(digest, hashPattern);
  assert.equal(canonicalJsonDigest(body), digest, "artifact digest mismatch");
  return value;
}
async function implementationPins() {
  const files = {
    workflow: new URL("./killbill-coding-task.mjs", import.meta.url),
    profile: new URL("./killbill-status-profile.mjs", import.meta.url),
    sandbox: new URL("../../legacy/dsh-eval-lab/src/process/strict-runner.ts", import.meta.url),
    canonical: new URL("../../packages/weave/src/canonical-json.ts", import.meta.url),
    store: new URL("../../packages/weave/src/capsule/artifact-store.ts", import.meta.url),
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, path]) => [name, sha256Hex(await readFile(path))]),
    ),
  );
}

export async function prepareCodingTask({ parentRoot, dependencyRoot, jdkHome }) {
  if (platform() !== "darwin") throw new Error("only the macOS component profile is supported");
  const parent = await physicalRoot(parentRoot);
  const depsRoot = await physicalRoot(dependencyRoot);
  const jdk = await realpath(jdkHome);
  const sources = await loadStatusSources();
  const taskText = await readFile(
    new URL("../../packages/weave/examples/killbill-status-coding/TASK.md", import.meta.url),
    "utf8",
  );
  const dependencyBytes = {};
  for (const [name, digest] of Object.entries(dependencies)) {
    const bytes = await physicalBytes(depsRoot, name);
    assert.equal(sha256Hex(bytes), digest, `dependency drift: ${name}`);
    dependencyBytes[name] = bytes;
  }
  const environment = {
    profile: "killbill-status-java-component-v1",
    java_home: jdk,
    build_target: "11",
    editable_source: sourceRelative,
    note: "Use build/ for temporary compiler output; only src/PaymentTransactionInfoPluginConverter.java is admitted as the candidate. Network access is not provided by workspace-exec.",
  };
  const publicFiles = {
    "TASK.md": Buffer.from(taskText),
    LICENSE: Buffer.from(sources.license),
    "ENVIRONMENT.json": Buffer.from(`${canonicalJson(environment)}\n`),
    ...Object.fromEntries(
      Object.entries(dependencyBytes).map(([name, bytes]) => [`lib/${name}`, bytes]),
    ),
  };
  const definition = {
    task_id: "killbill-plugin-status-null-regression",
    task_version: "0.1.0-local.1",
    claim_scope: "component_code_artifact_only",
    task_text: taskText,
    baseline_source: sources.variants.seeded_regression,
    editable_source: sourceRelative,
    protected_files: Object.fromEntries(
      Object.entries(publicFiles).map(([name, bytes]) => [name, sha256Hex(bytes)]),
    ),
    provenance: {
      core_revision: sources.revision,
      source_path: sources.sourcePath,
      core_source_sha256: sha256Hex(sources.reference),
      historical_issue: "https://github.com/killbill/killbill/issues/366",
      historical_fix: "f6e13d42af033ac09305d8206fb800ee072b2239",
      derivation:
        "historical null-switch regression explicitly reintroduced into pinned 0.24.21 component; not the 2015 environment",
    },
    environment: {
      ...environment,
      host: host(),
      fingerprint: await fingerprintJdk(jdk),
      dependencies,
    },
    oracle: { driver, expected, timeout_ms: 15000, protocol: "nonce-framed-method-returns-v1" },
    implementation: await implementationPins(),
    qualification: "not_qualified",
  };
  const task = envelope({ format: "killbill-coding-task-v1", definition });
  const root = await mkdtemp(join(parent, "killbill-coding."));
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "build"), { recursive: true, mode: 0o700 });
  for (const [name, bytes] of Object.entries(publicFiles)) {
    await put(join(workspace, name), bytes);
  }
  await put(join(workspace, sourceRelative), definition.baseline_source);
  for (const [name, bytes] of Object.entries(dependencyBytes))
    await put(join(root, "control", "dependencies", name), bytes);
  await putJson(join(root, "control", "task.json"), task);
  // Health check happens before any unknown candidate is admitted.
  const probe = await executeStatusSource({
    source: definition.baseline_source,
    workspace: join(root, "control", "preparation"),
    dependencyDirectory: join(root, "control", "dependencies"),
    jdk,
  });
  const ready =
    probe.measurement_valid &&
    probe.mismatches.length === 2 &&
    probe.mismatches.every(
      (row) =>
        row.input === "NULL_STATUS" && row.observed === "THREW:java.lang.NullPointerException",
    );
  await putJson(
    join(root, "control", "preparation.json"),
    envelope({ format: "killbill-coding-preparation-v1", task_digest: task.digest, ready, probe }),
  );
  if (!ready) throw new Error(`preparation invalid; retained evidence in ${root}`);
  return {
    root,
    workspace,
    task_digest: task.digest,
    source: join(workspace, sourceRelative),
    qualification: "not_qualified",
    agent_execution: "not_observed",
  };
}

async function loadTask(taskRoot) {
  const root = await physicalRoot(taskRoot);
  const task = checkedEnvelope(
    JSON.parse((await physicalBytes(root, "control/task.json")).toString("utf8")),
    "killbill-coding-task-v1",
  );
  assert.equal(task.definition.task_id, "killbill-plugin-status-null-regression");
  assert.equal(task.definition.editable_source, sourceRelative);
  assert.deepEqual(Object.keys(task.definition.protected_files).sort(), [...protectedPaths].sort());
  assert.deepEqual(
    task.definition.implementation,
    await implementationPins(),
    "implementation drift: prepare a new task instead of silently changing the grader",
  );
  const preparation = checkedEnvelope(
    JSON.parse((await physicalBytes(root, "control/preparation.json")).toString("utf8")),
    "killbill-coding-preparation-v1",
  );
  assert.equal(preparation.task_digest, task.digest);
  assert.equal(preparation.ready, true, "task preparation is not ready");
  return { root, task };
}

async function inspectWorkspace(root, definition) {
  const workspace = join(root, "workspace");
  const seen = [];
  const allowed = new Set([...protectedPaths, sourceRelative]);
  const walk = async (directory, prefix = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`workspace symlink denied: ${path}`);
      if (entry.isDirectory()) {
        if (path === "build") continue; // Never ingested or executed; evaluator builds its own outputs.
        if (path !== "src" && path !== "lib")
          throw new Error(`unexpected workspace directory: ${path}`);
        await walk(join(directory, entry.name), path);
      } else {
        if (!entry.isFile() || !allowed.has(path))
          throw new Error(`unexpected workspace input: ${path}`);
        seen.push(path);
      }
    }
  };
  assert.equal(await realpath(workspace), workspace, "workspace symlink denied");
  await walk(workspace);
  assert.deepEqual(seen.sort(), [...allowed].sort(), "workspace input set changed");
  for (const path of protectedPaths) {
    assert.equal(
      sha256Hex(await physicalBytes(workspace, path)),
      definition.protected_files[path],
      `protected input drift: ${path}`,
    );
  }
  return physicalBytes(workspace, sourceRelative, 256 * 1024);
}

export async function submitCodingSource(taskRoot) {
  const { root, task } = await loadTask(taskRoot);
  const bytes = await inspectWorkspace(root, task.definition);
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const submission = envelope({
    format: "killbill-coding-submission-v1",
    task_digest: task.digest,
    source_path: sourceRelative,
    source_sha256: sha256Hex(bytes),
    source,
    provenance: "unattested_code_submission",
  });
  const path = join(root, "control", "submissions", `${submission.digest}.json`);
  await putJson(path, submission);
  return { digest: submission.digest, task_digest: task.digest, path };
}

export async function runWorkspaceCommand(taskRoot, command) {
  if (typeof command !== "string" || !command || command.length > 32768)
    throw new Error("invalid workspace command");
  const { root, task } = await loadTask(taskRoot);
  const workspace = join(root, "workspace");
  assert.equal(await realpath(workspace), workspace, "workspace symlink denied");
  // env is deliberately /usr/bin/env: the legacy runner grants executable ancestors.
  // Using /bin/sh as its top-level executable would grant '/' and defeat read isolation.
  return new StrictProcessRunner().run({
    executable: "/usr/bin/env",
    args: ["/bin/sh", "-c", command],
    cwd: workspace,
    readableRoots: [task.definition.environment.java_home, dirname(dirname(process.execPath))],
    writableRoot: workspace,
    timeoutMs: 15000,
    maxOutputBytes: 128 * 1024,
  });
}

export async function evaluateSubmission(taskRoot, submissionDigest) {
  assert.match(submissionDigest, hashPattern, "invalid submission digest");
  const { root, task } = await loadTask(taskRoot);
  const candidate = checkedEnvelope(
    JSON.parse(
      (await physicalBytes(root, `control/submissions/${submissionDigest}.json`)).toString("utf8"),
    ),
    "killbill-coding-submission-v1",
  );
  assert.equal(candidate.digest, submissionDigest);
  assert.equal(candidate.task_digest, task.digest, "submission belongs to a different frozen task");
  assert.equal(candidate.source_path, sourceRelative);
  assert.equal(sha256Hex(candidate.source), candidate.source_sha256);
  const definition = task.definition;
  assert.deepEqual(definition.environment.host, host(), "host profile drift");
  assert.deepEqual(
    await fingerprintJdk(definition.environment.java_home),
    definition.environment.fingerprint,
    "JDK drift",
  );
  assert.deepEqual(definition.environment.dependencies, dependencies);
  for (const [name, digest] of Object.entries(dependencies)) {
    assert.equal(
      sha256Hex(await physicalBytes(root, `control/dependencies/${name}`)),
      digest,
      "trusted dependency drift",
    );
  }
  await mkdir(join(root, "control", "executions"), { recursive: true, mode: 0o700 });
  const executionRoot = await mkdtemp(join(root, "control", "executions", "run."));
  const evidence = await executeStatusSource({
    source: candidate.source,
    workspace: executionRoot,
    dependencyDirectory: join(root, "control", "dependencies"),
    jdk: definition.environment.java_home,
    driverSource: definition.oracle.driver,
    expectations: definition.oracle.expected,
    timeoutMs: definition.oracle.timeout_ms,
  });
  const compileFailure =
    evidence.compile.exitCode === 1 &&
    evidence.compile.signal === null &&
    !evidence.compile.timedOut &&
    !evidence.compile.outputLimitExceeded;
  const result = {
    task_digest: task.digest,
    candidate_digest: candidate.digest,
    claim_scope: "component_code_artifact_only",
    agent_execution: "not_observed",
    qualification: "not_qualified",
    measurement_validity: evidence.measurement_valid || compileFailure ? "valid" : "invalid",
    verdict: compileFailure
      ? "fail"
      : evidence.measurement_valid
        ? evidence.mismatches.length === 0
          ? "pass"
          : "fail"
        : "inconclusive",
    diagnostic: compileFailure
      ? "candidate_compile_failure"
      : evidence.measurement_valid
        ? "method_returns_observed"
        : "observation_protocol_incomplete",
    mismatches: evidence.mismatches,
  };
  const run = envelope({ format: "killbill-coding-run-v1", task, candidate, evidence, result });
  const path = join(root, "control", "runs", `${run.digest}.json`);
  await putJson(path, run);
  return { digest: run.digest, path, result };
}

export async function replayCodingRun(path) {
  // Replay does not load current task files, grader code, JDK, workspace, or candidate executable.
  const parent = await physicalRoot(dirname(resolve(path)));
  const name = relative(parent, resolve(path));
  assert.match(name, /^[0-9a-f]{64}\.json$/);
  const run = checkedEnvelope(
    JSON.parse((await physicalBytes(parent, name)).toString("utf8")),
    "killbill-coding-run-v1",
  );
  assert.equal(run.digest, name.slice(0, -5));
  checkedEnvelope(run.task, "killbill-coding-task-v1");
  checkedEnvelope(run.candidate, "killbill-coding-submission-v1");
  assert.equal(run.candidate.task_digest, run.task.digest);
  assert.equal(run.result.task_digest, run.task.digest);
  assert.equal(run.result.candidate_digest, run.candidate.digest);
  assert.equal(sha256Hex(run.candidate.source), run.candidate.source_sha256);
  assert.equal(run.result.qualification, "not_qualified");
  assert.equal(run.result.claim_scope, "component_code_artifact_only");
  return run.result;
}
