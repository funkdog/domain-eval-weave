import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  readStableSessionTranscript,
  scanRawSessionInventory,
} from "../../legacy/dsh-eval-lab/src/carrier/session-inventory.ts";
import { fingerprintPackageClosure } from "../../legacy/dsh-eval-lab/src/fingerprint/deployment.ts";
import { decodeSessionJsonl } from "../../legacy/dsh-eval-lab/src/projector/jsonl.ts";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";
import { allowedTools } from "./dsh-coding-bridge.mjs";
import {
  evaluateSubmission,
  prepareCodingTask,
  submitCodingSource,
} from "./killbill-coding-task.mjs";

export const dshHome = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home";
const runtimeRoot = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
const dshModules = `${runtimeRoot}/phase3a-forward-acceptance/dsh-runtime/node_modules`;
const dshPackage = `${dshModules}/@deepseek-ai/dsh`;
const connectorPackage = `${dshHome}/profiles/eval-clowder-runner/node_modules/dsh-codex-connect`;
const workerPath = fileURLToPath(new URL("../run-dsh-coding-worker.mjs", import.meta.url));
const tsxPath = createRequire(import.meta.url).resolve("tsx");
const write = (path, value) =>
  writeExclusiveOrVerify(
    path,
    Buffer.from(`${canonicalJson(value)}\n`),
    () => new Error("run artifact collision"),
  );
const envelope = (body) => ({ ...body, digest: canonicalJsonDigest(body) });

async function adapterPins() {
  const paths = {
    coordinator: fileURLToPath(new URL(import.meta.url)),
    worker: workerPath,
    bridge: fileURLToPath(new URL("./dsh-coding-bridge.mjs", import.meta.url)),
    shutdown: fileURLToPath(new URL("./dsh-coding-shutdown.mjs", import.meta.url)),
    session_decoder: fileURLToPath(
      new URL("../../legacy/dsh-eval-lab/src/projector/jsonl.ts", import.meta.url),
    ),
    session_inventory: fileURLToPath(
      new URL("../../legacy/dsh-eval-lab/src/carrier/session-inventory.ts", import.meta.url),
    ),
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([name, path]) => [name, sha256Hex(await readFile(path))]),
    ),
  );
}
async function runtimePins() {
  const manifest = JSON.parse(await readFile(join(dshPackage, "package.json"), "utf8"));
  assert.equal(manifest.name, "@deepseek-ai/dsh");
  assert.equal(manifest.version, "0.1.0-rc.6");
  return {
    version: manifest.version,
    node_version: process.version,
    dsh_closure: await fingerprintPackageClosure(dshPackage),
    connector_closure: await fingerprintPackageClosure(connectorPackage),
  };
}

export async function prepareDshCodingRun({ parentRoot, dependencyRoot, jdkHome }) {
  const prepared = await prepareCodingTask({ parentRoot, dependencyRoot, jdkHome });
  const runRoot = await mkdtemp(join(prepared.root, "control", "dsh-run."));
  const manifestPath = join(runRoot, "launch.json");
  const task = JSON.parse(await readFile(join(prepared.root, "control", "task.json"), "utf8"));
  const body = {
    format: "weave-dsh-coding-launch-v1",
    runId: `coding-${randomUUID()}`,
    runRoot,
    taskRoot: prepared.root,
    taskDigest: task.digest,
    workspace: prepared.workspace,
    nodeExecutable: process.execPath,
    workerPath,
    tsxPath,
    dshModules,
    dshPackage,
    connectorPackage,
    model: { provider: "openai-codex", model: "gpt-5.6-sol", reasoningEffort: "xhigh" },
    limits: {
      wall_ms: 300000,
      shutdown_ms: 5000,
      max_model_requests: 12,
      max_tool_calls: 32,
      max_output_tokens_per_request: 8192,
    },
    task_text: `${task.definition.task_text}\n\n请直接在工作区修复源码。先阅读 src/PaymentTransactionInfoPluginConverter.java。你可以使用受限工具阅读、写入和编译；不要访问控制目录。完成后简要说明修改，不要自报评分或返回决策 JSON。`,
    system_prompt:
      "You are a software engineering agent. Complete the supplied Java component task using only the provided workspace tools. Public inputs live in the working directory. Do not access other paths or use network services. Submit your work by editing the allowed source file and then finish your response.",
    runtime: await runtimePins(),
    adapter: await adapterPins(),
    trusted_coordinator: "local-controller",
    qualification: "not_qualified",
  };
  await write(manifestPath, envelope(body));
  // Official boot consumes an explicit root, without CLI home patches, module healing or shared profile writes.
  await writeFile(join(runRoot, "cordis.yml"), "[]\n", { flag: "wx", mode: 0o600 });
  return {
    manifestPath,
    runRoot,
    taskRoot: prepared.root,
    taskDigest: task.digest,
    workspace: prepared.workspace,
  };
}

export async function loadLaunch(manifestPath) {
  const path = await realpath(manifestPath);
  assert.equal(path, resolve(manifestPath));
  const relation = relative(await realpath(runtimeRoot), path);
  assert.ok(relation && !relation.startsWith("..") && !relation.startsWith("/"));
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const { digest, ...body } = manifest;
  assert.equal(canonicalJsonDigest(body), digest, "launch manifest drift");
  assert.equal(manifest.format, "weave-dsh-coding-launch-v1");
  assert.equal(manifest.runRoot, dirname(path));
  assert.equal(manifest.dshModules, dshModules);
  assert.equal(manifest.connectorPackage, connectorPackage);
  assert.equal(manifest.workerPath, workerPath);
  assert.equal(manifest.nodeExecutable, process.execPath);
  assert.deepEqual(manifest.adapter, await adapterPins(), "adapter drift since prepare");
  assert.deepEqual(manifest.runtime, await runtimePins(), "DSH dependency drift since prepare");
  const task = JSON.parse(await readFile(join(manifest.taskRoot, "control", "task.json"), "utf8"));
  assert.equal(task.digest, manifest.taskDigest);
  return manifest;
}

export function composition(manifest, mode, manifestPath) {
  const row = (id, pkg, config = {}) => ({
    id,
    name: pathToFileURL(`${dshModules}/@deepseek-ai/${pkg}/lib/index.js`).href,
    config,
  });
  const rows = [
    row("llm", "dsh-llm"),
    row("session", "dsh-session"),
    row("system-prompt", "dsh-system-prompt", { persona: manifest.system_prompt }),
    row("tools", "dsh-tools", { mode: "native" }),
    row("agent", "dsh-agent"),
    row("agent-loop", "dsh-agent-loop", { agents: [], maxParallelToolCalls: 1 }),
    row("agent-default-model", "dsh-agent-default-model", {
      provider: manifest.model.provider,
      model: manifest.model.model,
    }),
    row("session-persistence-jsonl", "dsh-session-persistence-jsonl", {
      root: join(manifest.runRoot, "sessions", mode),
      compression: "none",
      packChunks: false,
    }),
    {
      id: "coding-bridge",
      name: new URL("./dsh-coding-bridge.mjs", import.meta.url).href,
      config: { manifestPath, mode },
    },
  ];
  if (mode === "live") {
    rows.push({
      id: "llm-openai-codex",
      name: pathToFileURL(`${connectorPackage}/lib/index.js`).href,
      config: { enableSearch: false, enableImageTool: false },
    });
    rows.push({
      ...row("headless-runner", "dsh-headless", { task: manifest.task_text }),
      inject: ["codingBridge"],
    });
  }
  return rows;
}

export async function executeDshCodingRun(manifestPath, mode) {
  assert.ok(mode === "preflight" || mode === "live");
  const manifest = await loadLaunch(manifestPath);
  if (mode === "live") {
    const preflight = JSON.parse(await readFile(join(manifest.runRoot, "preflight.json"), "utf8"));
    assert.equal(preflight.status, "preflight_verified", "model call requires completed preflight");
    assert.equal(preflight.launch_digest, manifest.digest);
    // Metadata only. The provider SDK owns normal credential use; the coordinator never opens the file.
    const stat = await lstat(join(dshHome, ".openai-codex-auth.json")).catch(() => null);
    if (
      !stat?.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600
    ) {
      throw new Error(
        "authorization_metadata_unavailable: use the existing provider login UI; no credential copy is permitted",
      );
    }
    const baseline = await submitCodingSource(manifest.taskRoot);
    const baselineSource = JSON.parse(await readFile(baseline.path, "utf8"));
    const frozenTask = JSON.parse(
      await readFile(join(manifest.taskRoot, "control", "task.json"), "utf8"),
    );
    assert.equal(
      baselineSource.source_sha256,
      sha256Hex(frozenTask.definition.baseline_source),
      "workspace is no longer the frozen starting point",
    );
  }
  const started = new Date().toISOString();
  const startedTick = performance.now();
  const invocationPath = join(manifest.runRoot, `${mode}-invocation.json`);
  await writeFile(
    invocationPath,
    `${canonicalJson({ mode, launch_digest: manifest.digest, started })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const child = spawn(process.execPath, ["--import", tsxPath, workerPath, manifestPath, mode], {
    cwd: manifest.workspace,
    detached: true,
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: "C",
      LC_ALL: "C",
      DSH_HOME: dshHome,
      DSH_TOOLS_MODE: "native",
      DSH_PERMISSION_MODE: "workspace-write",
      DSH_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  let count = 0;
  let limited = false;
  let timedOut = false;
  const killGroup = (signal) => {
    if (!Number.isSafeInteger(child.pid)) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  let killTimer;
  const terminate = () => {
    killGroup("SIGTERM");
    killTimer ??= setTimeout(() => killGroup("SIGKILL"), 2000);
    killTimer.unref();
  };
  const capture = (target) => (chunk) => {
    count += chunk.length;
    if (count <= 1024 * 1024) target.push(chunk);
    else {
      limited = true;
      terminate();
    }
  };
  child.stdout.on("data", capture(stdout));
  child.stderr.on("data", capture(stderr));
  const timer = setTimeout(
    () => {
      timedOut = true;
      terminate();
    },
    mode === "preflight" ? 30000 : manifest.limits.wall_ms,
  );
  const terminal = await new Promise((resolveResult) => {
    child.once("error", (error) =>
      resolveResult({ exitCode: null, signal: null, spawn_error: error.code ?? "SPAWN_FAILED" }),
    );
    child.once("close", (exitCode, signal) => resolveResult({ exitCode, signal }));
  }).finally(() => {
    clearTimeout(timer);
    clearTimeout(killTimer);
  });
  killGroup("SIGKILL"); // No surviving background writers are allowed to race the final snapshot.
  const processEvidence = {
    ...terminal,
    timedOut,
    outputLimitExceeded: limited,
    elapsed_ms: Math.max(0, Math.round(performance.now() - startedTick)),
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    started,
    ended: new Date().toISOString(),
  };
  await write(join(manifest.runRoot, `${mode}-process.json`), envelope(processEvidence));
  if (timedOut || limited || terminal.exitCode !== 0)
    throw new Error(`DSH ${mode} failed; inspect ${manifest.runRoot}/${mode}-process.json`);
  const result = JSON.parse(await readFile(join(manifest.runRoot, `${mode}.json`), "utf8"));
  assert.equal(result.launch_digest, manifest.digest);
  const shutdown = JSON.parse(
    await readFile(join(manifest.runRoot, `${mode}-shutdown.json`), "utf8"),
  );
  assert.equal(shutdown.launch_digest, manifest.digest);
  assert.equal(shutdown.status, "disposed");
  assert.equal(shutdown.exitCode, 0);
  if (mode === "preflight") return result;
  const inventory = await scanRawSessionInventory(join(manifest.runRoot, "sessions", "live"));
  assert.equal(inventory.length, 1, "expected exactly one fresh root Session");
  const session = inventory[0];
  assert.equal(session.id, result.session_id);
  assert.equal(session.cwd, manifest.workspace);
  assert.equal(session.delegationDepth, 0);
  const transcript = await readStableSessionTranscript(session.transcriptPath);
  const sessionSdk = await import(
    pathToFileURL(`${dshModules}/@deepseek-ai/dsh-session/lib/index.js`).href
  );
  const decoded = decodeSessionJsonl(transcript, sessionSdk.decodeStorageRecord);
  assert.equal(
    decoded.header.parentSession,
    undefined,
    "resumed or seeded Session is not a fresh coding attempt",
  );
  assert.ok(
    decoded.events.some(
      (event) =>
        event.type === "user/message" &&
        event.data.content?.some(
          (block) => block.type === "text" && block.text === manifest.task_text,
        ),
    ),
    "actual task input not found",
  );
  const headers = decoded.events.filter((event) => event.type === "request/header");
  assert.ok(headers.length > 0, "no observed model request");
  for (const event of headers) {
    assert.equal(event.data.header.config.provider, manifest.model.provider);
    assert.equal(event.data.header.config.model, manifest.model.model);
    assert.equal(event.data.header.config.reasoningEffort, manifest.model.reasoningEffort);
    assert.equal(event.data.header.config.maxTokens, manifest.limits.max_output_tokens_per_request);
    assert.deepEqual(
      event.data.header.tools.map((tool) => tool.name).sort(),
      [...allowedTools].sort(),
    );
  }
  const end = decoded.events.filter((event) => event.type === "turn/end").at(-1);
  assert.equal(end?.data.reason.kind, "completed", "Agent turn did not complete");
  const submission = await submitCodingSource(manifest.taskRoot);
  const evaluation = await evaluateSubmission(manifest.taskRoot, submission.digest);
  const receipt = envelope({
    format: "weave-dsh-coding-episode-v1",
    launch: manifest,
    session_id: session.id,
    transcript_sha256: sha256Hex(transcript),
    transcript,
    process: processEvidence,
    shutdown,
    bridge: result,
    submission,
    evaluation,
    provenance: "observed_in_trusted_local_dsh_run",
    qualification: "not_qualified",
    claim_scope: "one_public_component_coding_episode",
  });
  const receiptPath = join(manifest.runRoot, "coding-episode.json");
  await write(receiptPath, receipt);
  return {
    status: "coding_episode_recorded",
    receiptPath,
    sessionId: session.id,
    candidateDigest: submission.digest,
    evaluation: evaluation.result,
    qualification: "not_qualified",
  };
}
