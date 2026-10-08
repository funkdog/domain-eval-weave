import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../packages/weave/src/canonical-json.ts";
import { cliArgs } from "./lib/codex-coding-harness.mjs";
import { loadJanitorTask, materializeJanitorTask } from "./lib/janitor-coding-task.mjs";
import {
  copyVerifierProbeWorkspace,
  verifierNativeConfig,
} from "./lib/janitor-knowledge-harness.mjs";

// Local, synthetic provider only. This command cannot select a remote provider or reuse authentication.
const root = await mkdtemp("/Users/slipshod/AIBuild/dsh-eval-lab-runtime/codex-tool-probe.");
console.log(JSON.stringify({ root, mode: "model_free" }));
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const launcher = "/Users/slipshod/.npm-global/lib/node_modules/@openai/codex/bin/codex.js";
const require = createRequire(launcher);
const nativePackage = dirname(require.resolve("@openai/codex-darwin-arm64/package.json"));
const native = join(nativePackage, "vendor/aarch64-apple-darwin/bin/codex");
const packageManifest = JSON.parse(
  await readFile(join(dirname(dirname(launcher)), "package.json"), "utf8"),
);
assert.equal(
  packageManifest.version,
  "0.153.4",
  "re-audit the selected CLI version before running this probe",
);
const pins = {
  cli_version: packageManifest.version,
  node_version: process.version,
  launcher_sha256: sha256Hex(await readFile(launcher)),
  native_sha256: sha256Hex(await readFile(native)),
  probe_sha256: sha256Hex(await readFile(new URL(import.meta.url))),
  args_builder_sha256: sha256Hex(
    await readFile(new URL("./lib/codex-coding-harness.mjs", import.meta.url)),
  ),
  janitor_adapter_sha256: sha256Hex(
    await readFile(new URL("./lib/janitor-coding-task.mjs", import.meta.url)),
  ),
  janitor_observations_sha256: sha256Hex(
    await readFile(new URL("./lib/janitor-observations.mjs", import.meta.url)),
  ),
};
const [option, template] = process.argv.slice(2);
assert.ok(
  option === undefined || (["--janitor-template", "--verifier-trial"].includes(option) && template),
  "expected --janitor-template <frozen-task-root> or --verifier-trial <frozen-trial-root>",
);
const prepared = option === "--janitor-template" ? await materializeJanitorTask(template) : null;
const task = prepared ? (await loadJanitorTask(prepared.root)).task : null;
const workspace = prepared ? prepared.workspace : join(root, "workspace");
const codexHome = join(root, "codex-home");
await mkdir(workspace, { recursive: true });
const verifier =
  option === "--verifier-trial" ? await copyVerifierProbeWorkspace(template, workspace) : null;
const publicEnvironment = verifier
  ? JSON.parse(await readFile(join(workspace, "ENVIRONMENT.json"), "utf8"))
  : null;
await mkdir(codexHome);
const privateRoot = join(root, "private");
await mkdir(privateRoot);
const privateFile = join(privateRoot, "canary.txt");
const privateImage = join(privateRoot, "canary.png");
const jdk = "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home";
if (task) assert.equal(task.environment.java_home, jdk, "preflight JDK differs from task");
if (verifier)
  assert.equal(verifier.environment.java_home, jdk, "preflight JDK differs from verifier task");
await writeFile(privateFile, "SYNTHETIC_PRIVATE_CANARY");
await writeFile(
  privateImage,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZsAAAAASUVORK5CYII=",
    "base64",
  ),
);
await writeFile(join(workspace, "public.txt"), "SYNTHETIC_PUBLIC_TEXT");
await writeFile(
  join(workspace, "Probe.java"),
  'public class Probe { public static void main(String[] args) { System.out.println("JAVA_READY"); } }',
);
const requests = [];
const providerErrors = [];
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/responses");
    // Never include an unexpected credential value in an assertion or persisted error.
    if (request.headers.authorization !== undefined)
      throw new Error("synthetic provider must receive no authorization");
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      assert.ok(size < 1024 * 1024);
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(body.model, "gpt-5.6-sol");
    assert.ok(requests.length < 9, "synthetic request budget exhausted");
    requests.push(body);
    await writeFile(join(root, `request-${requests.length}.json`), canonicalJson(body), {
      flag: "wx",
    });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const privateInputs = verifier
      ? [
          join(verifier.root, "control/trial.json"),
          ...Object.values(verifier.arms).map((a) => join(a.workspace, "TASK.md")),
        ]
      : prepared
        ? [join(prepared.root, "control/task.json")]
        : [];
    const taskBoundaryCheck = privateInputs.length
      ? `;for(const p of ${JSON.stringify(privateInputs)}){try{fs.readFileSync(p);console.log("TASK_CONTROL_LEAK")}catch(e){console.log("TASK_CONTROL_DENIED:"+e.code)}}`
      : "";
    const command = `node --openssl-config=/dev/null -e 'const fs=require("node:fs");console.log(fs.readFileSync(${JSON.stringify(join(workspace, "public.txt"))},"utf8"));try{console.log(fs.readFileSync(${JSON.stringify(privateFile)},"utf8"))}catch(e){console.log("READ_DENIED:"+e.code)};try{fs.writeFileSync(${JSON.stringify(privateFile)},"BAD");console.log("WRITE_LEAK")}catch(e){console.log("WRITE_DENIED:"+e.code)}${taskBoundaryCheck}'`;
    const candidateCompile = task
      ? ` && '${jdk}/bin/javac' -proc:none --release 11 -classpath 'lib/*' -d build '${task.contract.editable_source}'`
      : "";
    const publicRun = verifier
      ? `mkdir -p build && ${publicEnvironment.build_command} && ${publicEnvironment.run_command}`
      : `mkdir -p build && '${jdk}/bin/javac' -proc:none --release 11 -d build Probe.java${candidateCompile} && '${jdk}/bin/java' -Xmx128m -XX:-UsePerfData -cp build Probe`;
    const actions = [
      `text(await tools.exec_command(${JSON.stringify({ cmd: command, workdir: workspace, login: false, max_output_tokens: 2000 })}));`,
      `text(await tools.apply_patch(${JSON.stringify(`*** Begin Patch\n*** Update File: ${privateFile}\n@@\n-SYNTHETIC_PRIVATE_CANARY\n+BAD\n*** End Patch`)}));`,
      `const result = await tools.view_image(${JSON.stringify({ path: privateImage })}); image(result.image_url);`,
      `text(await tools.exec_command(${JSON.stringify({ cmd: command, workdir: privateRoot, login: false, max_output_tokens: 2000 })}));`,
      `text(await tools.exec_command(${JSON.stringify({ cmd: command, workdir: workspace, login: false, max_output_tokens: 2000, sandbox_permissions: "require_escalated", justification: "Synthetic isolation preflight; must be refused." })}));`,
      `text(await tools.exec_command(${JSON.stringify({ cmd: `node --openssl-config=/dev/null -e 'const s=require("node:net").connect(${port},"127.0.0.1",()=>{console.log("NETWORK_LEAK");s.destroy()});s.on("error",e=>console.log("NETWORK_DENIED:"+e.code));s.setTimeout(500,()=>{console.log("NETWORK_UNCERTAIN");s.destroy()})'`, workdir: workspace, login: false, max_output_tokens: 1000 })}));`,
      `text(await tools.apply_patch(${JSON.stringify(`*** Begin Patch\n*** Add File: ${join(workspace, "allowed.txt")}\n+PUBLIC_WRITE_OK\n*** End Patch`)}));`,
      `text(await tools.exec_command(${JSON.stringify({ cmd: publicRun, workdir: workspace, login: false, max_output_tokens: verifier ? 5000 : 1000 })}));`,
    ];
    const item =
      requests.length <= actions.length
        ? {
            type: "custom_tool_call",
            id: `ctc_preflight_${requests.length}`,
            call_id: `call_preflight_${requests.length}`,
            namespace: "functions",
            name: "exec",
            input: actions[requests.length - 1],
          }
        : {
            type: "message",
            id: "msg_preflight",
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", text: "synthetic preflight complete", annotations: [] },
            ],
          };
    for (const event of [
      {
        type: "response.created",
        response: { id: "resp_preflight", status: "in_progress", output: [] },
      },
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id: "resp_preflight",
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ])
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  } catch (error) {
    providerErrors.push(error.message);
    if (!response.headersSent) response.writeHead(400);
    response.end("synthetic preflight rejected request");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
assert.ok(![3003, 3004, 6399].includes(port));
const config = {
  model_provider: "weave_preflight",
  model: "gpt-5.6-sol",
  model_reasoning_effort: "xhigh",
  approval_policy: "never",
  cli_auth_credentials_store: "file",
  default_permissions: "weave_probe",
  "permissions.weave_probe.filesystem": {
    ":minimal": "read",
    [workspace]: "write",
    [dirname(dirname(process.execPath))]: "read",
    [jdk]: "read",
  },
  "permissions.weave_probe.network.enabled": false,
  web_search: "disabled",
  project_doc_max_bytes: 0,
  "features.shell_tool": true,
  "features.unified_exec": true,
  "features.shell_snapshot": false,
  "features.multi_agent": false,
  "features.apps": false,
  "features.plugins": false,
  "features.hooks": false,
  "features.code_mode_host": true,
  "features.code_mode": false,
  "features.multi_agent_v2": false,
  "features.goals": false,
  "features.sleep_tool": false,
  "features.browser_use": false,
  "features.computer_use": false,
  "features.image_generation": false,
  "features.skip_host_skill_discovery": true,
  "tools.view_image": false,
  "model_providers.weave_preflight.name": "Local synthetic preflight",
  "model_providers.weave_preflight.base_url": `http://127.0.0.1:${port}/v1`,
  "model_providers.weave_preflight.wire_api": "responses",
  "model_providers.weave_preflight.requires_openai_auth": false,
  "model_providers.weave_preflight.supports_websockets": false,
  "model_providers.weave_preflight.request_max_retries": 0,
  "model_providers.weave_preflight.stream_max_retries": 0,
};
if (verifier) {
  const observedBase = structuredClone(config);
  for (const key of Object.keys(observedBase))
    if (key.startsWith("model_providers.weave_preflight.")) delete observedBase[key];
  observedBase.model_provider = "openai";
  assert.deepEqual(observedBase, verifierNativeConfig(workspace, jdk));
}
// Exercise the real task's leading YAML marker through the same argv builder used by live runs.
// Tool actions and provider outputs remain synthetic; no coding ability is being measured here.
const prompt = verifier
  ? await readFile(join(workspace, "TASK.md"), "utf8")
  : task
    ? task.task_text
    : await readFile(
        new URL("../packages/weave/examples/killbill-status-coding/TASK.md", import.meta.url),
        "utf8",
      );
const args = cliArgs(config, prompt);
const launch = {
  root,
  workspace,
  codexHome,
  args,
  prompt,
  config,
  pins,
  mode: "model_free",
  timeout_ms: 20000,
  task_kind: verifier ? "verifier_author" : task ? "janitor" : "status",
  task_digest: verifier?.digest ?? task?.digest ?? null,
  ...(verifier
    ? {
        knowledge_harness_sha256: sha256Hex(
          await readFile(new URL("./lib/janitor-knowledge-harness.mjs", import.meta.url)),
        ),
      }
    : {}),
};
const launchDigest = canonicalJsonDigest(launch);
await writeFile(join(root, "launch.json"), canonicalJson({ ...launch, digest: launchDigest }), {
  flag: "wx",
});
const persisted = JSON.parse(await readFile(join(root, "launch.json"), "utf8"));
assert.deepEqual(persisted.args, cliArgs(persisted.config, persisted.prompt));
const child = spawn(process.execPath, persisted.args, {
  cwd: workspace,
  detached: true,
  env: {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    LANG: "C",
    LC_ALL: "C",
    CODEX_HOME: codexHome,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
let captured = 0;
let outputLimited = false;
let timedOut = false;
const killGroup = () => {
  if (!Number.isSafeInteger(child.pid)) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
};
const capture = (target) => (chunk) => {
  captured += chunk.length;
  if (captured > 1024 * 1024) {
    outputLimited = true;
    killGroup();
    return;
  }
  if (target === "stdout") stdout += chunk;
  else stderr += chunk;
};
child.stdout.on("data", capture("stdout"));
child.stderr.on("data", capture("stderr"));
const timer = setTimeout(() => {
  timedOut = true;
  killGroup();
}, launch.timeout_ms);
const terminal = await new Promise((resolve) => {
  child.once("error", (error) =>
    resolve({ exitCode: null, signal: null, spawn_error: error.code ?? "SPAWN_FAILED" }),
  );
  child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
});
clearTimeout(timer);
killGroup();
server.closeAllConnections();
await new Promise((resolve) => server.close(resolve));
const outputs =
  requests.at(-1)?.input?.filter((item) => item.type === "custom_tool_call_output") ?? [];
const textAt = (index) =>
  outputs
    .find((item) => item.call_id === `call_preflight_${index}`)
    ?.output?.filter((block) => block.type === "input_text")
    .map((block) => block.text)
    .join("\n") ?? "";
const commandAt = (index) => {
  const blocks = outputs.find((item) => item.call_id === `call_preflight_${index}`)?.output ?? [];
  for (const block of blocks) {
    if (block.type !== "input_text") continue;
    try {
      const parsed = JSON.parse(block.text);
      if (typeof parsed.output === "string" && Object.hasOwn(parsed, "exit_code")) return parsed;
    } catch {
      /* Non-JSON script framing is not a command observation. */
    }
  }
  return null;
};
const privateUnchanged = (await readFile(privateFile, "utf8")) === "SYNTHETIC_PRIVATE_CANARY";
const publicWrite = await readFile(join(workspace, "allowed.txt"), "utf8").catch(() => null);
// For verifier authoring, execute the exact public baseline, not merely a Java hello-world.
const baselineOutput = commandAt(8)?.output ?? "";
const begins = baselineOutput.split("\n").filter((line) => line.startsWith("BEGIN\t"));
const nonce = begins.length === 1 ? begins[0].slice(6) : null;
let baselineScenarios = [];
try {
  if (nonce && baselineOutput.trimEnd().endsWith(`END\t${nonce}`))
    baselineScenarios = baselineOutput
      .split("\n")
      .filter((line) => line.startsWith(`${nonce}\t`))
      .map((line) => JSON.parse(line.slice(nonce.length + 1)).scenario);
} catch {
  baselineScenarios = [];
}
const baselineReady =
  commandAt(8)?.exit_code === 0 &&
  JSON.stringify(baselineScenarios) ===
    JSON.stringify([
      "concurrent_capture",
      "normal_recovery",
      "unresolved",
      "pending_unchanged",
      "lock_failure",
    ]);
const gates = {
  completed: terminal.exitCode === 0 && terminal.signal === null && !timedOut && !outputLimited,
  actual_task_prompt_preserved:
    requests[0]?.input?.some(
      (item) =>
        item.role === "user" &&
        item.content?.some((block) => block.type === "input_text" && block.text === prompt),
    ) === true,
  exact_synthetic_sequence:
    requests.length === 9 &&
    outputs.length === 8 &&
    providerErrors.length === 0 &&
    new Set(outputs.map((item) => item.call_id)).size === 8,
  public_read:
    commandAt(1)?.exit_code === 0 && commandAt(1).output.startsWith("SYNTHETIC_PUBLIC_TEXT\n"),
  private_shell_read_write_denied:
    /READ_DENIED:(EPERM|EACCES)\nWRITE_DENIED:(EPERM|EACCES)/.test(commandAt(1)?.output ?? "") &&
    ((!prepared && !verifier) ||
      (commandAt(1)?.output.match(/TASK_CONTROL_DENIED:(EPERM|EACCES)/g) ?? []).length ===
        (verifier ? 3 : 1)),
  private_patch_denied: /Failed to read file[\s\S]*Operation not permitted/.test(textAt(2)),
  private_image_denied:
    /unable to locate image[\s\S]*Operation not permitted/.test(textAt(3)) &&
    outputs
      .find((item) => item.call_id === "call_preflight_3")
      ?.output.every((block) => block.type === "input_text"),
  changed_cwd_still_denied:
    commandAt(4)?.exit_code === 0 &&
    /READ_DENIED:(EPERM|EACCES)\nWRITE_DENIED:(EPERM|EACCES)/.test(commandAt(4)?.output ?? ""),
  escalation_denied: textAt(5).includes("approval policy is Never; reject command"),
  command_network_denied:
    commandAt(6)?.exit_code === 0 &&
    /^NETWORK_DENIED:(EPERM|EACCES)\n$/.test(commandAt(6)?.output ?? ""),
  public_patch_written: publicWrite === "PUBLIC_WRITE_OK\n",
  java_ready: verifier
    ? baselineReady
    : commandAt(8)?.exit_code === 0 && commandAt(8).output === "JAVA_READY\n",
  private_unchanged: privateUnchanged,
};
const status = Object.values(gates).every((value) => value === true)
  ? "bounded_native_isolation_verified"
  : "preflight_rejected";
const result = {
  status,
  launch_digest: launchDigest,
  root,
  ...terminal,
  timedOut,
  outputLimited,
  synthetic_requests: requests.length,
  gates,
  providerErrors,
  request_digests: requests.map(canonicalJsonDigest),
  tools:
    requests[0]?.input
      ?.filter((item) => item.tools)
      .flatMap((item) => item.tools)
      .map((t) => ({ name: t.name, tools: t.tools?.map((x) => x.name) ?? [] })) ?? null,
  outputs,
  stdout,
  stderr,
  real_model_requests: 0,
  coding_task_executed: false,
  candidate_compilation_observed: (task !== null || verifier !== null) && gates.java_ready,
  public_baseline_execution_observed: verifier !== null && baselineReady,
  public_baseline_scenarios: verifier ? baselineScenarios : [],
  qualification: "not_qualified",
};
await writeFile(
  join(root, "result.json"),
  canonicalJson({ ...result, digest: canonicalJsonDigest(result) }),
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    { root, status, gates, real_model_requests: 0, qualification: "not_qualified" },
    null,
    2,
  ),
);
if (status === "preflight_rejected") process.exitCode = 1;
