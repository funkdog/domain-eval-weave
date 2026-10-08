import { TextDecoder } from "node:util";

import {
  ArtifactIntegrityError,
  type ArtifactPointer,
  parseArtifactRef,
  readArtifactBytes,
  readArtifactBytesByRef,
  readJsonArtifact,
} from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { fingerprintEvalDeployment } from "../fingerprint/deployment.js";
import { COMMERCE_BEHAVIORS } from "../oracle/commerce-order.js";
import { parseTaskPackIdentity } from "../task-pack/loader.js";
import {
  type CommerceEpisode,
  type CommercePairedEvaluation,
  type CommerceVariant,
  parseCommerceEpisode,
  parseCommerceExperiment,
  parseCommercePairedEvaluation,
  parseCommercePairedImpactReport,
  parseCommerceVariant,
} from "./campaign-contracts.js";
import { buildCommercePairedImpactReport, combineCommerceValidity } from "./campaign-report.js";
import { commerceEvaluationFromFrozenEvidence } from "./validity.js";

function failure(message: string): never {
  throw new ArtifactIntegrityError("ARTIFACT_CROSS_REFERENCE_INVALID", message);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failure("Commerce Oracle artifact is not an object");
  }
  return value as Record<string, unknown>;
}

function decodeCanonical(bytes: Buffer): unknown {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    failure("Commerce primary evidence is not UTF-8 JSON");
  }
  if (canonicalJson(value) !== text) failure("Commerce primary evidence is not canonical JSON");
  return value;
}

function parseCommerceSeed(value: unknown) {
  const seed = record(value);
  if (
    Object.keys(seed).sort().join(",") !== "oracle_version,schema_version,seed,template_id" ||
    seed.schema_version !== 2 ||
    seed.template_id !== "commerce-order-cancellation-v1" ||
    seed.oracle_version !== "commerce-order-oracle-v1" ||
    !Number.isSafeInteger(seed.seed) ||
    (seed.seed as number) < 0
  ) {
    failure("Commerce Oracle seed is invalid");
  }
  return seed;
}

function parseCommerceBehavior(value: unknown) {
  const artifact = record(value);
  const behavior = record(artifact.behavior);
  if (
    Object.keys(artifact).sort().join(",") !== "behavior,schema_version,template_id" ||
    artifact.schema_version !== 2 ||
    artifact.template_id !== "commerce-order-cancellation-v1" ||
    canonicalJson(Object.keys(behavior).sort()) !== canonicalJson([...COMMERCE_BEHAVIORS].sort()) ||
    COMMERCE_BEHAVIORS.some(
      (name) =>
        behavior[name] !== "pass" && behavior[name] !== "fail" && behavior[name] !== "error",
    )
  ) {
    failure("Commerce Oracle behavior vector is invalid");
  }
  return Object.fromEntries(
    COMMERCE_BEHAVIORS.map((name) => [name, behavior[name]]),
  ) as CommercePairedEvaluation["arms"]["control"]["result"]["outcome"]["behavior_vector"];
}

async function verifyEpisodeBytes(
  campaignRoot: string,
  arm: "control" | "treatment",
  episode: CommerceEpisode,
): Promise<string> {
  const pointers: ArtifactPointer[] = [
    {
      ref: parseArtifactRef(episode.evidence.session_log_ref),
      sha256: episode.evidence.session_log_sha256,
    },
    {
      ref: parseArtifactRef(episode.evidence.candidate_tree_ref),
      sha256: episode.evidence.candidate_tree_sha256,
    },
    {
      ref: parseArtifactRef(episode.evidence.candidate_patch_ref),
      sha256: episode.evidence.candidate_patch_sha256,
    },
    {
      ref: parseArtifactRef(episode.evidence.candidate_archive_ref),
      sha256: episode.evidence.candidate_archive_sha256,
    },
    { ref: parseArtifactRef(episode.evidence.stdout_ref), sha256: episode.evidence.stdout_sha256 },
    { ref: parseArtifactRef(episode.evidence.stderr_ref), sha256: episode.evidence.stderr_sha256 },
  ];
  const bytes = await Promise.all(
    pointers.map((pointer) => readArtifactBytes(campaignRoot, pointer)),
  );
  if (bytes[1]?.toString("utf8") !== `${episode.evidence.candidate_tree}\n`) {
    failure(`${arm} Commerce candidate tree artifact drifted`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes[0]);
  } catch {
    failure(`${arm} Commerce Session is not UTF-8`);
  }
}

function commonVariant(variant: CommerceVariant) {
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

function artifactPointer(value: {
  readonly ref: string;
  readonly sha256: string;
}): ArtifactPointer {
  return { ref: parseArtifactRef(value.ref), sha256: value.sha256 };
}

export async function replayCommerceCampaign(
  campaignRoot: string,
  reportPointer: ArtifactPointer,
): Promise<{
  readonly report: ReturnType<typeof parseCommercePairedImpactReport>;
  readonly evaluation: CommercePairedEvaluation;
  readonly experiment: ReturnType<typeof parseCommerceExperiment>;
  readonly controlEpisode: CommerceEpisode;
  readonly treatmentEpisode: CommerceEpisode;
  readonly taskPack: ReturnType<typeof parseTaskPackIdentity>;
}> {
  const report = await readJsonArtifact(
    campaignRoot,
    reportPointer,
    parseCommercePairedImpactReport,
  );
  const [experiment, controlEpisode, treatmentEpisode] = await Promise.all([
    readJsonArtifact(campaignRoot, report.evidence.experiment, parseCommerceExperiment),
    readJsonArtifact(campaignRoot, report.evidence.control_episode, parseCommerceEpisode),
    readJsonArtifact(campaignRoot, report.evidence.treatment_episode, parseCommerceEpisode),
  ]);
  const [controlVariant, treatmentVariant, taskPack] = await Promise.all([
    readJsonArtifact(
      campaignRoot,
      {
        ref: parseArtifactRef("artifact://campaign/variants/control.json"),
        sha256: experiment.control_variant_digest,
      },
      parseCommerceVariant,
    ),
    readJsonArtifact(
      campaignRoot,
      {
        ref: parseArtifactRef("artifact://campaign/variants/treatment.json"),
        sha256: experiment.treatment_variant_digest,
      },
      parseCommerceVariant,
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
  if (
    taskPack.schema_version !== 2 ||
    taskPack.template_id !== "commerce-order-cancellation-v1" ||
    report.experiment_digest !== report.evidence.experiment.sha256 ||
    report.campaign_id !== experiment.campaign_id ||
    controlEpisode.campaign_id !== experiment.campaign_id ||
    treatmentEpisode.campaign_id !== experiment.campaign_id ||
    controlEpisode.arm !== "control" ||
    treatmentEpisode.arm !== "treatment"
  ) {
    failure("Commerce Campaign identity drifted");
  }
  if (
    controlVariant.variant_id !== "goal-off" ||
    treatmentVariant.variant_id !== "goal-on" ||
    canonicalJson(commonVariant(controlVariant)) !== canonicalJson(commonVariant(treatmentVariant))
  ) {
    failure("Commerce VariantSpecs drifted outside Goal intervention");
  }
  const expectedDeployment = fingerprintEvalDeployment({
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
  const qualificationMatches =
    (projection === undefined && qualification.deployment_digest === expectedDeployment) ||
    (projection !== undefined &&
      projection.source_deployment_digest === qualification.deployment_digest &&
      projection.projected_deployment_digest === expectedDeployment &&
      projection.source_qualification_sha256 === canonicalJsonDigest(qualification));
  if (
    experiment.deployment.digest !== expectedDeployment ||
    experiment.deployment.eval_package_sha256 !== controlVariant.eval_package_sha256 ||
    !qualificationMatches ||
    qualification.common_tool_schema_sha256 !== controlVariant.tool_schema_sha256 ||
    controlEpisode.variant_digest !== experiment.control_variant_digest ||
    treatmentEpisode.variant_digest !== experiment.treatment_variant_digest ||
    controlEpisode.workspace_base_digest !== taskPack.pack.base_tree_sha256 ||
    treatmentEpisode.workspace_base_digest !== taskPack.pack.base_tree_sha256
  ) {
    failure("Commerce deployment, qualification, Task Pack, or Episode drifted");
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
    verifyEpisodeBytes(campaignRoot, "control", controlEpisode),
    verifyEpisodeBytes(campaignRoot, "treatment", treatmentEpisode),
    readArtifactBytesByRef(campaignRoot, "artifact://campaign/oracle/seed.json"),
    readArtifactBytesByRef(campaignRoot, "artifact://campaign/oracle/control/behavior.json"),
    readArtifactBytesByRef(campaignRoot, "artifact://campaign/oracle/treatment/behavior.json"),
  ]);
  const publicTask = new TextDecoder("utf-8", { fatal: true }).decode(publicTaskBytes);
  parseCommerceSeed(decodeCanonical(seedArtifact.bytes));
  const controlBehavior = parseCommerceBehavior(decodeCanonical(controlOracle.bytes));
  const treatmentBehavior = parseCommerceBehavior(decodeCanonical(treatmentOracle.bytes));
  const controlEvaluation = commerceEvaluationFromFrozenEvidence({
    episode: controlEpisode,
    sessionText: controlSession,
    publicTask,
    variant: controlVariant,
    behavior: controlBehavior,
  });
  const treatmentEvaluation = commerceEvaluationFromFrozenEvidence({
    episode: treatmentEpisode,
    sessionText: treatmentSession,
    publicTask,
    variant: treatmentVariant,
    behavior: treatmentBehavior,
  });
  const reconstructed = parseCommercePairedEvaluation({
    schema_version: 2,
    template_id: "commerce-order-cancellation-v1",
    campaign_id: experiment.campaign_id,
    oracle_seed: seedArtifact.pointer,
    measurement_validity: combineCommerceValidity(
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
  });
  if (
    report.evidence.evaluation.ref !== "artifact://campaign/evaluation.json" ||
    report.evidence.evaluation.sha256 !== canonicalJsonDigest(reconstructed)
  ) {
    failure("Commerce report does not bind reconstructed evaluation");
  }
  const evaluation = await readJsonArtifact(
    campaignRoot,
    report.evidence.evaluation,
    parseCommercePairedEvaluation,
  );
  if (canonicalJson(evaluation) !== canonicalJson(reconstructed)) {
    failure("Commerce persisted evaluation differs from frozen evidence");
  }
  const rebuiltReport = buildCommercePairedImpactReport({
    experiment,
    experimentPointer: artifactPointer(report.evidence.experiment),
    pairedEvaluation: reconstructed,
    evaluationPointer: artifactPointer(report.evidence.evaluation),
    controlEpisodePointer: artifactPointer(report.evidence.control_episode),
    treatmentEpisodePointer: artifactPointer(report.evidence.treatment_episode),
  });
  if (canonicalJson(report) !== canonicalJson(rebuiltReport)) {
    failure("Commerce persisted report differs from reconstructed report");
  }
  return { report, evaluation, experiment, controlEpisode, treatmentEpisode, taskPack };
}
