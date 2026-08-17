const digest = (character: string): string => character.repeat(64);

export const validHarnessManifest = {
  schema_version: 1,
  harness_id: "dsh-goal-stack",
  harness_version: "0.1.0-rc.6",
  intervention: {
    rows: ["goal", "goal-round-driver", "command-goal", "tool-goal"],
    allowed_config_paths: [
      "goal.disabled",
      "goal-round-driver.disabled",
      "command-goal.disabled",
      "tool-goal.disabled",
    ],
  },
  activation: { source_event_type: "goal/change", contract_version: 1 },
  eval_binding: {
    eval_pack_id: "open-coding-goal-v1",
    registry_ref: "registry/registry.json",
    registry_sha256: digest("a"),
    expectations: {
      trigger: "activation-required",
      non_trigger: "activation-forbidden",
      holdout: "task-defined",
    },
    holdout_policy: "first-model-exposure-only",
  },
} as const;

export const validTaskEntry = {
  schema_version: 1,
  task_id: "ledger-full-v1",
  bucket: "trigger",
  public_task_ref: "task-packs/open-coding-ts-ledger-v1/public-task.md",
  public_task_sha256: digest("b"),
  base_ref: "task-packs/open-coding-ts-ledger-v1/base",
  overlays: [],
  effective_base_sha256: digest("c"),
  allowed_candidate_globs: ["src/**"],
  forbidden_entry_types: ["symlink", "submodule"],
  oracle: {
    runner_ref: "task-packs/open-coding-ts-ledger-v1/oracle/runner.mjs",
    runner_sha256: digest("d"),
    version: "ledger-oracle-v2",
    behavior_keys: [
      "basic_reservation",
      "idempotent_replay",
      "conflicting_replay_rejected",
      "no_oversubscription_concurrent",
      "terminal_transition_idempotency",
      "restart_recovery",
      "corrupt_state_fail_closed",
      "deterministic_snapshot",
    ],
  },
  activation_expectation: "required",
} as const;

export const validEvalPack = {
  schema_version: 1,
  eval_pack_id: "open-coding-goal-v1",
  domain: "open-coding-delivery",
  harness_id: "dsh-goal-stack",
  task_ids: ["ledger-full-v1", "ledger-audit-v1", "ledger-concurrency-v1"],
  buckets: {
    trigger: ["ledger-full-v1"],
    non_trigger: ["ledger-audit-v1"],
    holdout: ["ledger-concurrency-v1"],
  },
  claim_strength: "multi_task_diagnostic",
  effect_claim_eligible: false,
} as const;

export const validRegistry = {
  schema_version: 1,
  registry_id: "dsh-eval-lab-phase2-v1",
  eval_packs: [
    {
      id: "open-coding-goal-v1",
      ref: "eval-packs/open-coding-goal-v1/eval-pack.json",
      sha256: digest("e"),
    },
  ],
  tasks: [
    { id: "ledger-full-v1", ref: "registry/tasks/ledger-full-v1.json", sha256: digest("f") },
    { id: "ledger-audit-v1", ref: "registry/tasks/ledger-audit-v1.json", sha256: digest("1") },
    {
      id: "ledger-concurrency-v1",
      ref: "registry/tasks/ledger-concurrency-v1.json",
      sha256: digest("2"),
    },
  ],
} as const;

export const validActivationArtifact = {
  schema_version: 1,
  harness_id: "dsh-goal-stack",
  session_id: "session-1",
  events: [
    {
      sequence: 0,
      source_event_type: "goal/change",
      operation: "create",
      activation_type: "activated",
      goal_id: "goal-1",
      revision: 1,
      phase: "active",
      timestamp: "2026-08-18T00:00:00.000Z",
    },
  ],
  summary: {
    activated: true,
    event_count: 1,
    continuation_rounds: 0,
    terminal_phase: "active",
  },
} as const;

export const validExposureRecord = {
  schema_version: 1,
  exposure_id: "suite-1-ledger-full-v1-control",
  suite_id: "suite-1",
  campaign_id: "campaign-1",
  episode_id: "campaign-1-control",
  session_id: "session-1",
  task_id: "ledger-full-v1",
  bucket: "trigger",
  arm: "control",
  variant_digest: digest("3"),
  public_task_sha256: digest("4"),
  effective_base_sha256: digest("5"),
  candidate_archive: {
    ref: "artifact://campaign/arms/control/candidate.tar",
    sha256: digest("6"),
  },
  registry_digest: digest("7"),
  binding_digest: digest("8"),
  started_at: "2026-08-18T00:00:00.000Z",
  ended_at: "2026-08-18T00:01:00.000Z",
} as const;

export const validSuiteManifest = {
  schema_version: 1,
  suite_id: "suite-1",
  created_at: "2026-08-18T00:00:00.000Z",
  instance_id: "clowder-ai",
  harness_binding_digest: digest("8"),
  registry_digest: digest("7"),
  eval_pack_digest: digest("e"),
  deployment_digest: digest("9"),
  task_order: ["ledger-audit-v1", "ledger-full-v1", "ledger-concurrency-v1"],
  tasks: [
    { task_id: "ledger-audit-v1", bucket: "non-trigger", campaign_id: "campaign-audit" },
    { task_id: "ledger-full-v1", bucket: "trigger", campaign_id: "campaign-full" },
    {
      task_id: "ledger-concurrency-v1",
      bucket: "holdout",
      campaign_id: "campaign-concurrency",
    },
  ],
  timeout_ms_per_arm: 2_700_000,
  claim_strength: "multi_task_diagnostic",
  effect_claim_eligible: false,
} as const;
