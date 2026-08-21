import { TextDecoder } from "node:util";
import type { ArmExecutionOutput, CampaignPointers } from "../campaign/coordinator.js";
import { CampaignStateStore } from "../campaign/state.js";
import type { ArtifactPointer } from "../contracts/artifacts.js";
import {
  parseArtifactRef,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import type { VariantSpec } from "../contracts/parsers.js";
import type { CommerceBehaviorVector } from "../oracle/commerce-order.js";
import { assertSecretFreeText } from "../report/secret-scan.js";
import type { TaskPackIdentity } from "../task-pack/loader.js";
import {
  type CommerceEpisode,
  type CommerceExperiment,
  type CommercePairedEvaluation,
  type CommercePairedImpactReport,
  parseCommerceEpisode,
  parseCommercePairedEvaluation,
} from "./campaign-contracts.js";
import {
  buildCommercePairedImpactReport,
  combineCommerceValidity,
  renderCommercePairedReport,
} from "./campaign-report.js";
import { replayCommerceCampaign } from "./replay.js";
import { commerceEvaluationFromFrozenEvidence } from "./validity.js";

export interface CommerceArmEvaluationOutput {
  readonly behavior: CommerceBehaviorVector;
  readonly candidateTreeAfterOracle: string;
  readonly oracleSeed: {
    readonly schema_version: 2;
    readonly template_id: "commerce-order-cancellation-v1";
    readonly seed: number;
    readonly oracle_version: "commerce-order-oracle-v1";
  };
}

function armRef(arm: "control" | "treatment", name: string): string {
  return `artifact://campaign/arms/${arm}/${name}`;
}

async function persistCommerceArm(
  campaignRoot: string,
  arm: "control" | "treatment",
  output: ArmExecutionOutput,
) {
  const sessionText =
    typeof output.sessionLog === "string"
      ? output.sessionLog
      : new TextDecoder("utf-8", { fatal: true }).decode(output.sessionLog);
  assertSecretFreeText(sessionText);
  assertSecretFreeText(output.stdout ?? "");
  assertSecretFreeText(output.stderr ?? "");
  const [sessionPointer, archivePointer, stdoutPointer, stderrPointer, treePointer, patchPointer] =
    await Promise.all([
      writeArtifactBytes(campaignRoot, armRef(arm, "session.jsonl"), output.sessionLog),
      writeArtifactBytes(campaignRoot, armRef(arm, "candidate.tar"), output.candidateArchive),
      writeArtifactBytes(campaignRoot, armRef(arm, "stdout.txt"), output.stdout ?? ""),
      writeArtifactBytes(campaignRoot, armRef(arm, "stderr.txt"), output.stderr ?? ""),
      writeArtifactBytes(campaignRoot, armRef(arm, "candidate.tree"), `${output.candidateTree}\n`),
      writeArtifactBytes(campaignRoot, armRef(arm, "candidate.patch"), output.candidatePatch),
    ]);
  return {
    evidence: {
      session_log_ref: sessionPointer.ref,
      session_log_sha256: sessionPointer.sha256,
      candidate_tree: output.candidateTree,
      candidate_tree_ref: treePointer.ref,
      candidate_tree_sha256: treePointer.sha256,
      candidate_patch_ref: patchPointer.ref,
      candidate_patch_sha256: patchPointer.sha256,
      candidate_archive_ref: archivePointer.ref,
      candidate_archive_sha256: archivePointer.sha256,
      stdout_ref: stdoutPointer.ref,
      stdout_sha256: stdoutPointer.sha256,
      stderr_ref: stderrPointer.ref,
      stderr_sha256: stderrPointer.sha256,
    },
    archivePointer,
  };
}

export async function runCommercePairedCampaign(input: {
  readonly campaignRoot: string;
  readonly experiment: CommerceExperiment;
  readonly variants: { readonly control: VariantSpec; readonly treatment: VariantSpec };
  readonly taskPackIdentity: TaskPackIdentity;
  readonly publicTask: string;
  readonly executeArm: (arm: "control" | "treatment") => Promise<ArmExecutionOutput>;
  readonly evaluateArm: (
    arm: "control" | "treatment",
    output: ArmExecutionOutput,
  ) => Promise<CommerceArmEvaluationOutput>;
}): Promise<{
  readonly report: CommercePairedImpactReport;
  readonly pairedEvaluation: CommercePairedEvaluation;
  readonly pointers: CampaignPointers;
}> {
  if (
    input.taskPackIdentity.schema_version !== 2 ||
    input.taskPackIdentity.template_id !== "commerce-order-cancellation-v1"
  ) {
    throw new Error("Commerce Campaign requires the frozen commerce Task Pack identity");
  }
  for (const value of [
    input.experiment,
    input.variants.control,
    input.variants.treatment,
    input.taskPackIdentity,
  ]) {
    assertSecretFreeText(canonicalJson(value));
  }
  assertSecretFreeText(input.publicTask);
  const state = new CampaignStateStore(`${input.campaignRoot}/campaign-state.json`);
  await state.initialize(input.experiment.campaign_id);
  const [controlVariantPointer, treatmentVariantPointer, taskPackPointer, publicTaskPointer] =
    await Promise.all([
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        "artifact://campaign/variants/control.json",
        input.variants.control,
      ),
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        "artifact://campaign/variants/treatment.json",
        input.variants.treatment,
      ),
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        "artifact://campaign/task-pack/identity.json",
        input.taskPackIdentity,
      ),
      writeArtifactBytes(
        input.campaignRoot,
        "artifact://campaign/task-pack/public-task.md",
        input.publicTask,
      ),
    ]);
  if (
    controlVariantPointer.sha256 !== input.experiment.control_variant_digest ||
    treatmentVariantPointer.sha256 !== input.experiment.treatment_variant_digest ||
    taskPackPointer.sha256 !== input.experiment.task_pack_digest ||
    publicTaskPointer.sha256 !== input.taskPackIdentity.public_task_sha256
  ) {
    throw new Error("Commerce Experiment does not bind Task Pack and variants");
  }
  const experimentPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    "artifact://campaign/manifest.json",
    input.experiment,
  );
  await state.transition("qualified");
  const persisted = new Map<
    "control" | "treatment",
    Awaited<ReturnType<typeof persistCommerceArm>>
  >();
  const outputs = new Map<"control" | "treatment", ArmExecutionOutput>();
  try {
    for (let index = 0; index < input.experiment.arm_order.length; index += 1) {
      const arm = input.experiment.arm_order[index];
      if (arm === undefined) throw new Error("Commerce arm order is incomplete");
      await state.transition(index === 0 ? "arm_1_running" : "arm_2_running");
      const output = await input.executeArm(arm);
      outputs.set(arm, output);
      persisted.set(arm, await persistCommerceArm(input.campaignRoot, arm, output));
      await state.transition(index === 0 ? "arm_1_frozen" : "arm_2_frozen");
    }
    await state.transition("oracle_running");
    const control = persisted.get("control");
    const treatment = persisted.get("treatment");
    const controlOutput = outputs.get("control");
    const treatmentOutput = outputs.get("treatment");
    if (!control || !treatment || !controlOutput || !treatmentOutput) {
      throw new Error("Commerce Campaign requires both frozen arms");
    }
    const controlOracle = await input.evaluateArm("control", controlOutput);
    const treatmentOracle = await input.evaluateArm("treatment", treatmentOutput);
    if (canonicalJson(controlOracle.oracleSeed) !== canonicalJson(treatmentOracle.oracleSeed)) {
      throw new Error("Commerce arms do not share one Oracle seed");
    }
    const [seedPointer, controlBehaviorPointer, treatmentBehaviorPointer] = await Promise.all([
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        "artifact://campaign/oracle/seed.json",
        controlOracle.oracleSeed,
      ),
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        "artifact://campaign/oracle/control/behavior.json",
        {
          schema_version: 2,
          template_id: "commerce-order-cancellation-v1",
          behavior: controlOracle.behavior,
        },
      ),
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        "artifact://campaign/oracle/treatment/behavior.json",
        {
          schema_version: 2,
          template_id: "commerce-order-cancellation-v1",
          behavior: treatmentOracle.behavior,
        },
      ),
    ]);
    const episodeFor = (
      arm: "control" | "treatment",
      persistedArm: Awaited<ReturnType<typeof persistCommerceArm>>,
      output: ArmExecutionOutput,
      evaluated: CommerceArmEvaluationOutput,
    ): CommerceEpisode =>
      parseCommerceEpisode({
        schema_version: 1,
        episode_id: `${input.experiment.campaign_id}-${arm}`,
        campaign_id: input.experiment.campaign_id,
        arm,
        variant_digest:
          arm === "control"
            ? input.experiment.control_variant_digest
            : input.experiment.treatment_variant_digest,
        workspace_base_digest: output.workspaceBaseDigest,
        session_id: output.sessionId,
        process: output.process,
        evidence: persistedArm.evidence,
        measurement: {
          candidate_changed_paths: [...output.candidateChangedPaths].sort(),
          candidate_unauthorized_paths: [...output.candidateUnauthorizedPaths].sort(),
          candidate_forbidden_entries: [...output.candidateForbiddenEntries].sort(),
          candidate_frozen_before_oracle: true,
          candidate_tree_after_oracle: evaluated.candidateTreeAfterOracle,
          elapsed_ms: output.elapsedMs,
        },
        infrastructure_errors: [],
      });
    const controlEpisode = episodeFor("control", control, controlOutput, controlOracle);
    const treatmentEpisode = episodeFor("treatment", treatment, treatmentOutput, treatmentOracle);
    const [controlEpisodePointer, treatmentEpisodePointer] = await Promise.all([
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        armRef("control", "episode.json"),
        controlEpisode,
      ),
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        armRef("treatment", "episode.json"),
        treatmentEpisode,
      ),
    ]);
    const sessionText = (value: string | Uint8Array) =>
      typeof value === "string" ? value : new TextDecoder("utf-8", { fatal: true }).decode(value);
    const controlEvaluation = commerceEvaluationFromFrozenEvidence({
      episode: controlEpisode,
      sessionText: sessionText(controlOutput.sessionLog),
      publicTask: input.publicTask,
      variant: input.variants.control,
      behavior: controlOracle.behavior,
    });
    const treatmentEvaluation = commerceEvaluationFromFrozenEvidence({
      episode: treatmentEpisode,
      sessionText: sessionText(treatmentOutput.sessionLog),
      publicTask: input.publicTask,
      variant: input.variants.treatment,
      behavior: treatmentOracle.behavior,
    });
    const pairedEvaluation = parseCommercePairedEvaluation({
      schema_version: 2,
      template_id: "commerce-order-cancellation-v1",
      campaign_id: input.experiment.campaign_id,
      oracle_seed: seedPointer,
      measurement_validity: combineCommerceValidity(
        controlEvaluation.measurement_validity,
        treatmentEvaluation.measurement_validity,
      ),
      arms: {
        control: {
          episode: controlEpisodePointer,
          oracle: controlBehaviorPointer,
          candidate: { tree: controlOutput.candidateTree, archive: control.archivePointer },
          result: controlEvaluation,
        },
        treatment: {
          episode: treatmentEpisodePointer,
          oracle: treatmentBehaviorPointer,
          candidate: { tree: treatmentOutput.candidateTree, archive: treatment.archivePointer },
          result: treatmentEvaluation,
        },
      },
    });
    const evaluationPointer: ArtifactPointer = {
      ref: parseArtifactRef("artifact://campaign/evaluation.json"),
      sha256: canonicalJsonDigest(pairedEvaluation),
    };
    const report = buildCommercePairedImpactReport({
      experiment: input.experiment,
      experimentPointer,
      pairedEvaluation,
      evaluationPointer,
      controlEpisodePointer,
      treatmentEpisodePointer,
    });
    const markdown = renderCommercePairedReport(report);
    for (const value of [controlEpisode, treatmentEpisode, pairedEvaluation, report]) {
      assertSecretFreeText(canonicalJson(value));
    }
    assertSecretFreeText(markdown);
    await writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/evaluation.json",
      pairedEvaluation,
    );
    await state.transition("projected");
    const reportPointer = await writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/report.json",
      report,
    );
    const markdownPointer = await writeArtifactBytes(
      input.campaignRoot,
      "artifact://campaign/report.md",
      markdown,
    );
    await replayCommerceCampaign(input.campaignRoot, reportPointer);
    await state.transition("reported");
    return {
      report,
      pairedEvaluation,
      pointers: {
        experiment: experimentPointer,
        controlEpisode: controlEpisodePointer,
        treatmentEpisode: treatmentEpisodePointer,
        evaluation: evaluationPointer,
        report: reportPointer,
        markdown: markdownPointer,
      },
    };
  } catch (error) {
    const current = await state.read();
    if (current.phase !== "interrupted" && current.phase !== "reported") {
      await state.transition("interrupted");
    }
    throw error;
  }
}
