import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { LEDGER_BEHAVIORS, LedgerOracle } from "../../src/oracle/ledger.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { loadStaticEvalBinding, materializeRegistryTask } from "../../src/registry/loader.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

test("all three Registry buckets calibrate in their frozen directions", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/phase2-bucket-calibration-`);
  const binding = await loadStaticEvalBinding(packageRoot);
  const oracle = new LedgerOracle({
    runner: new StrictProcessRunner(),
    oracleRunnerPath: `${packageRoot}/task-packs/open-coding-ts-ledger-v1/oracle/runner.mjs`,
  });
  try {
    const vectors: Record<string, Awaited<ReturnType<typeof oracle.evaluateDirectory>>> = {};
    for (const task of binding.tasks) {
      const candidate = `${scratch}/${task.task_id}`;
      await materializeRegistryTask({ packageRoot, task, destination: candidate });
      vectors[task.task_id] = await oracle.evaluateDirectory(
        candidate,
        1729,
        `${scratch}/checks-${task.task_id}`,
      );
    }

    assert.deepEqual(
      Object.entries(vectors["ledger-full-v1"] ?? {})
        .filter(([, status]) => status !== "pass")
        .map(([behavior]) => behavior),
      [...LEDGER_BEHAVIORS],
    );
    assert.equal(
      Object.values(vectors["ledger-audit-v1"] ?? {}).every((status) => status === "pass"),
      true,
    );
    assert.deepEqual(
      Object.entries(vectors["ledger-release-recovery-v1"] ?? {})
        .filter(([, status]) => status !== "pass")
        .map(([behavior]) => behavior),
      ["restart_recovery"],
    );
    assert.equal(Object.values(vectors).flatMap(Object.values).includes("error"), false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
