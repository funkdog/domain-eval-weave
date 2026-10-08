import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, canonicalJsonDigest } from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";
import { runWorkspaceCommand } from "./killbill-coding-task.mjs";

export const name = "weave-coding-bridge";
export const inject = ["tools", "agents"];
export const allowedTools = ["workspace_read", "workspace_write", "workspace_exec"];
const sourcePath = "src/PaymentTransactionInfoPluginConverter.java";
const publicTextFiles = new Set(["TASK.md", "ENVIRONMENT.json", "LICENSE", sourcePath]);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
function exactArguments(value, names) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...names].sort().join() ||
    names.some((key) => typeof value[key] !== "string")
  )
    throw new Error("invalid tool arguments");
}
const output = {
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["exitCode", "signal", "stdout", "stderr", "timedOut", "outputLimitExceeded"],
    properties: {
      exitCode: { oneOf: [{ type: "integer" }, { type: "null" }] },
      signal: { oneOf: [{ type: "string" }, { type: "null" }] },
      stdout: { type: "string" },
      stderr: { type: "string" },
      timedOut: { type: "boolean" },
      outputLimitExceeded: { type: "boolean" },
    },
  },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

export function createWorkspaceDefinitions({
  taskRoot,
  nodeExecutable,
  record,
  invoke = runWorkspaceCommand,
}) {
  const execute = async (tool, args, command) => {
    await record({ kind: "tool_started", tool, arguments: args });
    const result = await invoke(taskRoot, command);
    await record({ kind: "tool_finished", tool, result });
    return result;
  };
  return [
    {
      name: "workspace_read",
      description:
        "Read TASK.md, ENVIRONMENT.json, LICENSE or the candidate Java source in the public workspace.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: { path: { type: "string" } },
      },
      output,
      async execute(args) {
        exactArguments(args, ["path"]);
        if (!publicTextFiles.has(args.path))
          throw new Error("only public task text or candidate source can be read");
        const code = `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(args.path)},"utf8"))`;
        return execute("workspace_read", args, `${quote(nodeExecutable)} -e ${quote(code)}`);
      },
    },
    {
      name: "workspace_write",
      description:
        "Replace the candidate Java source with the supplied complete file content. Other paths are denied.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
      output,
      async execute(args) {
        exactArguments(args, ["path", "content"]);
        if (args.path !== sourcePath) throw new Error("only the candidate source can be written");
        if (Buffer.byteLength(args.content) > 20000)
          throw new Error("source exceeds this bridge's 20 KB write limit");
        const code = `require("node:fs").writeFileSync(${JSON.stringify(sourcePath)},${JSON.stringify(args.content)});process.stdout.write("source written\\n")`;
        return execute("workspace_write", args, `${quote(nodeExecutable)} -e ${quote(code)}`);
      },
    },
    {
      name: "workspace_exec",
      description:
        "Run a development shell command inside the public workspace sandbox. No network or private control access. Use build/ for compiler output; Java location is in ENVIRONMENT.json.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["command"],
        properties: { command: { type: "string" } },
      },
      output,
      async execute(args) {
        exactArguments(args, ["command"]);
        return execute("workspace_exec", args, args.command);
      },
    },
  ];
}

export async function apply(ctx, config) {
  const manifest = JSON.parse(await readFile(config.manifestPath, "utf8"));
  const { digest, ...body } = manifest;
  assert.equal(canonicalJsonDigest(body), digest, "launch manifest drift");
  const events = [];
  let tail = Promise.resolve();
  let modelRequests = 0;
  let toolCalls = 0;
  let sessionId;
  let previous = null;
  const record = (event) => {
    const item = { seq: events.length, previous, ...event };
    const digest = canonicalJsonDigest(item);
    previous = digest;
    events.push({ ...item, digest });
    tail = tail.then(async () => {
      const directory = join(manifest.runRoot, "bridge-events", config.mode);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeExclusiveOrVerify(
        join(directory, `${String(item.seq).padStart(6, "0")}.json`),
        Buffer.from(`${canonicalJson({ ...item, digest })}\n`),
        () => new Error("bridge event collision"),
      );
    });
    return tail;
  };
  for (const definition of createWorkspaceDefinitions({
    taskRoot: manifest.taskRoot,
    nodeExecutable: manifest.nodeExecutable,
    record,
  }))
    ctx.tools.register(definition);
  ctx.tools.guard((execution) => {
    if (!allowedTools.includes(execution.name))
      return "tool outside the frozen Coding capability set";
    if (++toolCalls > manifest.limits.max_tool_calls) return "Coding tool-call budget exhausted";
    return undefined;
  });
  const checkTools = (agent) => {
    const names = ctx.tools
      .schemas(agent)
      .map((tool) => tool.name)
      .sort();
    assert.deepEqual(names, [...allowedTools].sort(), "unexpected model-visible tool");
    return names;
  };
  ctx.on("agent/created", ({ agent }) => {
    if (sessionId !== undefined) throw new Error("Coding run allows exactly one fresh root Agent");
    sessionId = agent.session.id;
    void record({ kind: "agent_created", session_id: sessionId, tools: checkTools(agent) });
  });
  ctx.on("agent/request", async ({ agent, turn, step }, next) => {
    await tail;
    const proposed = await next();
    assert.equal(proposed.provider, manifest.model.provider, "model provider drift");
    assert.equal(proposed.model, manifest.model.model, "model identity drift");
    checkTools(agent);
    if (++modelRequests > manifest.limits.max_model_requests)
      throw new Error("Coding request budget exhausted");
    const selected = {
      ...proposed,
      reasoningEffort: manifest.model.reasoningEffort,
      maxTokens: manifest.limits.max_output_tokens_per_request,
    };
    await record({
      kind: "model_request",
      session_id: sessionId,
      turn,
      step,
      model: {
        provider: selected.provider,
        model: selected.model,
        reasoningEffort: selected.reasoningEffort,
        maxTokens: selected.maxTokens,
      },
    });
    return selected;
  });
  ctx.provide("codingBridge", {
    flush: () => tail,
    snapshot: () => ({
      session_id: sessionId ?? null,
      model_requests: modelRequests,
      tool_calls: toolCalls,
      tools: checkTools(),
      events: structuredClone(events),
    }),
  });
}
export default Object.assign(apply, { inject });
