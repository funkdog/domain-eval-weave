import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";
import type {
  Diagnostic,
  EpisodeRecord,
  EvaluationResult,
  LegacyEpisodeRecordV2,
  VariantSpec,
} from "../contracts/parsers.js";
import type { BehaviorVector } from "../oracle/ledger.js";
import { decodeOfficialSessionJsonl } from "../projector/jsonl.js";
import { projectSessionEvidence, type SessionProjection } from "../projector/projector.js";
import { evaluationFromEvidence } from "./evaluation.js";

const GOAL_TOOL_NAMES = new Set(["get_goal", "create_goal", "update_goal"]);

function invalidSessionProjection(message: string): SessionProjection {
  const diagnostic: Diagnostic = {
    code: "SESSION_EVIDENCE_INVALID",
    severity: "error",
    message,
    evidence_refs: [],
  };
  const emptyToolDigest = sha256Hex(canonicalJson([]));
  return {
    measurement_validity: {
      overall: "invalid",
      dimensions: { outcome: "invalid", mechanism: "invalid", cost: "invalid" },
      reasons: [diagnostic],
    },
    prompt_isolation_valid: false,
    completion_claim: "absent",
    mechanism: {
      goal_created: false,
      goal_rounds_started: 0,
      goal_terminal_phase: "none",
      tool_calls: {},
      turns: 0,
      steps: 0,
    },
    cost: {
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      failed_tool_calls: 0,
    },
    deployment: {
      common_tool_schema_sha256: emptyToolDigest,
      full_tool_schema_sha256: emptyToolDigest,
      tool_names: [],
    },
  };
}

export function projectFrozenSession(input: {
  readonly sessionText: string;
  readonly publicTask: string;
}): SessionProjection {
  try {
    return projectSessionEvidence({
      ...decodeOfficialSessionJsonl(input.sessionText),
      expectedPublicTask: input.publicTask,
    });
  } catch {
    return invalidSessionProjection(
      "The frozen Session could not be decoded with the official decoder.",
    );
  }
}

function candidateAuthorizationMatches(episode: EpisodeRecord): boolean {
  const computedUnauthorized = episode.measurement.candidate_changed_paths.filter(
    (path) => path !== "src" && !path.startsWith("src/"),
  );
  return (
    canonicalJson(computedUnauthorized) ===
      canonicalJson(episode.measurement.candidate_unauthorized_paths) &&
    computedUnauthorized.length === 0 &&
    episode.measurement.candidate_forbidden_entries.length === 0
  );
}

function deploymentMatches(projection: SessionProjection, variant: VariantSpec): boolean {
  const presentGoalTools = projection.deployment.tool_names.filter((name) =>
    GOAL_TOOL_NAMES.has(name),
  );
  const goalSurfaceMatches =
    variant.variant_id === "goal-off"
      ? presentGoalTools.length === 0
      : presentGoalTools.length === GOAL_TOOL_NAMES.size;
  return (
    projection.deployment.common_tool_schema_sha256 === variant.tool_schema_sha256 &&
    goalSurfaceMatches
  );
}

export function evaluationFromFrozenEvidence(input: {
  readonly episode: EpisodeRecord;
  readonly sessionText: string;
  readonly publicTask: string;
  readonly variant: VariantSpec;
  readonly behavior: BehaviorVector;
}): EvaluationResult {
  const projection = projectFrozenSession({
    sessionText: input.sessionText,
    publicTask: input.publicTask,
  });
  return evaluationFromEvidence({
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

export function evaluationFromLegacyV2Evidence(input: {
  readonly episode: LegacyEpisodeRecordV2;
  readonly persistedResult: EvaluationResult;
  readonly sessionText: string;
  readonly publicTask: string;
  readonly variant: VariantSpec;
  readonly behavior: BehaviorVector;
}): EvaluationResult {
  const projection = projectFrozenSession({
    sessionText: input.sessionText,
    publicTask: input.publicTask,
  });
  return evaluationFromEvidence({
    projection,
    behavior: input.behavior,
    candidateAuthorized: input.persistedResult.hard_gates.unauthorized_path_change === "pass",
    oracleHidden: projection.prompt_isolation_valid,
    candidateFrozenBeforeOracle:
      input.persistedResult.hard_gates.candidate_frozen_before_oracle === "pass",
    candidateUnchangedAfterOracle:
      input.persistedResult.hard_gates.candidate_unchanged_after_oracle === "pass",
    deploymentFingerprintMatches: deploymentMatches(projection, input.variant),
    goalExpected: input.episode.arm === "treatment",
    carrierProcessHealthy:
      input.episode.process.exit_code === 0 &&
      input.episode.process.signal === null &&
      !input.episode.process.timed_out,
    elapsedMs: input.persistedResult.cost.elapsed_ms,
  });
}
