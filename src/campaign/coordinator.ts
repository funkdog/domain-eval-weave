import { TextDecoder } from "node:util";
import type { ArtifactPointer } from "../contracts/artifacts.js";
import {
  readJsonArtifact,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../contracts/artifacts.js";
import { canonicalJson } from "../contracts/canonical-json.js";
import type {
  EpisodeRecord,
  EvaluationResult,
  ExperimentSpec,
  PairedEvaluationArtifact,
  PairedImpactReport,
  VariantSpec,
} from "../contracts/parsers.js";
import {
  parseEpisodeRecord,
  parseExperimentSpec,
  parsePairedEvaluationArtifact,
} from "../contracts/parsers.js";
import { replayPairedImpactReport } from "../contracts/replay.js";
import {
  buildPairedImpactReport,
  combinePairedValidity,
  renderPairedReportMarkdown,
} from "../report/reporter.js";
import { assertSecretFreeText } from "../report/secret-scan.js";
import type { TaskPackIdentity } from "../task-pack/loader.js";
import { CampaignStateStore } from "./state.js";

export interface ArmExecutionOutput {
  readonly sessionId: string;
  readonly sessionLog: string | Uint8Array;
  readonly candidateTree: string;
  readonly candidateArchive: Uint8Array;
  readonly workspaceBaseDigest: string;
  readonly process: EpisodeRecord["process"];
  readonly oracleInput?: unknown;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CampaignPointers {
  readonly experiment: ArtifactPointer;
  readonly controlEpisode: ArtifactPointer;
  readonly treatmentEpisode: ArtifactPointer;
  readonly evaluation: ArtifactPointer;
  readonly report: ArtifactPointer;
  readonly markdown: ArtifactPointer;
}

export interface ArmEvaluationOutput {
  readonly result: EvaluationResult;
  readonly behavior: Readonly<Record<string, "pass" | "fail" | "error">>;
  readonly oracleSeed: {
    readonly schema_version: 1;
    readonly seed: number;
    readonly oracle_version: string;
  };
}

function armRef(arm: "control" | "treatment", name: string): string {
  return `artifact://campaign/arms/${arm}/${name}`;
}

async function persistArm(
  campaignRoot: string,
  experiment: ExperimentSpec,
  arm: "control" | "treatment",
  output: ArmExecutionOutput,
): Promise<{
  readonly episode: EpisodeRecord;
  readonly episodePointer: ArtifactPointer;
  readonly archivePointer: ArtifactPointer;
}> {
  const sessionText =
    typeof output.sessionLog === "string"
      ? output.sessionLog
      : new TextDecoder("utf-8", { fatal: true }).decode(output.sessionLog);
  assertSecretFreeText(sessionText);
  assertSecretFreeText(output.stdout ?? "");
  assertSecretFreeText(output.stderr ?? "");
  const [sessionPointer, archivePointer] = await Promise.all([
    writeArtifactBytes(campaignRoot, armRef(arm, "session.jsonl"), output.sessionLog),
    writeArtifactBytes(campaignRoot, armRef(arm, "candidate.tar"), output.candidateArchive),
    writeArtifactBytes(campaignRoot, armRef(arm, "stdout.txt"), output.stdout ?? ""),
    writeArtifactBytes(campaignRoot, armRef(arm, "stderr.txt"), output.stderr ?? ""),
    writeArtifactBytes(campaignRoot, armRef(arm, "candidate.tree"), `${output.candidateTree}\n`),
  ]);
  const episode: EpisodeRecord = {
    schema_version: 1,
    episode_id: `${experiment.campaign_id}-${arm}`,
    campaign_id: experiment.campaign_id,
    arm,
    variant_digest:
      arm === "control" ? experiment.control_variant_digest : experiment.treatment_variant_digest,
    workspace_base_digest: output.workspaceBaseDigest,
    session_id: output.sessionId,
    process: output.process,
    evidence: {
      session_log_ref: sessionPointer.ref,
      session_log_sha256: sessionPointer.sha256,
      candidate_tree: output.candidateTree,
      candidate_archive_ref: archivePointer.ref,
      candidate_archive_sha256: archivePointer.sha256,
    },
    infrastructure_errors: [],
  };
  const episodePointer = await writeCanonicalJsonArtifact(
    campaignRoot,
    armRef(arm, "episode.json"),
    episode,
  );
  return { episode, episodePointer, archivePointer };
}

export async function runPairedCampaign(input: {
  readonly campaignRoot: string;
  readonly experiment: ExperimentSpec;
  readonly variants: {
    readonly control: VariantSpec;
    readonly treatment: VariantSpec;
  };
  readonly taskPackIdentity: TaskPackIdentity;
  readonly executeArm: (arm: "control" | "treatment") => Promise<ArmExecutionOutput>;
  readonly evaluateArm: (
    arm: "control" | "treatment",
    output: ArmExecutionOutput,
  ) => Promise<ArmEvaluationOutput>;
}): Promise<{
  readonly report: PairedImpactReport;
  readonly pairedEvaluation: PairedEvaluationArtifact;
  readonly pointers: CampaignPointers;
}> {
  const state = new CampaignStateStore(`${input.campaignRoot}/campaign-state.json`);
  await state.initialize(input.experiment.campaign_id);
  const [controlVariantPointer, treatmentVariantPointer] = await Promise.all([
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
  ]);
  const taskPackPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    "artifact://campaign/task-pack/identity.json",
    input.taskPackIdentity,
  );
  if (
    controlVariantPointer.sha256 !== input.experiment.control_variant_digest ||
    treatmentVariantPointer.sha256 !== input.experiment.treatment_variant_digest ||
    taskPackPointer.sha256 !== input.experiment.task_pack_digest
  ) {
    throw new Error("Experiment digests do not bind its frozen Task Pack and VariantSpecs");
  }
  const experimentPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    "artifact://campaign/manifest.json",
    input.experiment,
  );
  await state.transition("qualified");
  const persisted = new Map<"control" | "treatment", Awaited<ReturnType<typeof persistArm>>>();
  const outputs = new Map<"control" | "treatment", ArmExecutionOutput>();
  try {
    for (let index = 0; index < input.experiment.arm_order.length; index += 1) {
      const arm = input.experiment.arm_order[index];
      if (arm === undefined) throw new Error("arm order is incomplete");
      await state.transition(index === 0 ? "arm_1_running" : "arm_2_running");
      const output = await input.executeArm(arm);
      outputs.set(arm, output);
      persisted.set(arm, await persistArm(input.campaignRoot, input.experiment, arm, output));
      await state.transition(index === 0 ? "arm_1_frozen" : "arm_2_frozen");
    }
    await state.transition("oracle_running");
    const control = persisted.get("control");
    const treatment = persisted.get("treatment");
    const controlOutput = outputs.get("control");
    const treatmentOutput = outputs.get("treatment");
    if (!control || !treatment || !controlOutput || !treatmentOutput) {
      throw new Error("both arms must be persisted before evaluation");
    }
    const controlEvaluationOutput = await input.evaluateArm("control", controlOutput);
    const treatmentEvaluationOutput = await input.evaluateArm("treatment", treatmentOutput);
    if (
      canonicalJson(controlEvaluationOutput.behavior) !==
        canonicalJson(controlEvaluationOutput.result.outcome.behavior_vector) ||
      canonicalJson(treatmentEvaluationOutput.behavior) !==
        canonicalJson(treatmentEvaluationOutput.result.outcome.behavior_vector) ||
      canonicalJson(controlEvaluationOutput.oracleSeed) !==
        canonicalJson(treatmentEvaluationOutput.oracleSeed)
    ) {
      throw new Error("Oracle artifacts do not bind the returned EvaluationResults");
    }
    const [oracleSeedPointer, controlBehaviorPointer, treatmentBehaviorPointer] = await Promise.all(
      [
        writeCanonicalJsonArtifact(
          input.campaignRoot,
          "artifact://campaign/oracle/seed.json",
          controlEvaluationOutput.oracleSeed,
        ),
        writeCanonicalJsonArtifact(
          input.campaignRoot,
          "artifact://campaign/oracle/control/behavior.json",
          { schema_version: 1, behavior: controlEvaluationOutput.behavior },
        ),
        writeCanonicalJsonArtifact(
          input.campaignRoot,
          "artifact://campaign/oracle/treatment/behavior.json",
          { schema_version: 1, behavior: treatmentEvaluationOutput.behavior },
        ),
      ],
    );
    const controlEvaluation = controlEvaluationOutput.result;
    const treatmentEvaluation = treatmentEvaluationOutput.result;
    const pairedEvaluation: PairedEvaluationArtifact = {
      schema_version: 1,
      campaign_id: input.experiment.campaign_id,
      oracle_seed: oracleSeedPointer,
      measurement_validity: combinePairedValidity(
        controlEvaluation.measurement_validity,
        treatmentEvaluation.measurement_validity,
      ),
      arms: {
        control: {
          episode: control.episodePointer,
          oracle: controlBehaviorPointer,
          candidate: { tree: controlOutput.candidateTree, archive: control.archivePointer },
          result: controlEvaluation,
        },
        treatment: {
          episode: treatment.episodePointer,
          oracle: treatmentBehaviorPointer,
          candidate: { tree: treatmentOutput.candidateTree, archive: treatment.archivePointer },
          result: treatmentEvaluation,
        },
      },
    };
    const evaluationPointer = await writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/evaluation.json",
      pairedEvaluation,
    );
    await state.transition("projected");
    const report = buildPairedImpactReport({
      experiment: input.experiment,
      experimentPointer,
      pairedEvaluation,
      evaluationPointer,
      controlEpisodePointer: control.episodePointer,
      treatmentEpisodePointer: treatment.episodePointer,
    });
    const reportPointer = await writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/report.json",
      report,
    );
    const markdown = renderPairedReportMarkdown(report);
    assertSecretFreeText(JSON.stringify(report));
    assertSecretFreeText(markdown);
    const markdownPointer = await writeArtifactBytes(
      input.campaignRoot,
      "artifact://campaign/report.md",
      markdown,
    );
    await replayPairedImpactReport(input.campaignRoot, reportPointer);
    await state.transition("reported");
    return {
      report,
      pairedEvaluation,
      pointers: {
        experiment: experimentPointer,
        controlEpisode: control.episodePointer,
        treatmentEpisode: treatment.episodePointer,
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

export async function rebuildCampaignReport(input: {
  readonly campaignRoot: string;
  readonly pointers: CampaignPointers;
}): Promise<{
  readonly report: PairedImpactReport;
  readonly reportPointer: ArtifactPointer;
  readonly markdownPointer: ArtifactPointer;
}> {
  await replayPairedImpactReport(input.campaignRoot, input.pointers.report);
  const [experiment, controlEpisode, treatmentEpisode, pairedEvaluation] = await Promise.all([
    readJsonArtifact(input.campaignRoot, input.pointers.experiment, parseExperimentSpec),
    readJsonArtifact(input.campaignRoot, input.pointers.controlEpisode, parseEpisodeRecord),
    readJsonArtifact(input.campaignRoot, input.pointers.treatmentEpisode, parseEpisodeRecord),
    readJsonArtifact(input.campaignRoot, input.pointers.evaluation, parsePairedEvaluationArtifact),
  ]);
  if (controlEpisode.arm !== "control" || treatmentEpisode.arm !== "treatment") {
    throw new Error("episode pointers are bound to the wrong arms");
  }
  const report = buildPairedImpactReport({
    experiment,
    experimentPointer: input.pointers.experiment,
    pairedEvaluation,
    evaluationPointer: input.pointers.evaluation,
    controlEpisodePointer: input.pointers.controlEpisode,
    treatmentEpisodePointer: input.pointers.treatmentEpisode,
  });
  const reportPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    "artifact://campaign/report.json",
    report,
  );
  const markdown = renderPairedReportMarkdown(report);
  assertSecretFreeText(JSON.stringify(report));
  assertSecretFreeText(markdown);
  const markdownPointer = await writeArtifactBytes(
    input.campaignRoot,
    "artifact://campaign/report.md",
    markdown,
  );
  await replayPairedImpactReport(input.campaignRoot, reportPointer);
  return { report, reportPointer, markdownPointer };
}
