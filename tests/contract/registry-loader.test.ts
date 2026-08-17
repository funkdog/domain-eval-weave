import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadStaticEvalBinding, materializeRegistryTask } from "../../src/registry/loader.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { digestDirectory } from "../../src/task-pack/loader.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

test("static binding closes Harness, Registry, Eval Pack, and three Task digests", async () => {
  const binding = await loadStaticEvalBinding(packageRoot);

  assert.equal(binding.harness.eval_binding.registry_sha256, binding.digests.registry);
  assert.equal(binding.registry.eval_packs[0]?.sha256, binding.digests.evalPack);
  assert.deepEqual(
    binding.tasks.map((task) => [task.task_id, task.bucket]),
    [
      ["ledger-full-v1", "trigger"],
      ["ledger-audit-v1", "non-trigger"],
      ["ledger-concurrency-v1", "holdout"],
    ],
  );
  assert.deepEqual(
    new Set(binding.evalPack.task_ids),
    new Set(binding.tasks.map((task) => task.task_id)),
  );
});

test("Task materialization applies only declared base overlays", async () => {
  const binding = await loadStaticEvalBinding(packageRoot);
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/phase2-materialize-`);
  try {
    for (const task of binding.tasks) {
      const destination = `${scratch}/${task.task_id}`;
      await materializeRegistryTask({ packageRoot, task, destination });
      assert.equal(await digestDirectory(destination), task.effective_base_sha256);
      assert.match(await readFile(`${destination}/src/ledger.ts`, "utf8"), /ReservationLedger/);
      await assert.rejects(readFile(`${destination}/registry.json`));
      await assert.rejects(readFile(`${destination}/oracle/runner.mjs`));
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("static binding rejects a digest-drifted Registry before materialization", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/phase2-registry-tamper-`);
  try {
    for (const directory of ["harnesses", "registry", "eval-packs", "task-packs"]) {
      await cp(`${packageRoot}/${directory}`, `${scratch}/${directory}`, { recursive: true });
    }
    const taskPath = `${scratch}/registry/tasks/ledger-full-v1.json`;
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    await writeFile(
      taskPath,
      `${JSON.stringify({ ...task, activation_expectation: "forbidden" })}\n`,
    );
    await assert.rejects(loadStaticEvalBinding(scratch), /digest mismatch|activation expectation/i);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
