import { TextDecoder } from "node:util";

import { fingerprintEvalDeployment } from "../fingerprint/deployment.js";
import { type BehaviorVector, LEDGER_BEHAVIORS } from "../oracle/ledger.js";
import { buildPairedImpactReport, combinePairedValidity } from "../report/reporter.js";
import { parseTaskPackIdentity, type TaskPackIdentity } from "../task-pack/loader.js";
import {
  evaluationFromFrozenEvidence,
  evaluationFromLegacyV2Evidence,
} from "../validity/reconstruction.js";
import {
  ArtifactIntegrityError,
  type ArtifactPointer,
  parseArtifactRef,
  readArtifactBytes,
  readArtifactBytesByRef,
  readJsonArtifact,
} from "./artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "./canonical-json.js";
import {
  type ExperimentSpec,
  type FrozenEpisodeRecord,
  type PairedEvaluationArtifact,
  type PairedImpactReport,
  parseExperimentSpec,
  parseFrozenEpisodeRecord,
  parsePairedEvaluationArtifact,
  parsePairedImpactReport,
  parseVariantSpec,
  type VariantSpec,
} from "./parsers.js";

export interface ReplayedPairedImpactReport {
  readonly report: PairedImpactReport;
  readonly experiment: ExperimentSpec;
  readonly control_episode: FrozenEpisodeRecord;
  readonly treatment_episode: FrozenEpisodeRecord;
  readonly evaluation: PairedEvaluationArtifact;
  readonly reconstructed_evaluation: PairedEvaluationArtifact;
  readonly control_variant: VariantSpec;
  readonly treatment_variant: VariantSpec;
  readonly task_pack: TaskPackIdentity;
  readonly oracle_seed: {
    readonly schema_version: 1;
    readonly seed: number;
    readonly oracle_version: string;
  };
}

function crossReferenceFailure(message: string): never {
  throw new ArtifactIntegrityError("ARTIFACT_CROSS_REFERENCE_INVALID", message);
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    crossReferenceFailure("Oracle artifact is not an object");
  }
  return value as Record<string, unknown>;
}

function decodeCanonicalJson(bytes: Buffer): unknown {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    crossReferenceFailure("primary evidence is not valid UTF-8 JSON");
  }
  if (canonicalJson(value) !== text) {
    crossReferenceFailure("primary evidence JSON is not canonical");
  }
  return value;
}

function parseOracleSeed(value: unknown): ReplayedPairedImpactReport["oracle_seed"] {
  const record = recordValue(value);
  if (
    Object.keys(record).sort().join(",") !== "oracle_version,schema_version,seed" ||
    record.schema_version !== 1 ||
    !Number.isSafeInteger(record.seed) ||
    (record.seed as number) < 0 ||
    typeof record.oracle_version !== "string" ||
    record.oracle_version.length === 0
  ) {
    crossReferenceFailure("Oracle seed artifact is invalid");
  }
  return {
    schema_version: 1,
    seed: record.seed as number,
    oracle_version: record.oracle_version as string,
  };
}

function parseOracleBehavior(value: unknown): BehaviorVector {
  const record = recordValue(value);
  const behavior = recordValue(record.behavior);
  const keys = Object.keys(behavior).sort();
  if (
    Object.keys(record).sort().join(",") !== "behavior,schema_version" ||
    record.schema_version !== 1 ||
    canonicalJson(keys) !== canonicalJson([...LEDGER_BEHAVIORS].sort()) ||
    LEDGER_BEHAVIORS.some(
      (name) =>
        behavior[name] !== "pass" && behavior[name] !== "fail" && behavior[name] !== "error",
    )
  ) {
    crossReferenceFailure("Oracle behavior artifact is invalid");
  }
  return Object.fromEntries(
    LEDGER_BEHAVIORS.map((name) => [name, behavior[name]]),
  ) as BehaviorVector;
}

async function verifyEpisodeEvidenceBytes(
  campaignRoot: string,
  arm: "control" | "treatment",
  episode: FrozenEpisodeRecord,
): Promise<string> {
  const pointers: ArtifactPointer[] = [
    { ref: episode.evidence.session_log_ref, sha256: episode.evidence.session_log_sha256 },
    { ref: episode.evidence.candidate_tree_ref, sha256: episode.evidence.candidate_tree_sha256 },
    { ref: episode.evidence.candidate_patch_ref, sha256: episode.evidence.candidate_patch_sha256 },
    {
      ref: episode.evidence.candidate_archive_ref,
      sha256: episode.evidence.candidate_archive_sha256,
    },
    { ref: episode.evidence.stdout_ref, sha256: episode.evidence.stdout_sha256 },
    { ref: episode.evidence.stderr_ref, sha256: episode.evidence.stderr_sha256 },
  ];
  const bytes = await Promise.all(
    pointers.map((pointer) => readArtifactBytes(campaignRoot, pointer)),
  );
  if (bytes[1]?.toString("utf8") !== `${episode.evidence.candidate_tree}\n`) {
    crossReferenceFailure(`${arm} candidate tree artifact does not match the Episode tree`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes[0]);
  } catch {
    crossReferenceFailure(`${arm} Session artifact is not valid UTF-8`);
  }
}

function commonVariantFace(variant: VariantSpec) {
  return {
    common_patch_sha256: variant.common_patch_sha256,
    dsh_package_tree_sha256: variant.dsh_package_tree_sha256,
    codex_connect_package_sha256: variant.codex_connect_package_sha256,
    eval_package_sha256: variant.eval_package_sha256,
    model_route: variant.model_route,
    tool_schema_sha256: variant.tool_schema_sha256,
    tools_mode: variant.tools_mode,
    permission_mode: variant.permission_mode,
  };
}

export async function replayPairedImpactReport(
  campaignRoot: string,
  reportPointer: ArtifactPointer,
  options: { readonly requirePersistedEvaluation?: boolean } = {},
): Promise<ReplayedPairedImpactReport> {
  const report = await readJsonArtifact(campaignRoot, reportPointer, parsePairedImpactReport);
  const [experiment, controlEpisode, treatmentEpisode] = await Promise.all([
    readJsonArtifact(campaignRoot, report.evidence.experiment, parseExperimentSpec),
    readJsonArtifact(campaignRoot, report.evidence.control_episode, parseFrozenEpisodeRecord),
    readJsonArtifact(campaignRoot, report.evidence.treatment_episode, parseFrozenEpisodeRecord),
  ]);
  const [controlVariant, treatmentVariant, taskPack] = await Promise.all([
    readJsonArtifact(
      campaignRoot,
      {
        ref: parseArtifactRef("artifact://campaign/variants/control.json"),
        sha256: experiment.control_variant_digest,
      },
      parseVariantSpec,
    ),
    readJsonArtifact(
      campaignRoot,
      {
        ref: parseArtifactRef("artifact://campaign/variants/treatment.json"),
        sha256: experiment.treatment_variant_digest,
      },
      parseVariantSpec,
    ),
    readJsonArtifact(
      campaignRoot,
      {
        ref: parseArtifactRef("artifact://campaign/task-pack/identity.json"),
        sha256: experiment.task_pack_digest,
      },
      parseTaskPackIdentity,
    ),
  ]);

  if (report.experiment_digest !== report.evidence.experiment.sha256) {
    crossReferenceFailure("report experiment digest does not match its evidence pointer");
  }
  if (
    report.campaign_id !== experiment.campaign_id ||
    controlEpisode.campaign_id !== experiment.campaign_id ||
    treatmentEpisode.campaign_id !== experiment.campaign_id
  ) {
    crossReferenceFailure("Campaign ids do not agree across replayed artifacts");
  }
  if (controlEpisode.arm !== "control" || treatmentEpisode.arm !== "treatment") {
    crossReferenceFailure("episode evidence is bound to the wrong arm");
  }
  if (controlVariant.variant_id !== "goal-off" || treatmentVariant.variant_id !== "goal-on") {
    crossReferenceFailure("VariantSpec artifacts are bound to the wrong arms");
  }
  if (
    canonicalJson(commonVariantFace(controlVariant)) !==
    canonicalJson(commonVariantFace(treatmentVariant))
  ) {
    crossReferenceFailure("VariantSpecs differ outside the frozen Goal intervention face");
  }
  const expectedDeploymentDigest = fingerprintEvalDeployment({
    control: controlVariant.resolved_config_sha256,
    treatment: treatmentVariant.resolved_config_sha256,
    task_pack: experiment.task_pack_digest,
    model: {
      provider: controlVariant.model_route.provider,
      model: controlVariant.model_route.model,
      effort: controlVariant.model_route.reasoning_effort,
    },
    dsh_package_tree: controlVariant.dsh_package_tree_sha256,
    codex_connect_package: controlVariant.codex_connect_package_sha256,
    eval_package: controlVariant.eval_package_sha256,
    common_patch: controlVariant.common_patch_sha256,
  });
  const qualification = experiment.deployment.qualification;
  const projection = experiment.deployment.qualification_projection;
  const directQualification =
    projection === undefined && qualification.deployment_digest === expectedDeploymentDigest;
  const projectedQualification =
    projection !== undefined &&
    projection.source_deployment_digest === qualification.deployment_digest &&
    projection.projected_deployment_digest === expectedDeploymentDigest &&
    projection.source_qualification_sha256 === canonicalJsonDigest(qualification);
  if (
    experiment.deployment.digest !== expectedDeploymentDigest ||
    experiment.deployment.eval_package_sha256 !== controlVariant.eval_package_sha256 ||
    (!directQualification && !projectedQualification) ||
    qualification.common_tool_schema_sha256 !== controlVariant.tool_schema_sha256 ||
    experiment.deployment.calibration.task_pack_digest !== experiment.task_pack_digest ||
    experiment.deployment.calibration.calibration_digest !== taskPack.pack.calibration_digest ||
    experiment.deployment.calibration.eval_package_sha256 !== controlVariant.eval_package_sha256
  ) {
    crossReferenceFailure("Experiment deployment, qualification, and calibration evidence drifted");
  }
  const calibrationIsV3 = "broken_release_failures" in experiment.deployment.calibration.candidates;
  if ((taskPack.pack.oracle_version === "ledger-oracle-v3") !== calibrationIsV3) {
    crossReferenceFailure("Calibration evidence does not match the frozen Oracle version");
  }
  const controlHasMeasurement = "measurement" in controlEpisode;
  const treatmentHasMeasurement = "measurement" in treatmentEpisode;
  if (
    controlHasMeasurement !== treatmentHasMeasurement ||
    (taskPack.pack.oracle_version === "ledger-oracle-v3" && !controlHasMeasurement)
  ) {
    crossReferenceFailure("Episode evidence shape does not match the frozen Oracle version");
  }
  if (
    controlEpisode.variant_digest !== experiment.control_variant_digest ||
    treatmentEpisode.variant_digest !== experiment.treatment_variant_digest
  ) {
    crossReferenceFailure("episode variant digests do not match the experiment");
  }
  if (
    taskPack.pack.eval_pack_id !== experiment.eval_pack_id ||
    controlEpisode.workspace_base_digest !== taskPack.pack.base_tree_sha256 ||
    treatmentEpisode.workspace_base_digest !== taskPack.pack.base_tree_sha256
  ) {
    crossReferenceFailure("Task Pack identity does not bind the Experiment and workspace bases");
  }

  const [
    publicTaskBytes,
    controlSession,
    treatmentSession,
    seedArtifact,
    controlOracle,
    treatmentOracle,
  ] = await Promise.all([
    readArtifactBytes(campaignRoot, {
      ref: parseArtifactRef("artifact://campaign/task-pack/public-task.md"),
      sha256: taskPack.public_task_sha256,
    }),
    verifyEpisodeEvidenceBytes(campaignRoot, "control", controlEpisode),
    verifyEpisodeEvidenceBytes(campaignRoot, "treatment", treatmentEpisode),
    readArtifactBytesByRef(campaignRoot, "artifact://campaign/oracle/seed.json"),
    readArtifactBytesByRef(campaignRoot, "artifact://campaign/oracle/control/behavior.json"),
    readArtifactBytesByRef(campaignRoot, "artifact://campaign/oracle/treatment/behavior.json"),
  ]);
  let publicTask: string;
  try {
    publicTask = new TextDecoder("utf-8", { fatal: true }).decode(publicTaskBytes);
  } catch {
    crossReferenceFailure("frozen public task is not valid UTF-8");
  }
  const oracleSeed = parseOracleSeed(decodeCanonicalJson(seedArtifact.bytes));
  const controlBehavior = parseOracleBehavior(decodeCanonicalJson(controlOracle.bytes));
  const treatmentBehavior = parseOracleBehavior(decodeCanonicalJson(treatmentOracle.bytes));
  if (oracleSeed.oracle_version !== taskPack.pack.oracle_version) {
    crossReferenceFailure("Oracle seed version does not match the Task Pack");
  }
  let evaluation: PairedEvaluationArtifact | undefined;
  if (!controlHasMeasurement || !treatmentHasMeasurement) {
    evaluation = await readJsonArtifact(
      campaignRoot,
      report.evidence.evaluation,
      parsePairedEvaluationArtifact,
    );
  }
  const controlEvaluation = controlHasMeasurement
    ? evaluationFromFrozenEvidence({
        episode: controlEpisode,
        sessionText: controlSession,
        publicTask,
        variant: controlVariant,
        behavior: controlBehavior,
      })
    : evaluationFromLegacyV2Evidence({
        episode: controlEpisode,
        persistedResult:
          evaluation?.arms.control.result ?? crossReferenceFailure("missing legacy evaluation"),
        sessionText: controlSession,
        publicTask,
        variant: controlVariant,
        behavior: controlBehavior,
      });
  const treatmentEvaluation = treatmentHasMeasurement
    ? evaluationFromFrozenEvidence({
        episode: treatmentEpisode,
        sessionText: treatmentSession,
        publicTask,
        variant: treatmentVariant,
        behavior: treatmentBehavior,
      })
    : evaluationFromLegacyV2Evidence({
        episode: treatmentEpisode,
        persistedResult:
          evaluation?.arms.treatment.result ?? crossReferenceFailure("missing legacy evaluation"),
        sessionText: treatmentSession,
        publicTask,
        variant: treatmentVariant,
        behavior: treatmentBehavior,
      });
  const reconstructedEvaluation: PairedEvaluationArtifact = {
    schema_version: 1,
    campaign_id: experiment.campaign_id,
    oracle_seed: seedArtifact.pointer,
    measurement_validity: combinePairedValidity(
      controlEvaluation.measurement_validity,
      treatmentEvaluation.measurement_validity,
    ),
    arms: {
      control: {
        episode: report.evidence.control_episode,
        oracle: controlOracle.pointer,
        candidate: {
          tree: controlEpisode.evidence.candidate_tree,
          archive: {
            ref: controlEpisode.evidence.candidate_archive_ref,
            sha256: controlEpisode.evidence.candidate_archive_sha256,
          },
        },
        result: controlEvaluation,
      },
      treatment: {
        episode: report.evidence.treatment_episode,
        oracle: treatmentOracle.pointer,
        candidate: {
          tree: treatmentEpisode.evidence.candidate_tree,
          archive: {
            ref: treatmentEpisode.evidence.candidate_archive_ref,
            sha256: treatmentEpisode.evidence.candidate_archive_sha256,
          },
        },
        result: treatmentEvaluation,
      },
    },
  };
  if (
    report.evidence.evaluation.ref !== "artifact://campaign/evaluation.json" ||
    report.evidence.evaluation.sha256 !== canonicalJsonDigest(reconstructedEvaluation)
  ) {
    crossReferenceFailure("report does not bind the semantically reconstructed evaluation");
  }
  evaluation ??=
    options.requirePersistedEvaluation === false
      ? reconstructedEvaluation
      : await readJsonArtifact(
          campaignRoot,
          report.evidence.evaluation,
          parsePairedEvaluationArtifact,
        );
  if (
    options.requirePersistedEvaluation !== false &&
    canonicalJson(evaluation) !== canonicalJson(reconstructedEvaluation)
  ) {
    crossReferenceFailure("persisted evaluation differs from frozen Session and Oracle evidence");
  }
  const reconstructedReport = buildPairedImpactReport({
    experiment,
    experimentPointer: report.evidence.experiment,
    pairedEvaluation: reconstructedEvaluation,
    evaluationPointer: report.evidence.evaluation,
    controlEpisodePointer: report.evidence.control_episode,
    treatmentEpisodePointer: report.evidence.treatment_episode,
  });
  if (canonicalJson(report) !== canonicalJson(reconstructedReport)) {
    crossReferenceFailure("persisted report differs from the semantically reconstructed report");
  }

  return {
    report,
    experiment,
    control_episode: controlEpisode,
    treatment_episode: treatmentEpisode,
    evaluation,
    reconstructed_evaluation: reconstructedEvaluation,
    control_variant: controlVariant,
    treatment_variant: treatmentVariant,
    task_pack: taskPack,
    oracle_seed: oracleSeed,
  };
}
