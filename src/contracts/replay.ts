import {
  ArtifactIntegrityError,
  type ArtifactPointer,
  readArtifactBytes,
  readJsonArtifact,
} from "./artifacts.js";
import { canonicalJson } from "./canonical-json.js";
import {
  type EpisodeRecord,
  type EvaluationResult,
  type ExperimentSpec,
  type PairedEvaluationArtifact,
  type PairedImpactReport,
  parseEpisodeRecord,
  parseExperimentSpec,
  parsePairedEvaluationArtifact,
  parsePairedImpactReport,
} from "./parsers.js";

export interface ReplayedPairedImpactReport {
  readonly report: PairedImpactReport;
  readonly experiment: ExperimentSpec;
  readonly control_episode: EpisodeRecord;
  readonly treatment_episode: EpisodeRecord;
  readonly evaluation: PairedEvaluationArtifact;
}

function crossReferenceFailure(message: string): never {
  throw new ArtifactIntegrityError("ARTIFACT_CROSS_REFERENCE_INVALID", message);
}

function rawCostDelta(
  control: EvaluationResult["cost"],
  treatment: EvaluationResult["cost"],
): PairedImpactReport["cost_delta"] {
  const delta = (controlValue: number | null, treatmentValue: number | null) =>
    controlValue === null || treatmentValue === null ? null : treatmentValue - controlValue;
  return {
    elapsed_ms: delta(control.elapsed_ms, treatment.elapsed_ms),
    input_tokens: delta(control.input_tokens, treatment.input_tokens),
    cached_input_tokens: delta(control.cached_input_tokens, treatment.cached_input_tokens),
    output_tokens: delta(control.output_tokens, treatment.output_tokens),
    failed_tool_calls: delta(control.failed_tool_calls, treatment.failed_tool_calls),
  };
}

function assertArmEvaluationBinding(
  arm: "control" | "treatment",
  evaluation: PairedEvaluationArtifact["arms"][typeof arm],
  reportEpisodePointer: ArtifactPointer,
  episode: EpisodeRecord,
): void {
  if (canonicalJson(evaluation.episode) !== canonicalJson(reportEpisodePointer)) {
    crossReferenceFailure(`${arm} evaluation is not bound to the report episode pointer`);
  }
  if (
    evaluation.candidate.tree !== episode.evidence.candidate_tree ||
    evaluation.candidate.archive.ref !== episode.evidence.candidate_archive_ref ||
    evaluation.candidate.archive.sha256 !== episode.evidence.candidate_archive_sha256
  ) {
    crossReferenceFailure(`${arm} evaluation is not bound to the frozen episode candidate`);
  }
}

export async function replayPairedImpactReport(
  campaignRoot: string,
  reportPointer: ArtifactPointer,
): Promise<ReplayedPairedImpactReport> {
  const report = await readJsonArtifact(campaignRoot, reportPointer, parsePairedImpactReport);
  const [experiment, controlEpisode, treatmentEpisode, evaluation] = await Promise.all([
    readJsonArtifact(campaignRoot, report.evidence.experiment, parseExperimentSpec),
    readJsonArtifact(campaignRoot, report.evidence.control_episode, parseEpisodeRecord),
    readJsonArtifact(campaignRoot, report.evidence.treatment_episode, parseEpisodeRecord),
    readJsonArtifact(campaignRoot, report.evidence.evaluation, parsePairedEvaluationArtifact),
  ]);

  if (report.experiment_digest !== report.evidence.experiment.sha256) {
    crossReferenceFailure("report experiment digest does not match its evidence pointer");
  }
  if (
    report.campaign_id !== experiment.campaign_id ||
    controlEpisode.campaign_id !== experiment.campaign_id ||
    treatmentEpisode.campaign_id !== experiment.campaign_id ||
    evaluation.campaign_id !== experiment.campaign_id
  ) {
    crossReferenceFailure("Campaign ids do not agree across replayed artifacts");
  }
  if (controlEpisode.arm !== "control" || treatmentEpisode.arm !== "treatment") {
    crossReferenceFailure("episode evidence is bound to the wrong arm");
  }
  if (
    controlEpisode.variant_digest !== experiment.control_variant_digest ||
    treatmentEpisode.variant_digest !== experiment.treatment_variant_digest
  ) {
    crossReferenceFailure("episode variant digests do not match the experiment");
  }
  if (
    canonicalJson(report.arms.control) !== canonicalJson(evaluation.arms.control.result) ||
    canonicalJson(report.arms.treatment) !== canonicalJson(evaluation.arms.treatment.result)
  ) {
    crossReferenceFailure("report arm evaluations do not match evaluation evidence");
  }
  if (
    canonicalJson(report.measurement_validity) !== canonicalJson(evaluation.measurement_validity)
  ) {
    crossReferenceFailure("report paired validity does not match evaluation evidence");
  }
  const expectedCostDelta = rawCostDelta(
    evaluation.arms.control.result.cost,
    evaluation.arms.treatment.result.cost,
  );
  if (canonicalJson(report.cost_delta) !== canonicalJson(expectedCostDelta)) {
    crossReferenceFailure("report cost delta is not derived from evaluation evidence");
  }

  assertArmEvaluationBinding(
    "control",
    evaluation.arms.control,
    report.evidence.control_episode,
    controlEpisode,
  );
  assertArmEvaluationBinding(
    "treatment",
    evaluation.arms.treatment,
    report.evidence.treatment_episode,
    treatmentEpisode,
  );

  const nestedPointers = [controlEpisode, treatmentEpisode].flatMap((episode) => {
    const pointers: ArtifactPointer[] = [];
    if (episode.evidence.session_log_ref && episode.evidence.session_log_sha256) {
      pointers.push({
        ref: episode.evidence.session_log_ref,
        sha256: episode.evidence.session_log_sha256,
      });
    }
    if (episode.evidence.candidate_archive_ref && episode.evidence.candidate_archive_sha256) {
      pointers.push({
        ref: episode.evidence.candidate_archive_ref,
        sha256: episode.evidence.candidate_archive_sha256,
      });
    }
    return pointers;
  });
  await Promise.all(nestedPointers.map((pointer) => readArtifactBytes(campaignRoot, pointer)));

  return {
    report,
    experiment,
    control_episode: controlEpisode,
    treatment_episode: treatmentEpisode,
    evaluation,
  };
}
