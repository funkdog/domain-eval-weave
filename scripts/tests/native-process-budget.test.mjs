import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import { captureNativeProcess } from "../lib/codex-coding-harness.mjs";

async function syntheticProcess(wallMs) {
  const root = await mkdtemp("/Users/slipshod/AIBuild/dsh-eval-lab-runtime/native-budget-check.");
  return captureNativeProcess({
    workspace: root,
    runRoot: root,
    authHome: root,
    args: ["-e", "setTimeout(() => process.stdout.write('completed\\n'), 80)"],
    budgets: { wall_ms: wallMs, output_bytes: 4096 },
  });
}

test("explicit null wall budget waits for natural completion", async () => {
  const result = await syntheticProcess(null);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "completed\n");
  assert.equal(result.timedOut, false);
});

test("existing finite wall budget still stops an over-budget child", async () => {
  const result = await syntheticProcess(10);
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGKILL");
});
