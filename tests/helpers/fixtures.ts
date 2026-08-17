export const DIGEST_A = "a".repeat(64);
export const DIGEST_B = "b".repeat(64);
export const DIGEST_C = "c".repeat(64);
export const DIGEST_D = "d".repeat(64);

export const validExperiment = {
  schema_version: 1,
  campaign_id: "campaign-m0",
  created_at: "2026-08-17T08:00:00.000Z",
  domain: "open-coding-delivery",
  eval_pack_id: "open-coding-delivery-v1",
  task_pack_digest: DIGEST_A,
  control_variant_digest: DIGEST_B,
  treatment_variant_digest: DIGEST_C,
  intervention: {
    id: "dsh-goal-stack",
    allowed_config_paths: [
      "goal.disabled",
      "goal-round-driver.disabled",
      "command-goal.disabled",
      "tool-goal.disabled",
    ],
  },
  arm_order: ["control", "treatment"],
  timeout_ms_per_arm: 2_700_000,
  claim_strength: "diagnostic",
  effect_claim_eligible: false,
} as const;

export const validEpisode = {
  schema_version: 1,
  episode_id: "episode-control-m0",
  campaign_id: "campaign-m0",
  arm: "control",
  variant_digest: DIGEST_B,
  workspace_base_digest: DIGEST_A,
  session_id: "session-control-m0",
  process: {
    started_at: "2026-08-17T08:00:00.000Z",
    ended_at: "2026-08-17T08:01:00.000Z",
    exit_code: 0,
    signal: null,
    timed_out: false,
  },
  evidence: {
    session_log_ref: "artifact://campaign/arms/control/session.jsonl",
    session_log_sha256: DIGEST_A,
    candidate_tree: "d".repeat(40),
    candidate_archive_ref: "artifact://campaign/arms/control/candidate.tar",
    candidate_archive_sha256: DIGEST_B,
  },
  infrastructure_errors: [],
} as const;

export const validTreatmentEpisode = {
  ...validEpisode,
  episode_id: "episode-treatment-m0",
  arm: "treatment",
  variant_digest: DIGEST_C,
  session_id: "session-treatment-m0",
  evidence: {
    ...validEpisode.evidence,
    session_log_ref: "artifact://campaign/arms/treatment/session.jsonl",
    candidate_archive_ref: "artifact://campaign/arms/treatment/candidate.tar",
  },
} as const;

export const validEvaluation = {
  schema_version: 1,
  measurement_validity: {
    overall: "valid",
    dimensions: {
      outcome: "valid",
      mechanism: "valid",
      cost: "valid",
    },
    reasons: [],
  },
  outcome: {
    externally_verified_completion: true,
    behavior_vector: {
      basic_reservation: "pass",
      idempotent_replay: "pass",
      conflicting_replay_rejected: "pass",
      no_oversubscription_concurrent: "pass",
      terminal_transition_idempotency: "pass",
      restart_recovery: "pass",
      corrupt_state_fail_closed: "pass",
      deterministic_snapshot: "pass",
    },
    completion_claim: "complete",
    false_completion_claim: false,
  },
  mechanism: {
    goal_created: false,
    goal_rounds_started: 0,
    goal_terminal_phase: "none",
    tool_calls: { read: 2, workspace_test: 1 },
    turns: 1,
    steps: 3,
  },
  cost: {
    elapsed_ms: 60_000,
    input_tokens: 1_000,
    cached_input_tokens: 100,
    output_tokens: 200,
    failed_tool_calls: 0,
  },
  hard_gates: {
    unauthorized_path_change: "pass",
    oracle_hidden_from_candidate: "pass",
    candidate_frozen_before_oracle: "pass",
  },
  claim_strength: "diagnostic",
  effect_claim_eligible: false,
} as const;

export const validTreatmentEvaluation = {
  ...validEvaluation,
  mechanism: {
    ...validEvaluation.mechanism,
    goal_created: true,
    goal_rounds_started: 2,
    goal_terminal_phase: "complete",
  },
} as const;

export const validPairedEvaluation = {
  schema_version: 1,
  campaign_id: "campaign-m0",
  control: validEvaluation,
  treatment: validTreatmentEvaluation,
} as const;

export const validReport = {
  schema_version: 1,
  campaign_id: "campaign-m0",
  experiment_digest: DIGEST_A,
  measurement_validity: validEvaluation.measurement_validity,
  arms: {
    control: validEvaluation,
    treatment: validTreatmentEvaluation,
  },
  cost_delta: {
    elapsed_ms: 5_000,
    input_tokens: 200,
    cached_input_tokens: 0,
    output_tokens: 40,
    failed_tool_calls: 0,
  },
  evidence: {
    experiment: {
      ref: "artifact://campaign/manifest.json",
      sha256: DIGEST_A,
    },
    control_episode: {
      ref: "artifact://campaign/arms/control/episode.json",
      sha256: DIGEST_B,
    },
    treatment_episode: {
      ref: "artifact://campaign/arms/treatment/episode.json",
      sha256: DIGEST_C,
    },
    evaluation: {
      ref: "artifact://campaign/evaluation.json",
      sha256: DIGEST_D,
    },
  },
  known_blind_spots: [
    {
      code: "SINGLE_PAIR",
      severity: "info",
      message: "A single pair supports diagnostic claims only.",
      evidence_refs: ["artifact://campaign/manifest.json"],
    },
  ],
  recommendation: {
    action: "run_more",
    rationale_codes: ["SINGLE_PAIR"],
  },
  claim_strength: "diagnostic",
  effect_claim_eligible: false,
} as const;
