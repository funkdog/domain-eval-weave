import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../../src/contracts/canonical-json.js";
import { loadStaticEvalBinding } from "../../src/registry/loader.js";
import { executePlannedSuite } from "../../src/suite/coordinator.js";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

test("Suite freezes all Campaign ids and task order before executing without adaptive feedback", async () => {
  const binding = await loadStaticEvalBinding(packageRoot);
  const events: string[] = [];
  let frozenManifest = "";
  const result = await executePlannedSuite({
    binding,
    suiteId: "suite-fixed",
    createdAt: "2026-08-18T00:00:00.000Z",
    deploymentDigest: "a".repeat(64),
    timeoutMsPerArm: 2_700_000,
    triggerFirst: false,
    campaignIdForTask: (task) => {
      events.push(`plan:${task.task_id}`);
      return `campaign-${task.task_id}`;
    },
    holdoutGate: {
      reserveHoldout: async (identity, suiteId) => {
        events.push(`gate:${identity.task_id}:${suiteId}`);
      },
    },
    freezeManifest: async (manifest) => {
      events.push("freeze");
      frozenManifest = canonicalJson(manifest);
    },
    beforeTasks: async (manifest) => {
      events.push("prepare");
      assert.equal(canonicalJson(manifest), frozenManifest);
    },
    runTask: async (plan, manifest) => {
      events.push(`run:${plan.task.task_id}`);
      assert.equal(canonicalJson(manifest), frozenManifest);
      assert.throws(() => {
        (plan as { campaignId: string }).campaignId = "mutated";
      });
      return { taskId: plan.task.task_id };
    },
  });

  assert.deepEqual(result.manifest.task_order, [
    "ledger-audit-v1",
    "ledger-full-v1",
    "ledger-restart-recovery-v1",
  ]);
  assert.deepEqual(events, [
    "plan:ledger-audit-v1",
    "plan:ledger-full-v1",
    "plan:ledger-restart-recovery-v1",
    "freeze",
    "prepare",
    "gate:ledger-restart-recovery-v1:suite-fixed",
    "run:ledger-audit-v1",
    "run:ledger-full-v1",
    "run:ledger-restart-recovery-v1",
  ]);
  assert.deepEqual(
    result.results.map((entry) => entry.result),
    [
      { taskId: "ledger-audit-v1" },
      { taskId: "ledger-full-v1" },
      { taskId: "ledger-restart-recovery-v1" },
    ],
  );
});

test("holdout is reserved after confirmation and qualification but before model execution", async () => {
  const binding = await loadStaticEvalBinding(packageRoot);
  const events: string[] = [];
  await assert.rejects(
    executePlannedSuite({
      binding,
      suiteId: "suite-rejected",
      createdAt: "2026-08-18T00:00:00.000Z",
      deploymentDigest: "b".repeat(64),
      timeoutMsPerArm: 2_700_000,
      triggerFirst: true,
      campaignIdForTask: (task) => {
        events.push(`plan:${task.task_id}`);
        return `campaign-${task.task_id}`;
      },
      holdoutGate: {
        reserveHoldout: async () => {
          events.push("gate");
          throw new Error("holdout was exposed");
        },
      },
      freezeManifest: async () => {
        events.push("freeze");
      },
      beforeTasks: async () => {
        events.push("prepare");
      },
      runTask: async () => {
        events.push("run");
        return undefined;
      },
    }),
    /holdout was exposed/,
  );
  assert.deepEqual(events, [
    "plan:ledger-full-v1",
    "plan:ledger-audit-v1",
    "plan:ledger-restart-recovery-v1",
    "freeze",
    "prepare",
    "gate",
  ]);
});
