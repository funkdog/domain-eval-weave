import type { ArtifactPointer } from "../contracts/artifacts.js";
import type { MeasurementValidity } from "../contracts/parsers.js";
import type {
  CommerceExperiment,
  CommercePairedEvaluation,
  CommercePairedImpactReport,
} from "./campaign-contracts.js";
import { parseCommercePairedImpactReport } from "./campaign-contracts.js";

function delta(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : right - left;
}

export function combineCommerceValidity(
  control: MeasurementValidity,
  treatment: MeasurementValidity,
): MeasurementValidity {
  const combine = (
    left: "valid" | "invalid" | "insufficient",
    right: "valid" | "invalid" | "insufficient",
  ) =>
    left === "invalid" || right === "invalid"
      ? "invalid"
      : left === "insufficient" || right === "insufficient"
        ? "insufficient"
        : "valid";
  return {
    overall: combine(control.overall, treatment.overall),
    dimensions: {
      outcome: combine(control.dimensions.outcome, treatment.dimensions.outcome),
      mechanism: combine(control.dimensions.mechanism, treatment.dimensions.mechanism),
      cost: combine(control.dimensions.cost, treatment.dimensions.cost),
    },
    reasons: [...control.reasons, ...treatment.reasons],
  };
}

function costDelta(evaluation: CommercePairedEvaluation) {
  const control = evaluation.arms.control.result.cost;
  const treatment = evaluation.arms.treatment.result.cost;
  return {
    elapsed_ms: delta(control.elapsed_ms, treatment.elapsed_ms),
    input_tokens: delta(control.input_tokens, treatment.input_tokens),
    cached_input_tokens: delta(control.cached_input_tokens, treatment.cached_input_tokens),
    output_tokens: delta(control.output_tokens, treatment.output_tokens),
    failed_tool_calls: delta(control.failed_tool_calls, treatment.failed_tool_calls),
  };
}

function recommendation(evaluation: CommercePairedEvaluation, costs: ReturnType<typeof costDelta>) {
  const validity = evaluation.measurement_validity.overall;
  const control = evaluation.arms.control.result;
  const treatment = evaluation.arms.treatment.result;
  if (validity === "invalid" || validity === "insufficient") return "run_more" as const;
  if (treatment.mechanism.goal_created !== true) return "iterate" as const;
  if (
    control.outcome.externally_verified_completion === true &&
    treatment.outcome.externally_verified_completion === false
  ) {
    return "revert" as const;
  }
  if (
    control.outcome.externally_verified_completion !== true &&
    treatment.outcome.externally_verified_completion === true
  ) {
    return "run_more" as const;
  }
  if (
    control.outcome.externally_verified_completion !== true &&
    treatment.outcome.externally_verified_completion !== true
  ) {
    return "iterate" as const;
  }
  if (Object.values(costs).some((value) => value !== null && value > 0)) {
    return "keep_baseline" as const;
  }
  return "keep" as const;
}

export function buildCommercePairedImpactReport(input: {
  readonly experiment: CommerceExperiment;
  readonly experimentPointer: ArtifactPointer;
  readonly pairedEvaluation: CommercePairedEvaluation;
  readonly evaluationPointer: ArtifactPointer;
  readonly controlEpisodePointer: ArtifactPointer;
  readonly treatmentEpisodePointer: ArtifactPointer;
}): CommercePairedImpactReport {
  const costs = costDelta(input.pairedEvaluation);
  const action = recommendation(input.pairedEvaluation, costs);
  return parseCommercePairedImpactReport({
    schema_version: 2,
    template_id: "commerce-order-cancellation-v1",
    campaign_id: input.experiment.campaign_id,
    experiment_digest: input.experimentPointer.sha256,
    measurement_validity: input.pairedEvaluation.measurement_validity,
    arms: {
      control: input.pairedEvaluation.arms.control.result,
      treatment: input.pairedEvaluation.arms.treatment.result,
    },
    cost_delta: costs,
    evidence: {
      experiment: input.experimentPointer,
      control_episode: input.controlEpisodePointer,
      treatment_episode: input.treatmentEpisodePointer,
      evaluation: input.evaluationPointer,
    },
    known_blind_spots: [
      {
        code: "SINGLE_PAIR",
        severity: "info",
        message: "A single Commerce pair supports diagnostic claims only.",
        evidence_refs: [input.experimentPointer.ref],
      },
    ],
    recommendation: { action, rationale_codes: [`ACTION_${action.toUpperCase()}`] },
    claim_strength: "diagnostic",
    effect_claim_eligible: false,
  });
}

export function renderCommercePairedReport(report: CommercePairedImpactReport): string {
  return [
    `# Commerce Campaign ${report.campaign_id}`,
    "",
    `Measurement validity: **${report.measurement_validity.overall}**`,
    "",
    `Control verified: ${String(report.arms.control.outcome.externally_verified_completion)}`,
    `Treatment verified: ${String(report.arms.treatment.outcome.externally_verified_completion)}`,
    "",
    `Recommendation: **${report.recommendation.action}**`,
    "",
    "No aggregate behavior score is defined.",
    "",
  ].join("\n");
}
