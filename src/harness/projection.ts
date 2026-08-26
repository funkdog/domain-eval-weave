import type { EvaluationRun } from "../capsule/contracts.js";

type Effect =
  | "improvement_observed"
  | "harm_observed"
  | "mixed"
  | "no_observed_difference"
  | "not_activated"
  | "inconclusive";

export interface HarnessExperimentReport {
  readonly schema_version: 1;
  readonly experiment_id: string;
  readonly capsule_release_sha256: string;
  readonly evaluator: EvaluationRun["evaluator"];
  readonly requirement_id: string;
  readonly intervention: {
    readonly intervention_id: string;
    readonly control: string;
    readonly treatment: string;
  };
  readonly control: Pick<
    EvaluationRun,
    "run_id" | "candidate_id" | "candidate_sha256" | "measurement_validity" | "verdict"
  >;
  readonly treatment: Pick<
    EvaluationRun,
    "run_id" | "candidate_id" | "candidate_sha256" | "measurement_validity" | "verdict"
  >;
  readonly activation: "activated" | "not_activated" | "unknown";
  readonly mechanism_validity: "valid" | "insufficient" | "invalid";
  readonly effect: Effect;
  readonly changed_claims: readonly string[];
  readonly cost_delta: {
    readonly elapsed_ms: number | null;
    readonly input_tokens: number | null;
    readonly output_tokens: number | null;
  };
  readonly claim_strength: "descriptive";
}

const STATUS_RANK: Readonly<Record<EvaluationRun["claims"][number]["status"], number>> = {
  fail: 0,
  measurement_error: 1,
  inconclusive: 1,
  pass: 2,
};

export function buildHarnessExperimentReport(input: {
  readonly experimentId: string;
  readonly control: EvaluationRun;
  readonly treatment: EvaluationRun;
  readonly intervention: HarnessExperimentReport["intervention"];
  readonly activation: HarnessExperimentReport["activation"];
  readonly mechanismValidity: HarnessExperimentReport["mechanism_validity"];
  readonly costDelta: HarnessExperimentReport["cost_delta"];
}): HarnessExperimentReport {
  const { control, treatment } = input;
  if (
    control.capsule_release_sha256 !== treatment.capsule_release_sha256 ||
    control.requirement_id !== treatment.requirement_id ||
    control.evaluator.evaluator_id !== treatment.evaluator.evaluator_id ||
    control.evaluator.version !== treatment.evaluator.version
  ) {
    throw new Error("Harness arms must share one exact Capsule, Requirement and Evaluator");
  }
  if (control.candidate_id === treatment.candidate_id) {
    throw new Error("Harness arms must bind distinct frozen Candidates");
  }
  const treatmentByClaim = new Map(treatment.claims.map((claim) => [claim.claim_id, claim.status]));
  const changedClaims = control.claims
    .filter((claim) => treatmentByClaim.get(claim.claim_id) !== claim.status)
    .map((claim) => claim.claim_id)
    .sort();
  let improved = false;
  let harmed = false;
  for (const claim of control.claims) {
    const treatmentStatus = treatmentByClaim.get(claim.claim_id);
    if (treatmentStatus === undefined) {
      harmed = true;
      continue;
    }
    if (STATUS_RANK[treatmentStatus] > STATUS_RANK[claim.status]) improved = true;
    if (STATUS_RANK[treatmentStatus] < STATUS_RANK[claim.status]) harmed = true;
  }
  const effect: Effect =
    input.mechanismValidity !== "valid" ||
    control.measurement_validity !== "valid" ||
    treatment.measurement_validity !== "valid" ||
    input.activation === "unknown"
      ? "inconclusive"
      : input.activation === "not_activated"
        ? "not_activated"
        : improved && harmed
          ? "mixed"
          : improved
            ? "improvement_observed"
            : harmed
              ? "harm_observed"
              : "no_observed_difference";
  return {
    schema_version: 1,
    experiment_id: input.experimentId,
    capsule_release_sha256: control.capsule_release_sha256,
    evaluator: control.evaluator,
    requirement_id: control.requirement_id,
    intervention: input.intervention,
    control: {
      run_id: control.run_id,
      candidate_id: control.candidate_id,
      candidate_sha256: control.candidate_sha256,
      measurement_validity: control.measurement_validity,
      verdict: control.verdict,
    },
    treatment: {
      run_id: treatment.run_id,
      candidate_id: treatment.candidate_id,
      candidate_sha256: treatment.candidate_sha256,
      measurement_validity: treatment.measurement_validity,
      verdict: treatment.verdict,
    },
    activation: input.activation,
    mechanism_validity: input.mechanismValidity,
    effect,
    changed_claims: changedClaims,
    cost_delta: input.costDelta,
    claim_strength: "descriptive",
  };
}
