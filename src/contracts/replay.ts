import { fingerprintEvalDeployment } from "../fingerprint/deployment.js";
import { parseTaskPackIdentity, type TaskPackIdentity } from "../task-pack/loader.js";
import {
  ArtifactIntegrityError,
  type ArtifactPointer,
  parseArtifactRef,
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
  parseVariantSpec,
  type VariantSpec,
} from "./parsers.js";

export interface ReplayedPairedImpactReport {
  readonly report: PairedImpactReport;
  readonly experiment: ExperimentSpec;
  readonly control_episode: EpisodeRecord;
  readonly treatment_episode: EpisodeRecord;
  readonly evaluation: PairedEvaluationArtifact;
  readonly control_variant: VariantSpec;
  readonly treatment_variant: VariantSpec;
  readonly task_pack: TaskPackIdentity;
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

function parseOracleSeed(value: unknown): Record<string, unknown> {
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
  return record;
}

function parseOracleBehavior(value: unknown): Record<string, unknown> {
  const record = recordValue(value);
  const behavior = record.behavior;
  if (
    Object.keys(record).sort().join(",") !== "behavior,schema_version" ||
    record.schema_version !== 1 ||
    typeof behavior !== "object" ||
    behavior === null ||
    Array.isArray(behavior) ||
    Object.values(behavior).some(
      (status) => status !== "pass" && status !== "fail" && status !== "error",
    )
  ) {
    crossReferenceFailure("Oracle behavior artifact is invalid");
  }
  return behavior as Record<string, unknown>;
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

async function verifyEpisodeEvidenceBytes(
  campaignRoot: string,
  arm: "control" | "treatment",
  episode: EpisodeRecord,
): Promise<void> {
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
    treatmentEpisode.campaign_id !== experiment.campaign_id ||
    evaluation.campaign_id !== experiment.campaign_id
  ) {
    crossReferenceFailure("Campaign ids do not agree across replayed artifacts");
  }
  if (controlEpisode.arm !== "control" || treatmentEpisode.arm !== "treatment") {
    crossReferenceFailure("episode evidence is bound to the wrong arm");
  }
  if (controlVariant.variant_id !== "goal-off" || treatmentVariant.variant_id !== "goal-on") {
    crossReferenceFailure("VariantSpec artifacts are bound to the wrong arms");
  }
  const commonVariantFace = (variant: VariantSpec) => ({
    common_patch_sha256: variant.common_patch_sha256,
    dsh_package_tree_sha256: variant.dsh_package_tree_sha256,
    codex_connect_package_sha256: variant.codex_connect_package_sha256,
    eval_package_sha256: variant.eval_package_sha256,
    model_route: variant.model_route,
    tool_schema_sha256: variant.tool_schema_sha256,
    tools_mode: variant.tools_mode,
    permission_mode: variant.permission_mode,
  });
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
  if (
    experiment.deployment.digest !== expectedDeploymentDigest ||
    experiment.deployment.eval_package_sha256 !== controlVariant.eval_package_sha256 ||
    experiment.deployment.qualification.deployment_digest !== expectedDeploymentDigest ||
    experiment.deployment.qualification.common_tool_schema_sha256 !==
      controlVariant.tool_schema_sha256 ||
    experiment.deployment.calibration.task_pack_digest !== experiment.task_pack_digest ||
    experiment.deployment.calibration.calibration_digest !== taskPack.pack.calibration_digest ||
    experiment.deployment.calibration.eval_package_sha256 !== controlVariant.eval_package_sha256
  ) {
    crossReferenceFailure("Experiment deployment, qualification, and calibration evidence drifted");
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
  const [oracleSeed, controlBehavior, treatmentBehavior] = await Promise.all([
    readJsonArtifact(campaignRoot, evaluation.oracle_seed, parseOracleSeed),
    readJsonArtifact(campaignRoot, evaluation.arms.control.oracle, parseOracleBehavior),
    readJsonArtifact(campaignRoot, evaluation.arms.treatment.oracle, parseOracleBehavior),
  ]);
  if (
    canonicalJson(controlBehavior) !==
      canonicalJson(evaluation.arms.control.result.outcome.behavior_vector) ||
    canonicalJson(treatmentBehavior) !==
      canonicalJson(evaluation.arms.treatment.result.outcome.behavior_vector) ||
    oracleSeed.oracle_version !== taskPack.pack.oracle_version
  ) {
    crossReferenceFailure("Oracle evidence does not bind the evaluated behavior vectors");
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

  await Promise.all([
    verifyEpisodeEvidenceBytes(campaignRoot, "control", controlEpisode),
    verifyEpisodeEvidenceBytes(campaignRoot, "treatment", treatmentEpisode),
  ]);

  return {
    report,
    experiment,
    control_episode: controlEpisode,
    treatment_episode: treatmentEpisode,
    evaluation,
    control_variant: controlVariant,
    treatment_variant: treatmentVariant,
    task_pack: taskPack,
  };
}
