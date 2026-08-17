import { canonicalJson, sha256Hex } from "../../src/contracts/canonical-json.js";
import { SYNTHETIC_COMMON_TOOL_DIGEST, SYNTHETIC_PUBLIC_TASK } from "./session.js";

export const DIGEST_A = "a".repeat(64);
export const DIGEST_B = "b".repeat(64);
export const DIGEST_C = "c".repeat(64);
export const DIGEST_D = "d".repeat(64);

export const validControlVariant = {
  schema_version: 1,
  variant_id: "goal-off",
  common_patch_sha256: DIGEST_A,
  arm_patch_sha256: DIGEST_B,
  expected_goal_rows: {
    goal: false,
    goal_round_driver: false,
    command_goal: false,
    tool_goal: false,
  },
  dsh_package_tree_sha256: DIGEST_C,
  codex_connect_package_sha256: DIGEST_D,
  eval_package_sha256: DIGEST_D,
  model_route: {
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
  },
  resolved_config_sha256: DIGEST_A,
  tool_schema_sha256: SYNTHETIC_COMMON_TOOL_DIGEST,
  tools_mode: "native",
  permission_mode: "workspace-write",
} as const;

export const validTreatmentVariant = {
  ...validControlVariant,
  variant_id: "goal-on",
  arm_patch_sha256: DIGEST_C,
  expected_goal_rows: {
    goal: true,
    goal_round_driver: true,
    command_goal: true,
    tool_goal: true,
  },
  resolved_config_sha256: DIGEST_D,
} as const;

export const validVariant = validControlVariant;
export const CONTROL_VARIANT_DIGEST = sha256Hex(canonicalJson(validControlVariant));
export const TREATMENT_VARIANT_DIGEST = sha256Hex(canonicalJson(validTreatmentVariant));

export const validTaskPackIdentity = {
  schema_version: 1,
  pack: {
    schema_version: 1,
    task_id: "open-coding-ts-ledger-v1",
    eval_pack_id: "open-coding-delivery-v1",
    base_tree_sha256: DIGEST_A,
    public_task_ref: "public-task.md",
    allowed_candidate_globs: ["src/**"],
    forbidden_entry_types: ["symlink", "submodule"],
    public_test_command: ["node", "--test", "test/public/*.test.ts"],
    oracle_version: "ledger-oracle-v2",
    calibration_digest: DIGEST_B,
  },
  public_task_sha256: sha256Hex(SYNTHETIC_PUBLIC_TASK),
  oracle_runner_sha256: DIGEST_D,
} as const;
export const TASK_PACK_DIGEST = sha256Hex(canonicalJson(validTaskPackIdentity));

export const DEPLOYMENT_DIGEST = sha256Hex(
  canonicalJson({
    control: validControlVariant.resolved_config_sha256,
    treatment: validTreatmentVariant.resolved_config_sha256,
    task_pack: TASK_PACK_DIGEST,
    model: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "xhigh" },
    dsh_package_tree: validControlVariant.dsh_package_tree_sha256,
    codex_connect_package: validControlVariant.codex_connect_package_sha256,
    eval_package: validControlVariant.eval_package_sha256,
    common_patch: validControlVariant.common_patch_sha256,
  }),
);

export const validQualificationEvidence = {
  schema_version: 1,
  ready: true,
  deployment_digest: DEPLOYMENT_DIGEST,
  session_id: "qualification-session-m0",
  common_tool_schema_sha256: validControlVariant.tool_schema_sha256,
} as const;

export const validCalibrationEvidence = {
  schema_version: 1,
  ready: true,
  task_pack_digest: TASK_PACK_DIGEST,
  calibration_digest: validTaskPackIdentity.pack.calibration_digest,
  eval_package_sha256: validControlVariant.eval_package_sha256,
  candidates: {
    red: ["fail", "fail", "fail", "fail", "fail", "fail", "fail", "fail"],
    gold: ["pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass"],
    no_lock_failures: ["no_oversubscription_concurrent"],
    no_persistence_failures: ["restart_recovery"],
    corrupt_resets_failures: ["corrupt_state_fail_closed"],
  },
  repeatable: true,
  seed_stable: true,
} as const;

export const validExperiment = {
  schema_version: 1,
  campaign_id: "campaign-m0",
  created_at: "2026-08-17T08:00:00.000Z",
  domain: "open-coding-delivery",
  eval_pack_id: "open-coding-delivery-v1",
  task_pack_digest: TASK_PACK_DIGEST,
  control_variant_digest: CONTROL_VARIANT_DIGEST,
  treatment_variant_digest: TREATMENT_VARIANT_DIGEST,
  deployment: {
    digest: DEPLOYMENT_DIGEST,
    eval_package_sha256: validControlVariant.eval_package_sha256,
    qualification: validQualificationEvidence,
    calibration: validCalibrationEvidence,
  },
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
  variant_digest: CONTROL_VARIANT_DIGEST,
  workspace_base_digest: validTaskPackIdentity.pack.base_tree_sha256,
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
    candidate_tree_ref: "artifact://campaign/arms/control/candidate.tree",
    candidate_tree_sha256: DIGEST_C,
    candidate_patch_ref: "artifact://campaign/arms/control/candidate.patch",
    candidate_patch_sha256: DIGEST_D,
    candidate_archive_ref: "artifact://campaign/arms/control/candidate.tar",
    candidate_archive_sha256: DIGEST_B,
    stdout_ref: "artifact://campaign/arms/control/stdout.txt",
    stdout_sha256: DIGEST_C,
    stderr_ref: "artifact://campaign/arms/control/stderr.txt",
    stderr_sha256: DIGEST_D,
  },
  measurement: {
    candidate_changed_paths: ["src/ledger.ts"],
    candidate_unauthorized_paths: [],
    candidate_forbidden_entries: [],
    candidate_frozen_before_oracle: true,
    candidate_tree_after_oracle: "d".repeat(40),
    elapsed_ms: 60_000,
  },
  infrastructure_errors: [],
} as const;

export const validTreatmentEpisode = {
  ...validEpisode,
  episode_id: "episode-treatment-m0",
  arm: "treatment",
  variant_digest: TREATMENT_VARIANT_DIGEST,
  session_id: "session-treatment-m0",
  evidence: {
    ...validEpisode.evidence,
    session_log_ref: "artifact://campaign/arms/treatment/session.jsonl",
    candidate_tree_ref: "artifact://campaign/arms/treatment/candidate.tree",
    candidate_patch_ref: "artifact://campaign/arms/treatment/candidate.patch",
    candidate_archive_ref: "artifact://campaign/arms/treatment/candidate.tar",
    stdout_ref: "artifact://campaign/arms/treatment/stdout.txt",
    stderr_ref: "artifact://campaign/arms/treatment/stderr.txt",
  },
  measurement: {
    ...validEpisode.measurement,
    elapsed_ms: 65_000,
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
    tool_calls: { workspace_test: 1 },
    turns: 1,
    steps: 1,
  },
  cost: {
    elapsed_ms: 60_000,
    input_tokens: 100,
    cached_input_tokens: 10,
    output_tokens: 20,
    failed_tool_calls: 0,
  },
  hard_gates: {
    unauthorized_path_change: "pass",
    oracle_hidden_from_candidate: "pass",
    candidate_frozen_before_oracle: "pass",
    candidate_unchanged_after_oracle: "pass",
    deployment_fingerprint_match: "pass",
    carrier_process_healthy: "pass",
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
  cost: {
    elapsed_ms: 65_000,
    input_tokens: 110,
    cached_input_tokens: 10,
    output_tokens: 25,
    failed_tool_calls: 0,
  },
} as const;

export const validPairedEvaluation = {
  schema_version: 1,
  campaign_id: "campaign-m0",
  oracle_seed: {
    ref: "artifact://campaign/oracle/seed.json",
    sha256: DIGEST_A,
  },
  measurement_validity: validEvaluation.measurement_validity,
  arms: {
    control: {
      episode: {
        ref: "artifact://campaign/arms/control/episode.json",
        sha256: DIGEST_B,
      },
      oracle: {
        ref: "artifact://campaign/oracle/control/behavior.json",
        sha256: DIGEST_C,
      },
      candidate: {
        tree: validEpisode.evidence.candidate_tree,
        archive: {
          ref: validEpisode.evidence.candidate_archive_ref,
          sha256: validEpisode.evidence.candidate_archive_sha256,
        },
      },
      result: validEvaluation,
    },
    treatment: {
      episode: {
        ref: "artifact://campaign/arms/treatment/episode.json",
        sha256: DIGEST_C,
      },
      oracle: {
        ref: "artifact://campaign/oracle/treatment/behavior.json",
        sha256: DIGEST_D,
      },
      candidate: {
        tree: validTreatmentEpisode.evidence.candidate_tree,
        archive: {
          ref: validTreatmentEpisode.evidence.candidate_archive_ref,
          sha256: validTreatmentEpisode.evidence.candidate_archive_sha256,
        },
      },
      result: validTreatmentEvaluation,
    },
  },
} as const;

export const validReport = {
  schema_version: 1,
  campaign_id: "campaign-m0",
  experiment_digest: DIGEST_A,
  measurement_validity: validPairedEvaluation.measurement_validity,
  arms: {
    control: validPairedEvaluation.arms.control.result,
    treatment: validPairedEvaluation.arms.treatment.result,
  },
  cost_delta: {
    elapsed_ms: 5_000,
    input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 5,
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
    action: "keep_baseline",
    rationale_codes: ["ACTION_KEEP_BASELINE"],
  },
  claim_strength: "diagnostic",
  effect_claim_eligible: false,
} as const;
