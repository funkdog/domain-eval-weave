import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../packages/weave/src/capsule/artifact-store.ts";
import { allowedTools } from "./lib/dsh-coding-bridge.mjs";
import { composition, dshHome, loadLaunch } from "./lib/dsh-coding-harness.mjs";
import { finishCodingWorker } from "./lib/dsh-coding-shutdown.mjs";

const [manifestPath, mode, ...extra] = process.argv.slice(2);
assert.ok(manifestPath && (mode === "preflight" || mode === "live") && extra.length === 0);
assert.equal(process.env.DSH_HOME, dshHome);
const manifest = await loadLaunch(manifestPath);
const bootModule = await import(
  pathToFileURL(`${manifest.dshModules}/@deepseek-ai/dsh-app-boot/lib/index.js`).href
);
let requestExit;
const finished = new Promise((resolveExit) => {
  requestExit = resolveExit;
});
let ctx;
let workerExitCode = 1;
const write = (value) =>
  writeExclusiveOrVerify(
    join(manifest.runRoot, `${mode}.json`),
    Buffer.from(`${canonicalJson(value)}\n`),
    () => new Error("worker receipt collision"),
  );
try {
  ctx = await bootModule.boot(
    "weave-coding",
    join(manifest.runRoot, "cordis.yml"),
    [{ insert: composition(manifest, mode, manifestPath) }],
    (host) => {
      host.provide("appExit", (code) => requestExit(code));
    },
  );
  if (mode === "preflight") {
    assert.deepEqual(
      ctx.tools
        .schemas()
        .map((tool) => tool.name)
        .sort(),
      [...allowedTools].sort(),
    );
    assert.equal(ctx.llm.listProviders().length, 0, "preflight must not load a model provider");
    const { agent } = await ctx.agents.create({
      sessionId: `session-${randomUUID()}`,
      meta: { cwd: manifest.workspace },
      agentOptions: { provider: manifest.model.provider, model: manifest.model.model },
    });
    await agent.whenIdle();
    const invoke = (name, args) =>
      ctx.tools.execute({
        callId: randomUUID(),
        name,
        arguments: args,
        agent,
        signal: AbortSignal.timeout(16000),
      });
    const publicRead = await invoke("workspace_read", { path: "TASK.md" });
    const unknown = await invoke("bash", { command: "pwd" });
    const privatePath = join(manifest.taskRoot, "control", "task.json");
    const before = await readFile(privatePath, "utf8");
    const code = `const fs=require("node:fs");try{fs.readFileSync(${JSON.stringify(privatePath)});console.log("READ_LEAK")}catch(e){console.log("READ_DENIED:"+e.code)};try{fs.writeFileSync(${JSON.stringify(privatePath)},"bad");console.log("WRITE_LEAK")}catch(e){console.log("WRITE_DENIED:"+e.code)}`;
    const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    const privateProbe = await invoke("workspace_exec", {
      command: `${shellQuote(process.execPath)} -e ${shellQuote(code)}`,
    });
    const publicText = JSON.stringify(publicRead);
    const privateText = JSON.stringify(privateProbe);
    const isolation = {
      public_read: publicText.includes("killbill-plugin-status-null-regression"),
      private_read_denied: /READ_DENIED:(EACCES|EPERM)/.test(privateText),
      private_write_denied: /WRITE_DENIED:(EACCES|EPERM)/.test(privateText),
      native_tool_denied: unknown.isError === true && ctx.tools.get("bash", agent) === undefined,
    };
    assert.equal(await readFile(privatePath, "utf8"), before);
    assert.ok(
      Object.values(isolation).every(Boolean),
      JSON.stringify({ isolation, publicRead, privateProbe, unknown }),
    );
    await ctx.sessions.flush(agent.session);
    await ctx.codingBridge.flush();
    const snapshot = ctx.codingBridge.snapshot();
    assert.equal(snapshot.model_requests, 0);
    await write({
      status: "preflight_verified",
      launch_digest: manifest.digest,
      isolation,
      ...snapshot,
    });
    console.log(JSON.stringify({ status: "preflight_verified", isolation }));
    workerExitCode = 0;
  } else {
    const exitCode = await finished;
    await ctx.codingBridge.flush();
    const snapshot = ctx.codingBridge.snapshot();
    await write({
      status: exitCode === 0 ? "headless_completed" : "headless_failed",
      launch_digest: manifest.digest,
      exitCode,
      ...snapshot,
    });
    workerExitCode = exitCode;
  }
} catch (error) {
  console.error(error);
} finally {
  await finishCodingWorker({
    exitCode: workerExitCode,
    timeoutMs: manifest.limits.shutdown_ms,
    flush: async () => {
      await ctx?.codingBridge?.flush();
      await Promise.all(
        [process.stdout, process.stderr].map(
          (stream) => new Promise((resolveFlush) => stream.write("", resolveFlush)),
        ),
      );
    },
    dispose: () => ctx?.fiber.dispose(),
    record: (shutdown) =>
      writeExclusiveOrVerify(
        join(manifest.runRoot, `${mode}-shutdown.json`),
        Buffer.from(`${canonicalJson({ ...shutdown, launch_digest: manifest.digest })}\n`),
        () => new Error("shutdown receipt collision"),
      ),
  });
}
