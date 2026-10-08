import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../packages/weave/src/capsule/artifact-store.ts";
import {
  captureNativeProcess,
  checkNativeAuthorizationMetadata,
  cliArgs,
  nativeRuntimePath,
  nativeRuntimePins,
  recordNativeSession,
  validateNativeTranscript,
} from "./lib/codex-coding-harness.mjs";
import { replayJanitorRun } from "./lib/janitor-coding-task.mjs";

const runtime = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
const repo = fileURLToPath(new URL("../", import.meta.url));
const envelope = (body) => ({ ...body, digest: canonicalJsonDigest(body) });
const checked = (value) => {
  const { digest, ...body } = value;
  assert.equal(canonicalJsonDigest(body), digest);
  return value;
};
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const put = async (path, value) => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeExclusiveOrVerify(
    path,
    Buffer.from(`${canonicalJson(value)}\n`),
    () => new Error("immutable trial collision"),
  );
};
const consumerPrompt =
  "你是第一次使用这个本地 Java 评测消费包的 Agent 消费者。仅凭 read_guide 返回的包内 README，使用 kit_command 完成一次保留初始缺陷源码的消费流程，从环境检查到准备、提交、验收与回放。不要修复 Java、不要审代码、不要调用其他模型或子 Agent；不通过终端绕开这两个工具。结束时用自然语言说明实际完成了什么、结果意味着什么，以及说明中任何不清楚或缺失之处。不要自报可用性分数，也不要把初始基座的业务失败误当成工具失效。";
const toolAuthorization = {
  operator_message_id: "0001788946676859-000030-078dc411",
  scope: "one_bounded_fresh_context_consumer_trial",
  server: "weave_consumer",
  tools: ["read_guide", "kit_command"],
  commands: ["doctor", "prepare", "submit", "evaluate", "replay"],
  max_live_wall_ms: 300000,
};
function assertToolAuthorization(config, authorization) {
  assert.deepEqual(authorization, toolAuthorization, "tool authorization scope differs");
  assert.equal(config.approval_policy, "never");
  assert.equal(config["permissions.weave_probe.network.enabled"], false);
  const server = config["mcp_servers.weave_consumer"];
  assert.deepEqual(server.enabled_tools, toolAuthorization.tools);
  assert.equal(server.default_tools_approval_mode, "prompt");
  const allowedKeys = ["mcp_servers.weave_consumer"];
  for (const name of toolAuthorization.tools) {
    const key = `mcp_servers.weave_consumer.tools.${name}.approval_mode`;
    allowedKeys.push(key);
    assert.equal(config[key], "approve", "exact authorized tool must be approved");
  }
  assert.deepEqual(
    Object.keys(config)
      .filter((key) => key.startsWith("mcp_servers."))
      .sort(),
    allowedKeys.sort(),
    "unexpected MCP server or tool override",
  );
}
async function consumerPins() {
  return {
    trial: sha256Hex(await readFile(new URL(import.meta.url))),
    broker: sha256Hex(
      await readFile(new URL("./lib/janitor-consumer-broker.mjs", import.meta.url)),
    ),
    transport: sha256Hex(await readFile(new URL("./janitor-consumer-mcp.mjs", import.meta.url))),
  };
}
async function copyKit(source, destination) {
  await nativeRuntimePath(source);
  const bytes = await readFile(join(source, "kit.json")),
    digest = sha256Hex(bytes);
  assert.equal((await readFile(join(source, "kit.sha256"), "utf8")).trim(), digest);
  const manifest = JSON.parse(bytes);
  for (const [name, pin] of Object.entries(manifest.files)) {
    assert.ok(name.split("/").every((p) => p && p !== "." && p !== ".."));
    await nativeRuntimePath(join(source, name));
    const data = await readFile(join(source, name));
    assert.equal(sha256Hex(data), pin.sha256);
    await mkdir(dirname(join(destination, name)), { recursive: true, mode: 0o700 });
    await writeExclusiveOrVerify(
      join(destination, name),
      data,
      () => new Error("kit copy collision"),
    );
  }
  await writeFile(join(destination, "kit.json"), bytes, { flag: "wx", mode: 0o600 });
  await writeFile(join(destination, "kit.sha256"), `${digest}\n`, { flag: "wx", mode: 0o600 });
  return { digest, task_digest: manifest.task_digest };
}
async function setup(sourceKit, basePreflight, authHome = null) {
  const base = checked(await readJson(join(await nativeRuntimePath(basePreflight), "launch.json")));
  const root = await mkdtemp(join(runtime, "janitor-consumer-trial."));
  const kitRoot = join(root, "kit"),
    workspace = join(root, "front"),
    brokerLogs = join(root, "broker-logs");
  await mkdir(workspace);
  await mkdir(brokerLogs);
  const kit = await copyKit(sourceKit, kitRoot);
  const home = authHome ?? join(root, "model-free-home");
  if (authHome) await checkNativeAuthorizationMetadata(authHome);
  else await mkdir(home);
  const config = structuredClone(base.config);
  assert.equal(config.model, "gpt-5.6-sol");
  assert.equal(config.model_reasoning_effort, "xhigh");
  assert.equal(config.approval_policy, "never");
  assert.equal(config["permissions.weave_probe.network.enabled"], false);
  for (const key of Object.keys(config)) if (key.startsWith("mcp_servers.")) delete config[key];
  config["permissions.weave_probe.filesystem"] = {
    ":minimal": "read",
    [workspace]: "write",
    [dirname(dirname(process.execPath))]: "read",
    "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home": "read",
  };
  config["mcp_servers.weave_consumer"] = {
    command: process.execPath,
    args: [
      "--import",
      "tsx",
      join(repo, "scripts/janitor-consumer-mcp.mjs"),
      kitRoot,
      brokerLogs,
      kit.digest,
    ],
    cwd: repo,
    required: true,
    startup_timeout_sec: 15,
    tool_timeout_sec: 90,
    enabled_tools: [...toolAuthorization.tools],
    default_tools_approval_mode: "prompt",
  };
  for (const name of toolAuthorization.tools)
    config[`mcp_servers.weave_consumer.tools.${name}.approval_mode`] = "approve";
  assertToolAuthorization(config, toolAuthorization);
  return {
    format: "weave-consumer-launch-v1",
    runRoot: root,
    workspace,
    kitRoot,
    kit_digest: kit.digest,
    task_digest: kit.task_digest,
    brokerLogs,
    authHome: home,
    pins: await nativeRuntimePins(),
    consumer_pins: await consumerPins(),
    tool_authorization: toolAuthorization,
    config,
    prompt: consumerPrompt,
    budgets: { wall_ms: 300000, output_bytes: 1024 * 1024 },
    qualification: "not_qualified",
  };
}
async function brokerEvents(root) {
  const events = [];
  let previous = null;
  for (const name of (await readdir(root)).filter((n) => /^\d{4}\.json$/.test(n)).sort()) {
    const event = checked(await readJson(join(root, name)));
    assert.equal(event.seq, events.length + 1);
    assert.equal(event.previous, previous);
    previous = event.digest;
    events.push(event);
  }
  assert.equal(events.length % 2, 0, "unfinished broker call");
  return events;
}
const cliValue = (event) => JSON.parse(JSON.parse(event.result.content[0].text).stdout);
async function probe(sourceKit, basePreflight) {
  const manifest = await setup(sourceKit, basePreflight);
  const requests = [],
    errors = [];
  let instance, submission, codeRun;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/responses");
      if (Object.hasOwn(req.headers, "authorization"))
        throw new Error("model-free provider received unexpected authentication");
      let bytes = 0;
      const chunks = [];
      for await (const c of req) {
        bytes += c.length;
        assert.ok(bytes < 1024 * 1024);
        chunks.push(c);
      }
      const body = JSON.parse(Buffer.concat(chunks));
      assert.equal(body.model, "gpt-5.6-sol");
      assert.ok(requests.length < 10);
      requests.push(body);
      await put(join(manifest.runRoot, `request-${requests.length}.json`), body);
      const index = requests.length - 1;
      if ([3, 4, 5].includes(index)) {
        const events = await brokerEvents(manifest.brokerLogs),
          last = events.at(-1);
        assert.equal(last.result.isError, false);
        if (index === 3) instance = cliValue(last);
        if (index === 4) submission = cliValue(last);
        if (index === 5) codeRun = cliValue(last);
      }
      const consumer = (tool, args) =>
        `text(await tools.mcp__weave_consumer__${tool}(${JSON.stringify(args)}));`;
      let action;
      if (index === 0) action = consumer("read_guide", {});
      if (index === 1) action = consumer("kit_command", { args: ["doctor"] });
      if (index === 2) action = consumer("kit_command", { args: ["prepare"] });
      if (index === 3) action = consumer("kit_command", { args: ["submit", instance.root] });
      if (index === 4)
        action = consumer("kit_command", { args: ["evaluate", instance.root, submission.digest] });
      if (index === 5) action = consumer("kit_command", { args: ["replay", codeRun.path] });
      if (index === 6)
        action = consumer("kit_command", { args: ["workspace-exec", manifest.workspace, "pwd"] });
      if (index === 7)
        action = consumer("kit_command", {
          args: ["replay", join(manifest.runRoot, "launch.json")],
        });
      if (index === 8) {
        const code = `const fs=require("node:fs");for(const p of ${JSON.stringify([join(manifest.kitRoot, "README.md"), join(manifest.runRoot, "launch.json")])}){try{fs.readFileSync(p);console.log("LEAK")}catch(e){console.log("DENIED:"+e.code)}}`;
        action = `text(await tools.exec_command(${JSON.stringify({ cmd: `${JSON.stringify(process.execPath)} --openssl-config=/dev/null -e '${code.replaceAll("'", "'\\''")}'`, workdir: manifest.workspace, login: false, max_output_tokens: 1000 })}));`;
      }
      const item = action
        ? {
            type: "custom_tool_call",
            id: `callitem_${index}`,
            call_id: `consumer_probe_${index}`,
            namespace: "functions",
            name: "exec",
            input: action,
          }
        : {
            type: "message",
            id: "complete",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "synthetic consumer transport complete",
                annotations: [],
              },
            ],
          };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of [
        {
          type: "response.created",
          response: { id: `response_${index}`, status: "in_progress", output: [] },
        },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: `response_${index}`,
            status: "completed",
            output: [item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      ])
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    } catch (error) {
      errors.push(error.message);
      if (!res.headersSent) res.writeHead(400);
      res.end("synthetic request rejected");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  assert.ok(![3003, 3004, 6399].includes(port));
  manifest.config.model_provider = "weave_preflight";
  manifest.config["model_providers.weave_preflight.base_url"] = `http://127.0.0.1:${port}/v1`;
  manifest.budgets.wall_ms = 30000;
  const launch = envelope({
    ...manifest,
    args: cliArgs(manifest.config, manifest.prompt),
    mode: "model_free",
  });
  await put(join(manifest.runRoot, "launch.json"), launch);
  console.log(JSON.stringify({ root: manifest.runRoot, mode: "model_free" }));
  let processEvidence;
  try {
    processEvidence = await captureNativeProcess(launch);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const events = await brokerEvents(manifest.brokerLogs);
  let nativeProjection = null;
  try {
    const sessionRoot = join(manifest.authHome, "sessions");
    const files = (await readdir(sessionRoot, { recursive: true })).filter((name) =>
      name.endsWith(".jsonl"),
    );
    assert.equal(files.length, 1);
    const raw = await readFile(join(sessionRoot, files[0]), "utf8");
    const observed = validateNativeTranscript(raw, processEvidence.stdout, launch);
    nativeProjection = {
      session_id: observed.session_id,
      tool_calls: observed.calls,
      transcript_sha256: sha256Hex(raw),
    };
  } catch (error) {
    errors.push(`native projection: ${error.message}`);
  }
  const finishes = events.filter((e) => e.phase === "finished");
  const outputs = requests.at(-1)?.input?.filter((x) => x.type === "custom_tool_call_output") ?? [];
  let privateReadResult = null;
  for (const block of outputs.find((x) => x.call_id === "consumer_probe_8")?.output ?? []) {
    if (block.type !== "input_text") continue;
    try {
      const parsed = JSON.parse(block.text);
      if (Object.hasOwn(parsed, "exit_code") && typeof parsed.output === "string")
        privateReadResult = parsed;
    } catch {
      /* Native code-mode framing is not a command result. */
    }
  }
  const deniedLines = privateReadResult?.output.trim().split("\n") ?? [];
  const gates = {
    native_projection_verified: nativeProjection !== null,
    native_completed:
      processEvidence.exitCode === 0 && !processEvidence.timedOut && !processEvidence.outputLimited,
    exact_synthetic_sequence:
      requests.length === 10 && errors.length === 0 && finishes.length === 8,
    prompt_preserved:
      requests[0]?.input?.some(
        (x) =>
          x.role === "user" &&
          x.content?.some((c) => c.type === "input_text" && c.text === consumerPrompt),
      ) === true,
    documented_commands_work:
      finishes.slice(0, 6).length === 6 &&
      finishes.slice(0, 6).every((e) => e.result.isError === false),
    baseline_result:
      codeRun?.result.measurement_validity === "valid" && codeRun?.result.verdict === "fail",
    replay_same:
      finishes[5]?.result.isError === false &&
      canonicalJson(cliValue(finishes[5])) === canonicalJson(codeRun?.result ?? null),
    shell_rejected: finishes[6]?.result.isError === true,
    foreign_run_rejected: finishes[7]?.result.isError === true,
    native_direct_private_reads_denied:
      privateReadResult?.exit_code === 0 &&
      deniedLines.length === 2 &&
      deniedLines.every((line) => /^DENIED:(EPERM|EACCES)$/.test(line)),
  };
  const result = envelope({
    format: "consumer-native-preflight-v1",
    launch_digest: launch.digest,
    gates,
    process: processEvidence,
    requests: requests.length,
    broker_events: events,
    errors,
    native_projection: nativeProjection,
    private_read_command: privateReadResult,
    real_model_requests: 0,
    consumer_observed: false,
    qualification: "not_qualified",
  });
  await put(join(manifest.runRoot, "preflight.json"), result);
  console.log(JSON.stringify({ root: manifest.runRoot, gates, real_model_requests: 0 }, null, 2));
  if (!Object.values(gates).every(Boolean)) processExit(1);
}
function processExit(code) {
  process.exitCode = code;
}
async function prepare(sourceKit, preflightRoot, authHome) {
  const preflight = checked(
    await readJson(join(await nativeRuntimePath(preflightRoot), "preflight.json")),
  );
  const proof = checked(await readJson(join(preflightRoot, "launch.json")));
  assert.equal(preflight.format, "consumer-native-preflight-v1");
  assert.equal(proof.mode, "model_free");
  assertToolAuthorization(proof.config, proof.tool_authorization);
  assert.equal(Object.keys(preflight.gates).length, 10);
  assert.equal(preflight.launch_digest, proof.digest);
  assert.ok(Object.values(preflight.gates).every(Boolean));
  assert.equal(preflight.real_model_requests, 0);
  assert.deepEqual(proof.pins, await nativeRuntimePins());
  assert.deepEqual(proof.consumer_pins, await consumerPins());
  const manifest = await setup(sourceKit, preflightRoot, authHome);
  assert.equal(manifest.kit_digest, proof.kit_digest);
  for (const key of Object.keys(manifest.config))
    if (key.startsWith("model_providers.weave_preflight.")) delete manifest.config[key];
  manifest.config.model_provider = "openai";
  const launch = envelope({
    ...manifest,
    args: cliArgs(manifest.config, manifest.prompt),
    preflight_digest: preflight.digest,
    preflight_root: preflightRoot,
    mode: "live",
  });
  await put(join(manifest.runRoot, "launch.json"), launch);
  console.log(
    JSON.stringify(
      {
        path: join(manifest.runRoot, "launch.json"),
        digest: launch.digest,
        kit_digest: launch.kit_digest,
        task_digest: launch.task_digest,
      },
      null,
      2,
    ),
  );
}
async function live(path) {
  await nativeRuntimePath(path);
  const launch = checked(await readJson(path));
  assert.equal(launch.format, "weave-consumer-launch-v1");
  assert.equal(launch.mode, "live");
  assertToolAuthorization(launch.config, launch.tool_authorization);
  assert.equal(launch.runRoot, dirname(path));
  assert.deepEqual(launch.consumer_pins, await consumerPins());
  assert.equal(launch.prompt, consumerPrompt);
  assert.equal(launch.budgets.wall_ms, 300000);
  assert.equal(launch.budgets.output_bytes, 1024 * 1024);
  const { processEvidence, raw, observed } = await recordNativeSession(launch);
  const events = await brokerEvents(launch.brokerLogs),
    finishes = events.filter((e) => e.phase === "finished");
  const paired = events
    .filter((e) => e.phase === "started")
    .map((start, i) => ({ start, end: finishes[i] }));
  const successful = paired.filter((p) => p.end.result.isError === false);
  const byCommand = (verb) =>
    successful.filter((p) => p.start.tool === "kit_command" && p.start.arguments.args[0] === verb);
  const evaluations = byCommand("evaluate"),
    replays = byCommand("replay");
  let codeRun = null,
    replayMatches = false,
    baselineUnchanged = false;
  if (evaluations.length === 1) {
    codeRun = cliValue(evaluations[0].end);
    const stored = checked(await readJson(codeRun.path));
    baselineUnchanged = stored.candidate.source === stored.task.baseline_source;
    assert.equal(stored.task.digest, launch.task_digest);
    assert.deepEqual(await replayJanitorRun(codeRun.path), codeRun.result);
    replayMatches = replays.some(
      (p) =>
        p.start.arguments.args[1] === codeRun.path &&
        canonicalJson(cliValue(p.end)) === canonicalJson(codeRun.result),
    );
  }
  const kitManifest = await readJson(join(launch.kitRoot, "kit.json"));
  let kitUnchanged =
    sha256Hex(await readFile(join(launch.kitRoot, "kit.json"))) === launch.kit_digest;
  for (const [name, pin] of Object.entries(kitManifest.files))
    if (sha256Hex(await readFile(join(launch.kitRoot, name))) !== pin.sha256) kitUnchanged = false;
  const observations = {
    guide_read: successful.some((p) => p.start.tool === "read_guide"),
    doctor_completed: byCommand("doctor").length > 0,
    one_instance: byCommand("prepare").length === 1,
    source_submitted: byCommand("submit").length > 0,
    one_baseline_evaluation: evaluations.length === 1 && baselineUnchanged,
    expected_baseline_failure:
      codeRun?.result.measurement_validity === "valid" && codeRun?.result.verdict === "fail",
    replay_completed: replayMatches,
    kit_unchanged: kitUnchanged,
  };
  const episode = envelope({
    format: "fresh-consumer-episode-v1",
    launch,
    process: processEvidence,
    session_id: observed.session_id,
    transcript: raw,
    transcript_sha256: sha256Hex(raw),
    tool_calls: observed.calls,
    recorded_model_responses: observed.recorded_model_responses,
    broker_events: events,
    observations,
    code_run: codeRun,
    consumer_completed: Object.values(observations).every(Boolean),
    fresh_context_agent_consumer_observed: true,
    independent_human_consumer_observed: false,
    author_supplied_adapter: true,
    author_messages_after_start: 0,
    qualification: "not_qualified",
  });
  await put(join(launch.runRoot, "consumer-episode.json"), episode);
  console.log(
    JSON.stringify(
      {
        path: join(launch.runRoot, "consumer-episode.json"),
        digest: episode.digest,
        session_id: episode.session_id,
        observations,
        consumer_completed: episode.consumer_completed,
        qualification: "not_qualified",
      },
      null,
      2,
    ),
  );
}
const [command, ...args] = process.argv.slice(2);
if (command === "preflight" && args.length === 2) await probe(...args);
else if (command === "prepare" && args.length === 3) await prepare(...args);
else if (command === "live" && args.length === 1) await live(args[0]);
else
  throw new Error(
    "preflight <kit> <base-native-preflight> | prepare <kit> <consumer-preflight> <isolated-auth-home> | live <launch.json>",
  );
