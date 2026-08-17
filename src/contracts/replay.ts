import {
  ArtifactIntegrityError,
  type ArtifactPointer,
  readArtifactBytes,
  readJsonArtifact,
} from "./artifacts.js";
import { canonicalJson } from "./canonical-json.js";
import {
  type EpisodeRecord,
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
    canonicalJson(report.arms.control) !== canonicalJson(evaluation.control) ||
    canonicalJson(report.arms.treatment) !== canonicalJson(evaluation.treatment)
  ) {
    crossReferenceFailure("report arm evaluations do not match evaluation evidence");
  }

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
