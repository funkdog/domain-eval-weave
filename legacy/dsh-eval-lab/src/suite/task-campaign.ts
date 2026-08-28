import { TextDecoder } from "node:util";

import type { ArmEvaluationOutput, ArmExecutionOutput } from "../campaign/coordinator.js";
import { runPairedCampaign } from "../campaign/coordinator.js";
import {
  type ArtifactPointer,
  parseArtifactRef,
  writeCanonicalJsonArtifact,
} from "../contracts/artifacts.js";
import { sha256Hex } from "../contracts/canonical-json.js";
import type { ExperimentSpec, VariantSpec } from "../contracts/parsers.js";
import type { TaskEntry } from "../contracts/phase2.js";
import { parseExposureRecord } from "../contracts/phase2.js";
import { type ExposureLedger, phase2ExposureId } from "../exposure/ledger.js";
import { decodeOfficialSessionJsonl } from "../projector/jsonl.js";
import { projectGoalActivation } from "../projector/projector.js";
import type { TaskPackIdentity } from "../task-pack/loader.js";

function armRef(arm: "control" | "treatment", name: string): string {
  return `artifact://campaign/arms/${arm}/${name}`;
}

export type Phase2TaskCampaignResult = Awaited<ReturnType<typeof runPairedCampaign>> & {
  readonly phase2Pointers: {
    readonly activation: {
      readonly control: ArtifactPointer;
      readonly treatment: ArtifactPointer;
    };
    readonly exposure: { readonly control: ArtifactPointer; readonly treatment: ArtifactPointer };
  };
};

export async function runPhase2TaskCampaign(input: {
  readonly suiteId: string;
  readonly campaignRoot: string;
  readonly experiment: ExperimentSpec;
  readonly variants: {
    readonly control: VariantSpec;
    readonly treatment: VariantSpec;
  };
  readonly task: TaskEntry;
  readonly taskPackIdentity: TaskPackIdentity;
  readonly publicTask: string;
  readonly registryDigest: string;
  readonly bindingDigest: string;
  readonly exposureLedger: ExposureLedger;
  readonly executeArm: (arm: "control" | "treatment") => Promise<ArmExecutionOutput>;
  readonly evaluateArm: (
    arm: "control" | "treatment",
    output: ArmExecutionOutput,
  ) => Promise<ArmEvaluationOutput>;
}): Promise<Phase2TaskCampaignResult> {
  if (
    sha256Hex(input.publicTask) !== input.task.public_task_sha256 ||
    input.taskPackIdentity.public_task_sha256 !== input.task.public_task_sha256 ||
    input.taskPackIdentity.oracle_runner_sha256 !== input.task.oracle.runner_sha256 ||
    input.taskPackIdentity.pack.base_tree_sha256 !== input.task.effective_base_sha256
  ) {
    throw new Error("Phase 2 Task and Phase 1 Campaign identity disagree");
  }

  const phase2Pointers: {
    activation: Partial<Record<"control" | "treatment", ArtifactPointer>>;
    exposure: Partial<Record<"control" | "treatment", ArtifactPointer>>;
  } = { activation: {}, exposure: {} };
  const result = await runPairedCampaign({
    campaignRoot: input.campaignRoot,
    experiment: input.experiment,
    variants: input.variants,
    taskPackIdentity: input.taskPackIdentity,
    publicTask: input.publicTask,
    executeArm: async (arm) => {
      const output = await input.executeArm(arm);
      const exposure = parseExposureRecord({
        schema_version: 1,
        exposure_id: phase2ExposureId(input.suiteId, input.task.task_id, arm),
        suite_id: input.suiteId,
        campaign_id: input.experiment.campaign_id,
        episode_id: `${input.experiment.campaign_id}-${arm}`,
        session_id: output.sessionId,
        task_id: input.task.task_id,
        bucket: input.task.bucket,
        arm,
        variant_digest:
          arm === "control"
            ? input.experiment.control_variant_digest
            : input.experiment.treatment_variant_digest,
        public_task_sha256: input.task.public_task_sha256,
        effective_base_sha256: input.task.effective_base_sha256,
        candidate_archive: {
          ref: parseArtifactRef(armRef(arm, "candidate.tar")),
          sha256: sha256Hex(output.candidateArchive),
        },
        registry_digest: input.registryDigest,
        binding_digest: input.bindingDigest,
        started_at: output.process.started_at,
        ended_at: output.process.ended_at,
      });
      await input.exposureLedger.write(exposure);
      const sessionText =
        typeof output.sessionLog === "string"
          ? output.sessionLog
          : new TextDecoder("utf-8", { fatal: true }).decode(output.sessionLog);
      const activation = projectGoalActivation(decodeOfficialSessionJsonl(sessionText));
      const [activationPointer, exposurePointer] = await Promise.all([
        writeCanonicalJsonArtifact(input.campaignRoot, armRef(arm, "activation.json"), activation),
        writeCanonicalJsonArtifact(input.campaignRoot, armRef(arm, "exposure.json"), exposure),
      ]);
      phase2Pointers.activation[arm] = activationPointer;
      phase2Pointers.exposure[arm] = exposurePointer;
      return output;
    },
    evaluateArm: input.evaluateArm,
  });
  const { control: controlActivation, treatment: treatmentActivation } = phase2Pointers.activation;
  const { control: controlExposure, treatment: treatmentExposure } = phase2Pointers.exposure;
  if (!controlActivation || !treatmentActivation || !controlExposure || !treatmentExposure) {
    throw new Error("Phase 2 activation/exposure pointers are incomplete");
  }
  return {
    ...result,
    phase2Pointers: {
      activation: { control: controlActivation, treatment: treatmentActivation },
      exposure: { control: controlExposure, treatment: treatmentExposure },
    },
  };
}
