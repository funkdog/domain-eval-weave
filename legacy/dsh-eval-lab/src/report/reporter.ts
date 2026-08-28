import type { ArtifactPointer } from "../contracts/artifacts.js";
import type {
  EvaluationResult,
  ExperimentSpec,
  MeasurementValidity,
  PairedEvaluationArtifact,
  PairedImpactReport,
} from "../contracts/parsers.js";

export type RecommendationInput = {
  readonly validity: "valid" | "invalid" | "insufficient";
  readonly controlPassed: boolean;
  readonly treatmentPassed: boolean;
  readonly treatmentGoalActivated: boolean;
  readonly treatmentCostHigher: boolean;
};

export function recommendAction(
  input: RecommendationInput,
): PairedImpactReport["recommendation"]["action"] {
  if (input.validity === "invalid") return "run_more";
  if (!input.treatmentGoalActivated) return "iterate";
  if (input.validity === "insufficient") return "run_more";
  if (input.controlPassed && !input.treatmentPassed) return "revert";
  if (!input.controlPassed && input.treatmentPassed) return "run_more";
  if (!input.controlPassed && !input.treatmentPassed) return "iterate";
  if (input.treatmentCostHigher) return "keep_baseline";
  return "keep";
}

function delta(control: number | null, treatment: number | null): number | null {
  return control === null || treatment === null ? null : treatment - control;
}

export function rawCostDelta(
  control: EvaluationResult["cost"],
  treatment: EvaluationResult["cost"],
): PairedImpactReport["cost_delta"] {
  return {
    elapsed_ms: delta(control.elapsed_ms, treatment.elapsed_ms),
    input_tokens: delta(control.input_tokens, treatment.input_tokens),
    cached_input_tokens: delta(control.cached_input_tokens, treatment.cached_input_tokens),
    output_tokens: delta(control.output_tokens, treatment.output_tokens),
    failed_tool_calls: delta(control.failed_tool_calls, treatment.failed_tool_calls),
  };
}

function passed(result: EvaluationResult): boolean {
  return result.outcome.externally_verified_completion === true;
}

function positiveCost(deltaValue: PairedImpactReport["cost_delta"]): boolean {
  return Object.values(deltaValue).some((value) => value !== null && value > 0);
}

export function buildPairedImpactReport(input: {
  readonly experiment: ExperimentSpec;
  readonly experimentPointer: ArtifactPointer;
  readonly pairedEvaluation: PairedEvaluationArtifact;
  readonly evaluationPointer: ArtifactPointer;
  readonly controlEpisodePointer: ArtifactPointer;
  readonly treatmentEpisodePointer: ArtifactPointer;
}): PairedImpactReport {
  const control = input.pairedEvaluation.arms.control.result;
  const treatment = input.pairedEvaluation.arms.treatment.result;
  const costDelta = rawCostDelta(control.cost, treatment.cost);
  const action = recommendAction({
    validity: input.pairedEvaluation.measurement_validity.overall,
    controlPassed: passed(control),
    treatmentPassed: passed(treatment),
    treatmentGoalActivated: treatment.mechanism.goal_created === true,
    treatmentCostHigher: positiveCost(costDelta),
  });
  return {
    schema_version: 1,
    campaign_id: input.experiment.campaign_id,
    experiment_digest: input.experimentPointer.sha256,
    measurement_validity: input.pairedEvaluation.measurement_validity,
    arms: { control, treatment },
    cost_delta: costDelta,
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
        message: "A single pair supports diagnostic claims only.",
        evidence_refs: [input.experimentPointer.ref],
      },
    ],
    recommendation: {
      action,
      rationale_codes: [`ACTION_${action.toUpperCase()}`],
    },
    claim_strength: "diagnostic",
    effect_claim_eligible: false,
  };
}

function display(value: unknown): string {
  return value === null ? "insufficient" : String(value);
}

export function renderPairedReportMarkdown(report: PairedImpactReport): string {
  const control = report.arms.control;
  const treatment = report.arms.treatment;
  const hardGateRows = [
    ...new Set([...Object.keys(control.hard_gates), ...Object.keys(treatment.hard_gates)]),
  ]
    .sort()
    .map(
      (name) =>
        `| ${name} | ${control.hard_gates[name] ?? "unknown"} | ${treatment.hard_gates[name] ?? "unknown"} |`,
    )
    .join("\n");
  const blindSpots = [...report.measurement_validity.reasons, ...report.known_blind_spots]
    .filter(
      (diagnostic, index, values) =>
        values.findIndex((candidate) => candidate.code === diagnostic.code) === index,
    )
    .map((diagnostic) => `- ${diagnostic.code}: ${diagnostic.message}`)
    .join("\n");
  return [
    `# DSH Eval Lab — ${report.campaign_id}`,
    "",
    `Claim strength: ${report.claim_strength}; effect claim eligible: ${report.effect_claim_eligible ? "yes" : "no"}.`,
    "",
    "## Validity",
    "",
    `Overall: **${report.measurement_validity.overall}**`,
    "",
    "## Outcome",
    "",
    "| Arm | Externally verified | Completion claim | False completion |",
    "|---|---:|---|---:|",
    `| control | ${display(control.outcome.externally_verified_completion)} | ${control.outcome.completion_claim} | ${display(control.outcome.false_completion_claim)} |`,
    `| treatment | ${display(treatment.outcome.externally_verified_completion)} | ${treatment.outcome.completion_claim} | ${display(treatment.outcome.false_completion_claim)} |`,
    "",
    "## Mechanism",
    "",
    `Control Goal created: ${display(control.mechanism.goal_created)}; treatment Goal created: ${display(treatment.mechanism.goal_created)}.`,
    `Treatment continuation rounds: ${display(treatment.mechanism.goal_rounds_started)}; terminal phase: ${display(treatment.mechanism.goal_terminal_phase)}.`,
    "",
    "## Cost",
    "",
    "| Metric | control | treatment | raw delta |",
    "|---|---:|---:|---:|",
    ...(
      [
        "elapsed_ms",
        "input_tokens",
        "cached_input_tokens",
        "output_tokens",
        "failed_tool_calls",
      ] as const
    ).map(
      (field) =>
        `| ${field} | ${display(control.cost[field])} | ${display(treatment.cost[field])} | ${display(report.cost_delta[field])} |`,
    ),
    "",
    "## Hard gates",
    "",
    "| Gate | control | treatment |",
    "|---|---|---|",
    hardGateRows,
    "",
    "## Blind spots",
    "",
    blindSpots || "- None recorded.",
    "",
    "## Next action",
    "",
    `**${report.recommendation.action}** — this is a local diagnostic recommendation, not an automatic lifecycle action.`,
    "",
    "Keep retains the current local choice; Iterate changes the experiment; Revert restores the local baseline; Run More asks for more evidence.",
    "",
  ].join("\n");
}

export function combinePairedValidity(
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
