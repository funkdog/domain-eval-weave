import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";

import {
  CarrierQualificationError,
  deploymentDigestForTask,
  executePreparedRealCampaign,
  prepareRealDeployment,
  qualifyCarrier,
} from "../campaign/real.js";
import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type CalibrationEvidence,
  parseCalibrationEvidence,
  type QualificationEvidence,
} from "../contracts/parsers.js";
import { ExposureLedger } from "../exposure/ledger.js";
import { PHASE2_INSTANCE } from "../instance.js";
import { loadStaticEvalBinding, materializeRegistryTask } from "../registry/loader.js";
import type { TaskPackIdentity } from "../task-pack/loader.js";
import { phase2TaskPackIdentity } from "./identity.js";
import { runPhase2Suite } from "./run.js";
import { runPhase2TaskCampaign } from "./task-campaign.js";

function runId(prefix: "suite" | "campaign", createdAt: string, suffix?: string): string {
  const timestamp = createdAt.replaceAll(/[^0-9]/g, "").slice(0, 14);
  return [prefix, timestamp, suffix, randomUUID().slice(0, 8)].filter(Boolean).join("-");
}

export async function runRealPhase2Suite(input: {
  readonly packageRoot: string;
  readonly timeoutMs: number;
  readonly confirm: (summary: string) => Promise<boolean>;
}): Promise<{
  readonly suiteId: string;
  readonly result: Awaited<ReturnType<typeof runPhase2Suite>>;
}> {
  const binding = await loadStaticEvalBinding(input.packageRoot);
  const deployment = await prepareRealDeployment(input.packageRoot);
  const ledger = new ExposureLedger(PHASE2_INSTANCE.instanceRoot);
  const holdout = binding.tasks.find((task) => task.bucket === "holdout");
  if (holdout === undefined) throw new Error("Phase 2 holdout Task is missing");
  await ledger.assertHoldoutUnexposed(holdout.task_id);

  const identities = new Map<string, TaskPackIdentity>();
  const taskDigests = new Map<string, string>();
  const calibrations = new Map<string, CalibrationEvidence>();
  for (const task of binding.tasks) {
    const identity = phase2TaskPackIdentity(task, deployment.pack);
    const taskPackDigest = canonicalJsonDigest(identity);
    const calibration = parseCalibrationEvidence(
      JSON.parse(
        await readFile(
          `${PHASE2_INSTANCE.instanceRoot}/calibration/${taskPackDigest}.json`,
          "utf8",
        ),
      ),
    );
    if (
      calibration.task_pack_digest !== taskPackDigest ||
      calibration.calibration_digest !== identity.pack.calibration_digest ||
      calibration.eval_package_sha256 !== deployment.evalPackageDigest
    ) {
      throw new Error(`Phase 2 calibration is stale for ${task.task_id}`);
    }
    identities.set(task.task_id, identity);
    taskDigests.set(task.task_id, taskPackDigest);
    calibrations.set(task.task_id, calibration);
  }

  const suiteDeploymentDigest = canonicalJsonDigest({
    schema_version: 1,
    instance_id: PHASE2_INSTANCE.id,
    harness_binding_digest: binding.digests.harness,
    registry_digest: binding.digests.registry,
    eval_pack_digest: binding.digests.evalPack,
    control_config_digest: deployment.controlConfigDigest,
    treatment_config_digest: deployment.treatmentConfigDigest,
    common_patch_digest: deployment.commonPatchDigest,
    dsh_package_tree_digest: deployment.dshPackageTreeDigest,
    codex_connect_digest: deployment.codexConnectDigest,
    eval_package_digest: deployment.evalPackageDigest,
    task_pack_digests: Object.fromEntries([...taskDigests.entries()].sort()),
  });
  const createdAt = new Date().toISOString();
  const suiteId = runId("suite", createdAt);
  const campaigns = new Map(
    binding.tasks.map((task) => [task.task_id, runId("campaign", createdAt, task.task_id)]),
  );
  let qualification: QualificationEvidence | undefined;
  await mkdir(`${PHASE2_INSTANCE.instanceRoot}/workspaces`, { recursive: true, mode: 0o700 });

  const result = await runPhase2Suite({
    instanceRoot: PHASE2_INSTANCE.instanceRoot,
    binding,
    suiteId,
    createdAt,
    deploymentDigest: suiteDeploymentDigest,
    timeoutMsPerArm: input.timeoutMs,
    triggerFirst: randomInt(2) === 0,
    campaignIdForTask: (task) => {
      const campaignId = campaigns.get(task.task_id);
      if (campaignId === undefined) throw new Error("Phase 2 Campaign id was not preallocated");
      return campaignId;
    },
    exposureLedger: ledger,
    beforeTasks: async () => {
      const confirmed = await input.confirm(
        `Run one cached read-only qualification and six model Episodes (three paired Tasks, max ${input.timeoutMs} ms per arm)?`,
      );
      if (!confirmed) throw new Error("Suite confirmation declined");
      try {
        qualification = await qualifyCarrier({
          launch: deployment.launch,
          packageRoot: deployment.packageRoot,
          commonPatch: deployment.commonPatch,
          controlPatch: deployment.controlPatch,
          deploymentDigest: suiteDeploymentDigest,
        });
      } catch {
        throw new CarrierQualificationError();
      }
    },
    runCampaign: async (plan, manifest) => {
      const taskPackIdentity = identities.get(plan.task.task_id);
      const taskPackDigest = taskDigests.get(plan.task.task_id);
      const calibration = calibrations.get(plan.task.task_id);
      if (!taskPackIdentity || !taskPackDigest || !calibration || !qualification) {
        throw new Error("Phase 2 Task execution evidence is incomplete");
      }
      const publicTask = await readFile(
        `${binding.packageRoot}/${plan.task.public_task_ref}`,
        "utf8",
      );
      const taskDeploymentDigest = deploymentDigestForTask(deployment, taskPackDigest);
      if (taskDeploymentDigest.length !== 64) {
        throw new Error("Phase 2 Task deployment digest is invalid");
      }
      const executed = await executePreparedRealCampaign({
        deployment,
        campaignId: plan.campaignId,
        createdAt: manifest.created_at,
        timeoutMs: manifest.timeout_ms_per_arm,
        taskPackIdentity,
        taskPackDigest,
        publicTask,
        calibration,
        qualification,
        materializeBase: (destination) =>
          materializeRegistryTask({
            packageRoot: binding.packageRoot,
            task: plan.task,
            destination,
          }),
        coordinate: (execution) =>
          runPhase2TaskCampaign({
            ...execution,
            suiteId: manifest.suite_id,
            task: plan.task,
            taskPackIdentity,
            publicTask,
            registryDigest: binding.digests.registry,
            bindingDigest: binding.digests.harness,
            exposureLedger: ledger,
          }),
      });
      return executed.result;
    },
  });
  return { suiteId, result };
}
