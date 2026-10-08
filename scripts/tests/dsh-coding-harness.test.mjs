import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import test from "node:test";
import { allowedTools, createWorkspaceDefinitions } from "../lib/dsh-coding-bridge.mjs";
import { executeDshCodingRun, prepareDshCodingRun } from "../lib/dsh-coding-harness.mjs";

test("Coding bridge validates file writes and never offers submission or grading tools", async () => {
  const calls = [];
  const definitions = createWorkspaceDefinitions({
    taskRoot: "/unused",
    nodeExecutable: process.execPath,
    invoke: async (_root, command) => {
      calls.push(command);
      return {
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        signal: null,
        timedOut: false,
        outputLimitExceeded: false,
      };
    },
    record: async () => {},
  });
  assert.deepEqual(definitions.map((entry) => entry.name).sort(), [...allowedTools].sort());
  const write = definitions.find((entry) => entry.name === "workspace_write");
  await assert.rejects(
    write.execute({ path: "../control/task.json", content: "bad" }),
    /only the candidate source/,
  );
  await assert.rejects(
    write.execute({
      path: "src/PaymentTransactionInfoPluginConverter.java",
      content: "ok",
      extra: "bad",
    }),
    /argument/,
  );
  assert.equal(calls.length, 0);
  await write.execute({
    path: "src/PaymentTransactionInfoPluginConverter.java",
    content: "' ; $(echo not-a-command)",
  });
  assert.equal(calls.length, 1);
});

test("real DSH boots a three-tool Coding profile and proves isolation without a model request", async () => {
  const parent = await mkdtemp("/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-coding-test.");
  const prepared = await prepareDshCodingRun({
    parentRoot: parent,
    dependencyRoot: process.env.KILLBILL_DEPS_DIR,
    jdkHome: process.env.KILLBILL_JDK_HOME,
  });
  const result = await executeDshCodingRun(prepared.manifestPath, "preflight");
  assert.equal(result.status, "preflight_verified");
  assert.equal(result.model_requests, 0);
  assert.equal(result.isolation.public_read, true);
  assert.equal(result.isolation.private_read_denied, true);
  assert.equal(result.isolation.private_write_denied, true);
  assert.equal(result.isolation.native_tool_denied, true);
  assert.deepEqual(result.tools, [...allowedTools].sort());
  const task = JSON.parse(await readFile(`${prepared.taskRoot}/control/task.json`, "utf8"));
  assert.equal(task.digest, prepared.taskDigest);
});
