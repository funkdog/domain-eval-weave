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
      reserveHoldout: async (taskId, suiteId) => {
        events.push(`gate:${taskId}:${suiteId}`);
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
    "ledger-concurrency-v1",
  ]);
  assert.deepEqual(events, [
    "gate:ledger-concurrency-v1:suite-fixed",
    "plan:ledger-audit-v1",
    "plan:ledger-full-v1",
    "plan:ledger-concurrency-v1",
    "freeze",
    "prepare",
    "run:ledger-audit-v1",
    "run:ledger-full-v1",
    "run:ledger-concurrency-v1",
  ]);
  assert.deepEqual(
    result.results.map((entry) => entry.result),
    [
      { taskId: "ledger-audit-v1" },
      { taskId: "ledger-full-v1" },
      { taskId: "ledger-concurrency-v1" },
    ],
  );
});

test("holdout rejection occurs before planning or model execution", async () => {
  const binding = await loadStaticEvalBinding(packageRoot);
  let calls = 0;
  await assert.rejects(
    executePlannedSuite({
      binding,
      suiteId: "suite-rejected",
      createdAt: "2026-08-18T00:00:00.000Z",
      deploymentDigest: "b".repeat(64),
      timeoutMsPerArm: 2_700_000,
      triggerFirst: true,
      campaignIdForTask: () => {
        calls += 1;
        return "campaign-never";
      },
      holdoutGate: {
        reserveHoldout: async () => {
          throw new Error("holdout was exposed");
        },
      },
      freezeManifest: async () => {
        calls += 1;
      },
      runTask: async () => {
        calls += 1;
        return undefined;
      },
    }),
    /holdout was exposed/,
  );
  assert.equal(calls, 0);
});
