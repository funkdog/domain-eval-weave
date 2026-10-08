import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { readStableSessionTranscript } from "../../legacy/dsh-eval-lab/src/carrier/session-inventory.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";
import {
  evaluateJanitorSubmission,
  materializeJanitorTask,
  replayJanitorRun,
  submitJanitorSource,
} from "./janitor-coding-task.mjs";
import {
  evaluateSubmission,
  prepareCodingTask,
  replayCodingRun,
  submitCodingSource,
} from "./killbill-coding-task.mjs";

function taskAdapter(kind) {
  if (kind === "status")
    return { submit: submitCodingSource, evaluate: evaluateSubmission, replay: replayCodingRun };
  if (kind === "janitor")
    return {
      submit: submitJanitorSource,
      evaluate: evaluateJanitorSubmission,
      replay: replayJanitorRun,
    };
  throw new Error("unsupported local coding task kind");
}

const runtime = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
const launcher = "/Users/slipshod/.npm-global/lib/node_modules/@openai/codex/bin/codex.js";
const nativePackage = dirname(
  createRequire(launcher).resolve("@openai/codex-darwin-arm64/package.json"),
);
const native = join(nativePackage, "vendor/aarch64-apple-darwin/bin/codex");
const bundledShell = join(nativePackage, "vendor/aarch64-apple-darwin/codex-resources/zsh/bin/zsh");
const write = (path, body) =>
  writeExclusiveOrVerify(
    path,
    Buffer.from(`${canonicalJson(body)}\n`),
    () => new Error("immutable Codex artifact collision"),
  );
const envelope = (body) => ({ ...body, digest: canonicalJsonDigest(body) });
const checked = (value) => {
  const { digest, ...body } = value;
  assert.equal(canonicalJsonDigest(body), digest, "artifact drift");
  return value;
};
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function physical(path) {
  const value = await realpath(path);
  assert.equal(value, resolve(path));
  const rel = relative(await realpath(runtime), value);
  assert.ok(rel && !rel.startsWith("..") && !rel.startsWith("/"));
  return value;
}
async function pins() {
  const manifest = await readJson(join(dirname(dirname(launcher)), "package.json"));
  assert.equal(manifest.version, "0.153.4");
  return {
    cli_version: manifest.version,
    node_version: process.version,
    launcher_sha256: sha256Hex(await readFile(launcher)),
    native_sha256: sha256Hex(await readFile(native)),
    probe_sha256: sha256Hex(
      await readFile(new URL("../probe-codex-coding-tools.mjs", import.meta.url)),
    ),
    adapter_sha256: sha256Hex(await readFile(new URL(import.meta.url))),
    args_builder_sha256: sha256Hex(await readFile(new URL(import.meta.url))),
    janitor_adapter_sha256: sha256Hex(
      await readFile(new URL("./janitor-coding-task.mjs", import.meta.url)),
    ),
    janitor_observations_sha256: sha256Hex(
      await readFile(new URL("./janitor-observations.mjs", import.meta.url)),
    ),
  };
}
async function authorizationMetadata(authHome) {
  // Do not open, hash or copy credentials. Only the native CLI performs normal authentication.
  const stat = await lstat(join(await physical(authHome), "auth.json"));
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600,
    "isolated authorization metadata must be regular, unlinked and owner-only",
  );
}
async function rolloutFiles(authHome) {
  const root = join(authHome, "sessions");
  try {
    return (await readdir(root, { recursive: true }))
      .filter((path) => /^.*rollout-[^/]+\.jsonl$/.test(path))
      .map((path) => join(root, path))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
export function cliArgs(config, prompt) {
  const args = [
    launcher,
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
  ];
  // Canonical manifest storage reorders both outer and nested object keys.
  // Build the argv representation from that same ordering before and after persistence.
  for (const [key, value] of Object.entries(JSON.parse(canonicalJson(config)))) {
    const toml =
      value && typeof value === "object"
        ? `{ ${Object.entries(value)
            .map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`)
            .join(", ")} }`
        : JSON.stringify(value);
    args.push("-c", `${key}=${toml}`);
  }
  args.push("--", prompt);
  return args;
}

export async function prepareCodexCodingRun({
  preflightRoot,
  authHome,
  dependencyRoot,
  jdkHome,
  janitorTemplate,
}) {
  const taskKind = janitorTemplate ? "janitor" : "status";
  preflightRoot = await physical(preflightRoot);
  authHome = await physical(authHome);
  await authorizationMetadata(authHome);
  const preflight = checked(await readJson(join(preflightRoot, "result.json")));
  const proof = checked(await readJson(join(preflightRoot, "launch.json")));
  assert.equal(preflight.launch_digest, proof.digest);
  assert.equal(preflight.status, "bounded_native_isolation_verified");
  assert.equal(preflight.real_model_requests, 0);
  assert.equal(preflight.coding_task_executed, false);
  assert.equal(Object.keys(preflight.gates).length, 13);
  assert.equal(preflight.gates.actual_task_prompt_preserved, true);
  assert.ok(Object.values(preflight.gates).every((value) => value === true));
  assert.equal(proof.task_kind ?? "status", taskKind, "preflight belongs to another task kind");
  const currentPins = await pins();
  for (const [key, value] of Object.entries(proof.pins))
    assert.equal(currentPins[key], value, `preflight pin drift: ${key}`);
  const prepared = janitorTemplate
    ? await materializeJanitorTask(janitorTemplate)
    : await prepareCodingTask({ parentRoot: runtime, dependencyRoot, jdkHome });
  const task = checked(await readJson(join(prepared.root, "control/task.json")));
  const definition = taskKind === "janitor" ? task : task.definition;
  if (taskKind === "janitor") assert.equal(proof.task_digest, task.digest, "preflight task drift");
  const runRoot = await mkdtemp(join(prepared.root, "control/codex-run."));
  const config = structuredClone(proof.config);
  for (const key of Object.keys(config))
    if (key.startsWith("model_providers.weave_preflight.")) delete config[key];
  config.model_provider = "openai";
  const fsKey = "permissions.weave_probe.filesystem";
  assert.equal(config[fsKey][proof.workspace], "write");
  assert.equal(config[fsKey][definition.environment.java_home], "read");
  delete config[fsKey][proof.workspace];
  config[fsKey][prepared.workspace] = "write";
  const prompt =
    definition.task_text +
    "\n\n请直接修改允许的 Java 源码；使用公开环境文件中的绝对 JDK 路径。仅在该公开工作区开发，不访问其他路径、不联网、不请求提权或委派子 Agent。完成后结束本轮，不自报分数。";
  const manifest = envelope({
    format: "weave-codex-coding-launch-v1",
    runRoot,
    taskRoot: prepared.root,
    workspace: prepared.workspace,
    task_digest: task.digest,
    task_kind: taskKind,
    authHome,
    pins: currentPins,
    preflight_root: preflightRoot,
    preflight_digest: preflight.digest,
    config,
    prompt,
    args: cliArgs(config, prompt),
    budgets: { wall_ms: 300000, output_bytes: 1024 * 1024 },
    scope: "one_public_component_coding_episode",
    qualification: "not_qualified",
  });
  const path = join(runRoot, "launch.json");
  await write(path, manifest);
  return { path, digest: manifest.digest, task_digest: task.digest, runRoot };
}

export function validateNativeTranscript(raw, stdout, manifest) {
  const rows = raw.trim().split("\n").map(JSON.parse);
  const metas = rows.filter((row) => row.type === "session_meta");
  assert.equal(metas.length, 1);
  const meta = metas[0].payload;
  assert.equal(meta.cwd, manifest.workspace);
  assert.equal(meta.model_provider, manifest.config.model_provider);
  assert.equal(meta.cli_version, manifest.pins.cli_version);
  assert.equal(meta.source, "exec");
  assert.equal(meta.forked_from_id, undefined);
  const cli = stdout.trim().split("\n").map(JSON.parse);
  const threads = cli.filter((row) => row.type === "thread.started");
  assert.equal(threads.length, 1);
  assert.equal(threads[0].thread_id, meta.id);
  assert.equal(cli.filter((row) => row.type === "turn.completed").length, 1);
  const contexts = rows.filter((row) => row.type === "turn_context");
  assert.ok(contexts.length > 0);
  for (const { payload: c } of contexts) {
    assert.equal(c.cwd, manifest.workspace);
    assert.deepEqual(c.workspace_roots, [manifest.workspace]);
    assert.equal(c.model, manifest.config.model);
    assert.equal(c.effort, manifest.config.model_reasoning_effort);
    assert.equal(c.approval_policy, "never");
    assert.equal(c.active_permission_profile.id, manifest.config.default_permissions);
    assert.equal(c.permission_profile.file_system.type, "restricted");
    assert.equal(c.permission_profile.network, "restricted");
    const expected = new Map(Object.entries(manifest.config["permissions.weave_probe.filesystem"]));
    for (const entry of c.permission_profile.file_system.entries) {
      const path =
        entry.path.type === "special" && entry.path.value.kind === "minimal"
          ? ":minimal"
          : entry.path.path;
      if (expected.has(path)) {
        assert.equal(entry.access, expected.get(path));
        expected.delete(path);
      } else {
        const arg0 =
          typeof path === "string" ? relative(join(manifest.authHome, "tmp/arg0"), path) : "";
        assert.ok(
          entry.access === "read" && (path === bundledShell || /^codex-arg0[^/]+$/.test(arg0)),
          "unexpected native permission expansion",
        );
      }
    }
    assert.equal(expected.size, 0, "missing expected permission entries");
  }
  assert.ok(
    rows.some(
      (row) =>
        row.type === "response_item" &&
        row.payload.role === "user" &&
        row.payload.content?.some(
          (block) => block.type === "input_text" && block.text === manifest.prompt,
        ),
    ),
    "actual task prompt missing",
  );
  const complete = rows.filter(
    (row) => row.type === "event_msg" && row.payload.type === "task_complete",
  );
  assert.equal(complete.length, 1);
  const calls = rows.filter(
    (row) =>
      row.type === "response_item" &&
      ["custom_tool_call", "function_call"].includes(row.payload.type),
  );
  assert.ok(calls.length > 0, "no observed tool activity");
  assert.ok(
    !calls.some(
      (row) =>
        row.payload.namespace === "collaboration" ||
        /spawn_agent|followup_task/.test(row.payload.name ?? ""),
    ),
    "delegated episode not supported",
  );
  const outputs = rows.filter(
    (row) =>
      row.type === "response_item" &&
      ["custom_tool_call_output", "function_call_output"].includes(row.payload.type),
  );
  for (const call of calls)
    assert.equal(
      outputs.filter((row) => row.payload.call_id === call.payload.call_id).length,
      1,
      "incomplete tool result binding",
    );
  return {
    session_id: meta.id,
    rows,
    calls: calls.length,
    recorded_model_responses: rows.filter((row) => row.type === "token_usage_record").length,
    duration_ms: complete[0].payload.duration_ms,
  };
}

export {
  authorizationMetadata as checkNativeAuthorizationMetadata,
  physical as nativeRuntimePath,
  pins as nativeRuntimePins,
};

// Shared native process/Session recorder; callers own their task-specific admission and observations.
export async function recordNativeSession(manifest) {
  assert.deepEqual(manifest.pins, await pins(), "runtime or adapter drift since prepare");
  assert.deepEqual(manifest.args, cliArgs(manifest.config, manifest.prompt));
  assert.equal(manifest.config.model_provider, "openai");
  assert.equal(manifest.config.cli_auth_credentials_store, "file");
  await authorizationMetadata(manifest.authHome);
  const before = await rolloutFiles(manifest.authHome);
  await writeFile(
    join(manifest.runRoot, "invocation.json"),
    canonicalJson({
      launch_digest: manifest.digest,
      started: new Date().toISOString(),
      sessions_before: before,
    }),
    { flag: "wx", mode: 0o600 },
  );
  const processEvidence = await captureNativeProcess(manifest);
  assert.ok(
    processEvidence.exitCode === 0 &&
      !processEvidence.timedOut &&
      !processEvidence.outputLimited &&
      !processEvidence.interruptedBy,
    `native run failed; inspect ${manifest.runRoot}/process.json`,
  );
  const added = (await rolloutFiles(manifest.authHome)).filter((path) => !before.includes(path));
  assert.equal(added.length, 1, "expected exactly one new native Session");
  await physical(added[0]);
  const raw = await readStableSessionTranscript(added[0]);
  const observed = validateNativeTranscript(raw, processEvidence.stdout, manifest);
  return { processEvidence, raw, observed };
}

// Also used by model-free native transport probes; no credential handling in this primitive.
export async function captureNativeProcess(manifest) {
  const wallMs = manifest.budgets.wall_ms;
  assert.ok(
    wallMs === null || (Number.isSafeInteger(wallMs) && wallMs > 0),
    "explicit wall budget required",
  );
  assert.ok(
    Number.isSafeInteger(manifest.budgets.output_bytes) && manifest.budgets.output_bytes > 0,
  );
  const child = spawn(process.execPath, manifest.args, {
    cwd: manifest.workspace,
    detached: true,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      LANG: "C",
      LC_ALL: "C",
      CODEX_HOME: manifest.authHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = performance.now();
  const stdoutChunks = [];
  const stderrChunks = [];
  let bytes = 0,
    timedOut = false,
    outputLimited = false;
  const killGroup = () => {
    if (!Number.isSafeInteger(child.pid)) return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  };
  // A completion-led run has no task timer; an operator/platform stop must still stop its children.
  let interruptedBy = null;
  const onTerm = () => {
    interruptedBy = "SIGTERM";
    killGroup();
  };
  const onInt = () => {
    interruptedBy = "SIGINT";
    killGroup();
  };
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  process.once("exit", killGroup);
  const capture = (target) => (chunk) => {
    bytes += chunk.length;
    if (bytes > manifest.budgets.output_bytes) {
      outputLimited = true;
      killGroup();
      return;
    }
    if (target === "stdout") stdoutChunks.push(Buffer.from(chunk));
    else stderrChunks.push(Buffer.from(chunk));
  };
  child.stdout.on("data", capture("stdout"));
  child.stderr.on("data", capture("stderr"));
  const timer =
    wallMs === null
      ? null
      : setTimeout(() => {
          timedOut = true;
          killGroup();
        }, wallMs);
  const terminal = await new Promise((resolveResult) => {
    child.once("error", (e) =>
      resolveResult({ exitCode: null, signal: null, spawn_error: e.code ?? "SPAWN_FAILED" }),
    );
    child.once("close", (exitCode, signal) => resolveResult({ exitCode, signal }));
  });
  if (timer !== null) clearTimeout(timer);
  process.removeListener("SIGTERM", onTerm);
  process.removeListener("SIGINT", onInt);
  process.removeListener("exit", killGroup);
  killGroup();
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  const processEvidence = {
    ...terminal,
    timedOut,
    outputLimited,
    ...(interruptedBy ? { interruptedBy } : {}),
    elapsed_ms: Math.round(performance.now() - start),
    stdout,
    stderr,
  };
  await write(join(manifest.runRoot, "process.json"), envelope(processEvidence));
  return processEvidence;
}

export async function runCodexCoding(manifestPath) {
  await physical(manifestPath);
  const manifest = checked(await readJson(manifestPath));
  assert.equal(manifest.format, "weave-codex-coding-launch-v1");
  assert.equal(manifest.runRoot, dirname(resolve(manifestPath)));
  const kind = manifest.task_kind ?? "status";
  const adapter = taskAdapter(kind);
  const baseline = await adapter.submit(manifest.taskRoot);
  const task = checked(await readJson(join(manifest.taskRoot, "control/task.json")));
  const definition = kind === "janitor" ? task : task.definition;
  assert.equal(task.digest, manifest.task_digest);
  assert.equal(
    (await readJson(baseline.path)).source,
    definition.baseline_source,
    "workspace no longer at frozen baseline",
  );
  const { processEvidence, raw, observed } = await recordNativeSession(manifest);
  const submission = await adapter.submit(manifest.taskRoot);
  const evaluation = await adapter.evaluate(manifest.taskRoot, submission.digest);
  assert.deepEqual(await adapter.replay(evaluation.path), evaluation.result);
  const episode = envelope({
    format: "weave-codex-coding-episode-v1",
    launch: manifest,
    process: processEvidence,
    session_id: observed.session_id,
    transcript: raw,
    transcript_sha256: sha256Hex(raw),
    recorded_model_responses: observed.recorded_model_responses,
    tool_calls: observed.calls,
    agent_duration_ms: observed.duration_ms,
    submission,
    evaluation,
    provenance: "observed_in_trusted_local_codex_run",
    source_binding: "snapshot_of_single_run_workspace_after_process_stop",
    qualification: "not_qualified",
    claim_scope: manifest.scope,
  });
  const path = join(manifest.runRoot, "coding-episode.json");
  await write(path, episode);
  return {
    status: "coding_episode_recorded",
    path,
    digest: episode.digest,
    session_id: observed.session_id,
    tool_calls: observed.calls,
    evaluation: evaluation.result,
    qualification: "not_qualified",
  };
}
