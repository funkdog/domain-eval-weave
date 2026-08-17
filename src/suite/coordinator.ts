import type { SuiteManifest, TaskEntry } from "../contracts/phase2.js";
import { parseSuiteManifest } from "../contracts/phase2.js";
import type { StaticEvalBinding } from "../registry/loader.js";

export interface PlannedSuiteTask {
  readonly task: TaskEntry;
  readonly campaignId: string;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function oneTask(binding: StaticEvalBinding, bucket: TaskEntry["bucket"]): TaskEntry {
  const matches = binding.tasks.filter((task) => task.bucket === bucket);
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(`Phase 2 requires exactly one ${bucket} Task`);
  }
  return matches[0];
}

export async function executePlannedSuite<T>(input: {
  readonly binding: StaticEvalBinding;
  readonly suiteId: string;
  readonly createdAt: string;
  readonly deploymentDigest: string;
  readonly timeoutMsPerArm: number;
  readonly triggerFirst: boolean;
  readonly campaignIdForTask: (task: TaskEntry) => string;
  readonly holdoutGate: {
    readonly reserveHoldout: (taskId: string, suiteId: string) => Promise<void>;
  };
  readonly freezeManifest: (manifest: SuiteManifest) => Promise<void>;
  readonly beforeTasks?: (manifest: SuiteManifest) => Promise<void>;
  readonly runTask: (plan: PlannedSuiteTask, manifest: SuiteManifest) => Promise<T>;
}): Promise<{
  readonly manifest: SuiteManifest;
  readonly results: readonly { readonly plan: PlannedSuiteTask; readonly result: T }[];
}> {
  const trigger = oneTask(input.binding, "trigger");
  const nonTrigger = oneTask(input.binding, "non-trigger");
  const holdout = oneTask(input.binding, "holdout");

  const order = input.triggerFirst
    ? [trigger, nonTrigger, holdout]
    : [nonTrigger, trigger, holdout];
  const plans = order.map((task) =>
    deepFreeze({
      task: structuredClone(task),
      campaignId: input.campaignIdForTask(task),
    }),
  );
  const manifest = deepFreeze(
    parseSuiteManifest({
      schema_version: 1,
      suite_id: input.suiteId,
      created_at: input.createdAt,
      instance_id: "clowder-ai",
      harness_binding_digest: input.binding.digests.harness,
      registry_digest: input.binding.digests.registry,
      eval_pack_digest: input.binding.digests.evalPack,
      deployment_digest: input.deploymentDigest,
      task_order: plans.map((plan) => plan.task.task_id),
      tasks: plans.map((plan) => ({
        task_id: plan.task.task_id,
        bucket: plan.task.bucket,
        campaign_id: plan.campaignId,
      })),
      timeout_ms_per_arm: input.timeoutMsPerArm,
      claim_strength: "multi_task_diagnostic",
      effect_claim_eligible: false,
    }),
  );
  await input.freezeManifest(manifest);
  await input.beforeTasks?.(manifest);
  await input.holdoutGate.reserveHoldout(holdout.task_id, input.suiteId);

  const results: { plan: PlannedSuiteTask; result: T }[] = [];
  for (const plan of plans) {
    results.push({ plan, result: await input.runTask(plan, manifest) });
  }
  return { manifest, results };
}
