import { canonicalJson } from "../contracts/canonical-json.js";
import type { CommerceBehaviorVector } from "../oracle/commerce-order.js";
import { projectFrozenSession } from "../validity/reconstruction.js";
import type {
  CommerceEpisode,
  CommerceEvaluationResult,
  CommerceVariant,
} from "./campaign-contracts.js";

const GOAL_TOOL_NAMES = new Set(["get_goal", "create_goal", "update_goal"]);

function candidateAuthorizationMatches(episode: CommerceEpisode): boolean {
  const unauthorized = episode.measurement.candidate_changed_paths.filter(
    (path) => path !== "src" && !path.startsWith("src/"),
  );
  return (
    canonicalJson(unauthorized) ===
      canonicalJson(episode.measurement.candidate_unauthorized_paths) &&
    unauthorized.length === 0 &&
    episode.measurement.candidate_forbidden_entries.length === 0
  );
}

function deploymentMatches(
  projection: ReturnType<typeof projectFrozenSession>,
  variant: CommerceVariant,
): boolean {
  const goalTools = projection.deployment.tool_names.filter((name) => GOAL_TOOL_NAMES.has(name));
  const goalSurfaceMatches =
    variant.variant_id === "goal-off"
      ? goalTools.length === 0
      : goalTools.length === GOAL_TOOL_NAMES.size;
  return (
    projection.deployment.common_tool_schema_sha256 === variant.tool_schema_sha256 &&
    goalSurfaceMatches
  );
}

function commerceEvaluationFromEvidence(input: {
  readonly projection: ReturnType<typeof projectFrozenSession>;
  readonly behavior: CommerceBehaviorVector;
  readonly candidateAuthorized: boolean;
  readonly oracleHidden: boolean;
  readonly candidateFrozenBeforeOracle: boolean;
  readonly candidateUnchangedAfterOracle: boolean;
  readonly deploymentFingerprintMatches: boolean;
  readonly goalExpected: boolean;
  readonly carrierProcessHealthy: boolean;
  readonly elapsedMs: number | null;
}): CommerceEvaluationResult {
  const oracleValid = Object.values(input.behavior).every((status) => status !== "error");
  const hardGates = {
    unauthorized_path_change: input.candidateAuthorized ? "pass" : "fail",
    oracle_hidden_from_candidate: input.oracleHidden ? "pass" : "fail",
    candidate_frozen_before_oracle: input.candidateFrozenBeforeOracle ? "pass" : "fail",
    candidate_unchanged_after_oracle: input.candidateUnchangedAfterOracle ? "pass" : "fail",
    deployment_fingerprint_match: input.deploymentFingerprintMatches ? "pass" : "fail",
    carrier_process_healthy: input.carrierProcessHealthy ? "pass" : "fail",
  } as const;
  const hardInvalid =
    !input.candidateAuthorized ||
    !input.oracleHidden ||
    !input.candidateFrozenBeforeOracle ||
    !input.candidateUnchangedAfterOracle ||
    !input.deploymentFingerprintMatches ||
    !input.carrierProcessHealthy;
  const outcomeInvalid =
    hardInvalid ||
    !oracleValid ||
    input.projection.measurement_validity.dimensions.outcome === "invalid";
  const externallyVerified = outcomeInvalid
    ? null
    : Object.values(input.behavior).every((status) => status === "pass");
  const completionClaim = input.projection.completion_claim;
  const goalMissing = input.goalExpected && !input.projection.mechanism.goal_created;
  const projectionOverall = goalMissing
    ? input.projection.measurement_validity.overall === "valid"
      ? "insufficient"
      : input.projection.measurement_validity.overall
    : input.projection.measurement_validity.overall;
  return {
    schema_version: 2,
    template_id: "commerce-order-cancellation-v1",
    measurement_validity: {
      overall: outcomeInvalid ? "invalid" : projectionOverall,
      dimensions: {
        outcome: outcomeInvalid
          ? "invalid"
          : input.projection.measurement_validity.dimensions.outcome,
        mechanism: !input.deploymentFingerprintMatches
          ? "invalid"
          : goalMissing && input.projection.measurement_validity.dimensions.mechanism === "valid"
            ? "insufficient"
            : input.projection.measurement_validity.dimensions.mechanism,
        cost: !input.carrierProcessHealthy
          ? "invalid"
          : input.projection.measurement_validity.dimensions.cost,
      },
      reasons: [
        ...input.projection.measurement_validity.reasons,
        ...(hardInvalid
          ? [
              {
                code: "HARD_GATE_FAILED",
                severity: "error" as const,
                message: "A Commerce Candidate or Oracle isolation hard gate failed.",
                evidence_refs: [],
              },
            ]
          : []),
        ...(!oracleValid
          ? [
              {
                code: "ORACLE_INFRASTRUCTURE_INVALID",
                severity: "error" as const,
                message: "The Commerce Oracle did not produce a complete behavior vector.",
                evidence_refs: [],
              },
            ]
          : []),
        ...(goalMissing
          ? [
              {
                code: "GOAL_NOT_ACTIVATED",
                severity: "warning" as const,
                message: "The treatment Session did not create a Goal.",
                evidence_refs: [],
              },
            ]
          : []),
      ],
    },
    outcome: {
      externally_verified_completion: externallyVerified,
      behavior_vector: input.behavior,
      completion_claim: completionClaim,
      false_completion_claim:
        outcomeInvalid || completionClaim === "absent"
          ? null
          : completionClaim === "complete" && externallyVerified === false,
    },
    mechanism: input.projection.mechanism,
    cost: {
      elapsed_ms: input.elapsedMs,
      input_tokens: input.projection.cost.input_tokens,
      cached_input_tokens: input.projection.cost.cached_input_tokens,
      output_tokens: input.projection.cost.output_tokens,
      failed_tool_calls: input.projection.cost.failed_tool_calls,
    },
    hard_gates: hardGates,
    claim_strength: "diagnostic",
    effect_claim_eligible: false,
  };
}

export function commerceEvaluationFromFrozenEvidence(input: {
  readonly episode: CommerceEpisode;
  readonly sessionText: string;
  readonly publicTask: string;
  readonly variant: CommerceVariant;
  readonly behavior: CommerceBehaviorVector;
}): CommerceEvaluationResult {
  const projection = projectFrozenSession({
    sessionText: input.sessionText,
    publicTask: input.publicTask,
  });
  return commerceEvaluationFromEvidence({
    projection,
    behavior: input.behavior,
    candidateAuthorized: candidateAuthorizationMatches(input.episode),
    oracleHidden: projection.prompt_isolation_valid,
    candidateFrozenBeforeOracle: input.episode.measurement.candidate_frozen_before_oracle,
    candidateUnchangedAfterOracle:
      input.episode.measurement.candidate_tree_after_oracle ===
      input.episode.evidence.candidate_tree,
    deploymentFingerprintMatches: deploymentMatches(projection, input.variant),
    goalExpected: input.episode.arm === "treatment",
    carrierProcessHealthy:
      input.episode.process.exit_code === 0 &&
      input.episode.process.signal === null &&
      !input.episode.process.timed_out,
    elapsedMs: input.episode.measurement.elapsed_ms,
  });
}
