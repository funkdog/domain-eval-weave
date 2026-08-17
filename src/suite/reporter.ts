import type { ArtifactPointer } from "../contracts/artifacts.js";
import type { EvaluationResult, PairedImpactReport } from "../contracts/parsers.js";
import {
  type ActivationArtifact,
  parseSuiteEvaluationArtifact,
  parseSuiteReport,
  type SuiteEvaluationArtifact,
  type SuiteReport,
  type SuiteTaskEvaluation,
  type TaskEntry,
} from "../contracts/phase2.js";
import type { SuiteArtifactPointer } from "../contracts/suite-artifacts.js";

export interface SuiteCampaignEvidence {
  readonly task: TaskEntry;
  readonly campaignId: string;
  readonly campaignPointer: SuiteArtifactPointer;
  readonly campaignReportPointer: ArtifactPointer;
  readonly report: PairedImpactReport;
  readonly activation: {
    readonly control: ActivationArtifact;
    readonly treatment: ActivationArtifact;
  };
}

function summarizeArm(result: EvaluationResult): SuiteTaskEvaluation["arms"]["control"] {
  return {
    externally_verified_completion: result.outcome.externally_verified_completion,
    completion_claim: result.outcome.completion_claim,
    goal_activated: result.mechanism.goal_created,
    goal_rounds_started: result.mechanism.goal_rounds_started,
    goal_terminal_phase: result.mechanism.goal_terminal_phase,
    cost: result.cost,
  };
}

function assessActivation(
  task: TaskEntry,
  report: PairedImpactReport,
  activation: SuiteCampaignEvidence["activation"],
): SuiteTaskEvaluation["activation_assessment"] {
  const treatmentActivated = activation.treatment.summary.activated;
  if (activation.control.summary.activated) {
    return {
      status: "invalid",
      code: "CONTROL_CONTAMINATION",
      treatment_activated: treatmentActivated,
    };
  }
  if (report.measurement_validity.overall === "invalid") {
    return { status: "invalid", code: "CAMPAIGN_INVALID", treatment_activated: treatmentActivated };
  }
  if (task.bucket === "trigger") {
    return treatmentActivated
      ? {
          status: "pass",
          code: "ACTIVATION_EXPECTED_OBSERVED",
          treatment_activated: true,
        }
      : {
          status: "insufficient",
          code: "TRIGGER_ACTIVATION_MISSING",
          treatment_activated: false,
        };
  }
  if (task.bucket === "non-trigger") {
    return treatmentActivated
      ? { status: "fail", code: "NON_TRIGGER_OVER_ACTIVATION", treatment_activated: true }
      : { status: "pass", code: "NON_TRIGGER_ACTIVATION_ABSENT", treatment_activated: false };
  }
  return treatmentActivated
    ? { status: "pass", code: "HOLDOUT_ACTIVATION_OBSERVED", treatment_activated: true }
    : { status: "pass", code: "HOLDOUT_ACTIVATION_ABSENT", treatment_activated: false };
}

function effectiveTaskValidity(
  task: TaskEntry,
  report: PairedImpactReport,
  assessment: SuiteTaskEvaluation["activation_assessment"],
): SuiteTaskEvaluation["suite_overall"] {
  if (report.measurement_validity.overall === "invalid" || assessment.status === "invalid") {
    return "invalid";
  }
  if (assessment.status === "insufficient") return "insufficient";
  if (report.measurement_validity.overall === "valid") return "valid";
  const reasonCodes = report.measurement_validity.reasons.map((reason) => reason.code);
  if (
    task.bucket !== "trigger" &&
    assessment.treatment_activated === false &&
    reasonCodes.length > 0 &&
    reasonCodes.every((code) => code === "GOAL_NOT_ACTIVATED")
  ) {
    return "valid";
  }
  return "insufficient";
}

export function buildSuiteEvaluation(
  suiteId: string,
  evidence: readonly SuiteCampaignEvidence[],
): SuiteEvaluationArtifact {
  const tasks = evidence.map((entry): SuiteTaskEvaluation => {
    const activationAssessment = assessActivation(entry.task, entry.report, entry.activation);
    return {
      task_id: entry.task.task_id,
      bucket: entry.task.bucket,
      campaign_id: entry.campaignId,
      campaign_pointer: entry.campaignPointer,
      campaign_report: entry.campaignReportPointer,
      paired_overall: entry.report.measurement_validity.overall,
      suite_overall: effectiveTaskValidity(entry.task, entry.report, activationAssessment),
      activation_assessment: activationAssessment,
      arms: {
        control: summarizeArm(entry.report.arms.control),
        treatment: summarizeArm(entry.report.arms.treatment),
      },
      cost_delta: entry.report.cost_delta,
    };
  });
  const activationStatuses = tasks.map((task) => task.activation_assessment.status);
  const measurementValidity =
    tasks.some((task) => task.suite_overall === "invalid") || activationStatuses.includes("invalid")
      ? "invalid"
      : tasks.some((task) => task.suite_overall === "insufficient") ||
          activationStatuses.includes("insufficient")
        ? "insufficient"
        : "valid";
  const reasons = tasks
    .filter(
      (task) =>
        task.suite_overall !== "valid" ||
        task.activation_assessment.status === "fail" ||
        task.activation_assessment.status === "insufficient" ||
        task.activation_assessment.status === "invalid",
    )
    .map((task) => task.activation_assessment.code)
    .filter((code, index, values) => values.indexOf(code) === index);
  const byBucket = (bucket: TaskEntry["bucket"]) => tasks.find((task) => task.bucket === bucket);
  const trigger = byBucket("trigger");
  const nonTrigger = byBucket("non-trigger");
  const holdout = byBucket("holdout");
  return parseSuiteEvaluationArtifact({
    schema_version: 1,
    suite_id: suiteId,
    measurement_validity: measurementValidity,
    reasons,
    tasks,
    summary: {
      valid_task_count: tasks.filter((task) => task.suite_overall === "valid").length,
      invalid_task_count: tasks.filter((task) => task.suite_overall === "invalid").length,
      insufficient_task_count: tasks.filter((task) => task.suite_overall === "insufficient").length,
      trigger_activation: trigger?.activation_assessment.treatment_activated ?? null,
      non_trigger_guardrail:
        nonTrigger === undefined
          ? null
          : nonTrigger.activation_assessment.code === "NON_TRIGGER_OVER_ACTIVATION"
            ? "fail"
            : "pass",
      holdout_activation_observed: holdout?.activation_assessment.treatment_activated ?? null,
    },
    claim_strength: "multi_task_diagnostic",
    effect_claim_eligible: false,
  });
}

export function buildSuiteReport(
  evaluation: SuiteEvaluationArtifact,
  evidence: SuiteReport["evidence"],
): SuiteReport {
  const trigger = evaluation.tasks.find((task) => task.bucket === "trigger");
  const nonTrigger = evaluation.tasks.find((task) => task.bucket === "non-trigger");
  const action: SuiteReport["recommendation"]["action"] =
    evaluation.measurement_validity === "invalid"
      ? "run_more"
      : trigger?.activation_assessment.status !== "pass"
        ? "iterate_binding"
        : evaluation.measurement_validity === "insufficient"
          ? "run_more"
          : nonTrigger?.activation_assessment.status === "fail"
            ? "keep_baseline"
            : "keep";
  return parseSuiteReport({
    ...evaluation,
    evidence,
    recommendation: {
      action,
      rationale_codes: evaluation.reasons.length > 0 ? evaluation.reasons : ["SUITE_VALID"],
    },
  });
}

function display(value: unknown): string {
  return value === null ? "insufficient" : String(value);
}

export function renderSuiteReportMarkdown(report: SuiteReport): string {
  const taskRows = report.tasks.map(
    (task) =>
      `| ${task.bucket} | ${task.task_id} | ${task.paired_overall} / ${task.suite_overall} | ${task.activation_assessment.status} | ${task.activation_assessment.treatment_activated ? "yes" : "no"} | ${display(task.arms.control.externally_verified_completion)} | ${display(task.arms.treatment.externally_verified_completion)} |`,
  );
  return [
    `# DSH Eval Lab Suite — ${report.suite_id}`,
    "",
    `Claim strength: ${report.claim_strength}; effect claim eligible: ${report.effect_claim_eligible ? "yes" : "no"}.`,
    "",
    `Measurement validity: **${report.measurement_validity}**`,
    "",
    "| Bucket | Task | Paired / Suite validity | Activation | Treatment activated | Control verified | Treatment verified |",
    "|---|---|---|---|---:|---:|---:|",
    ...taskRows,
    "",
    "## Summary",
    "",
    `Trigger activation: ${display(report.summary.trigger_activation)}.`,
    `Non-trigger guardrail: ${display(report.summary.non_trigger_guardrail)}.`,
    `Holdout activation observed: ${display(report.summary.holdout_activation_observed)}.`,
    "",
    "## Next action",
    "",
    `**${report.recommendation.action}** — local diagnostic guidance only; no automatic promotion or rollback.`,
    "",
  ].join("\n");
}
