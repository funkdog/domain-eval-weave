import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { LEDGER_BEHAVIORS } from "../../src/oracle/ledger.js";

const digest = (character: string): string => character.repeat(64);

export const validObservationCatalog = {
  schema_version: 1,
  catalog_id: "reservation-ledger-v1",
  catalog_version: 1,
  task_id: "open-coding-ts-ledger-v1",
  oracle_version: "ledger-oracle-v3",
  template_id: "reservation-ledger-v1",
  behaviors: LEDGER_BEHAVIORS.map((behaviorId, index) => ({
    behavior_id: behaviorId,
    template_id: "reservation-ledger-v1" as const,
    statement: `Deterministically observe ${behaviorId.replaceAll("_", " ")}.`,
    risk_weight: index >= 3 && index <= 6 ? 5 : 3,
  })),
  counterexamples: [
    { candidate_id: "red", expected_failures: [...LEDGER_BEHAVIORS] },
    {
      candidate_id: "mutant-no-lock",
      expected_failures: ["no_oversubscription_concurrent"],
    },
    { candidate_id: "mutant-no-persistence", expected_failures: ["restart_recovery"] },
    {
      candidate_id: "mutant-corrupt-resets",
      expected_failures: ["corrupt_state_fail_closed"],
    },
    {
      candidate_id: "mutant-broken-release",
      expected_failures: ["terminal_transition_idempotency", "restart_recovery"],
    },
    {
      candidate_id: "mutant-release-not-persisted",
      expected_failures: ["restart_recovery"],
    },
  ],
} as const;

const catalogEntries = new Map(
  validObservationCatalog.behaviors.map((entry) => [entry.behavior_id, entry]),
);

const commandBehaviors = [
  "basic_reservation",
  "idempotent_replay",
  "conflicting_replay_rejected",
  "terminal_transition_idempotency",
] as const;
const preservationBehaviors = [
  "no_oversubscription_concurrent",
  "restart_recovery",
  "corrupt_state_fail_closed",
  "deterministic_snapshot",
] as const;

const bindings = (behaviorIds: readonly (typeof LEDGER_BEHAVIORS)[number][]) =>
  behaviorIds.map((behaviorId) => {
    const entry = catalogEntries.get(behaviorId);
    if (entry === undefined) throw new Error(`missing catalog entry: ${behaviorId}`);
    return { behavior_id: behaviorId, entry_sha256: canonicalJsonDigest(entry) };
  });

export const validClaimIr = {
  schema_version: 1,
  compiler: { compiler_id: "phase3b-deterministic-compiler", compiler_version: 1 },
  source: {
    domain_manifest: { ref: "manifests/reservation-v1.json", sha256: digest("1") },
    contract: { ref: "contracts/reservation-ledger/v1.json", sha256: digest("2") },
    requirement: { ref: "requirements/implement-ledger/v1.json", sha256: digest("3") },
    task_pack_sha256: digest("4"),
    observation_catalog_sha256: canonicalJsonDigest(validObservationCatalog),
  },
  requirement: {
    requirement_id: "implement-reservation-ledger",
    requirement_version: 1,
    product_id: "synthetic-reservations",
  },
  claims: [
    {
      claim_id: "reservation-command-contract",
      contract_version: 1,
      domain_id: "reservations",
      effect: "uses",
      axis: "requirement_delta",
      statement_sha256: digest("5"),
      false_accept_risk: "high",
      false_reject_risk: "medium",
      dependencies: [],
      observation_bindings: bindings(commandBehaviors),
    },
    {
      claim_id: "reservation-state-integrity",
      contract_version: 1,
      domain_id: "reliability",
      effect: "preserves",
      axis: "domain_preservation",
      statement_sha256: digest("6"),
      false_accept_risk: "critical",
      false_reject_risk: "high",
      dependencies: [],
      observation_bindings: bindings(preservationBehaviors),
    },
  ],
  semantic_residual: [],
  traceability: {
    claim_to_behaviors: {
      "reservation-command-contract": [...commandBehaviors],
      "reservation-state-integrity": [...preservationBehaviors],
    },
    behavior_to_claims: Object.fromEntries(
      LEDGER_BEHAVIORS.map((behaviorId) => [
        behaviorId,
        commandBehaviors.includes(behaviorId as (typeof commandBehaviors)[number])
          ? ["reservation-command-contract"]
          : ["reservation-state-integrity"],
      ]),
    ),
  },
} as const;

export const validOraclePlan = {
  schema_version: 1,
  plan_id: "implement-reservation-ledger-v1",
  claim_ir_sha256: canonicalJsonDigest(validClaimIr),
  task_pack_sha256: validClaimIr.source.task_pack_sha256,
  observation_catalog_sha256: validClaimIr.source.observation_catalog_sha256,
  oracle_version: "ledger-oracle-v3",
  checks: LEDGER_BEHAVIORS.map((behaviorId) => {
    const entry = catalogEntries.get(behaviorId);
    if (entry === undefined) throw new Error(`missing catalog entry: ${behaviorId}`);
    const requirement = commandBehaviors.includes(behaviorId as (typeof commandBehaviors)[number]);
    return {
      behavior_id: behaviorId,
      template_id: "reservation-ledger-v1",
      claim_ids: [requirement ? "reservation-command-contract" : "reservation-state-integrity"],
      axes: [requirement ? "requirement_delta" : "domain_preservation"],
      risk_weight: entry.risk_weight,
      hard_gate: true,
    };
  }),
} as const;

export const validGraderAdmission = {
  schema_version: 1,
  admission_id: "implement-reservation-ledger-v1-admission",
  oracle_plan_sha256: canonicalJsonDigest(validOraclePlan),
  task_pack_sha256: validOraclePlan.task_pack_sha256,
  observation_catalog_sha256: validOraclePlan.observation_catalog_sha256,
  eval_package_sha256: digest("7"),
  calibration: {
    seed: 1729,
    vectors: {
      red: Object.fromEntries(LEDGER_BEHAVIORS.map((behavior) => [behavior, "fail"])),
      gold: Object.fromEntries(LEDGER_BEHAVIORS.map((behavior) => [behavior, "pass"])),
      ...Object.fromEntries(
        validObservationCatalog.counterexamples
          .slice(1)
          .map((entry) => [
            entry.candidate_id,
            Object.fromEntries(
              LEDGER_BEHAVIORS.map((behavior) => [
                behavior,
                (entry.expected_failures as readonly string[]).includes(behavior) ? "fail" : "pass",
              ]),
            ),
          ]),
      ),
      "gold-repeat": Object.fromEntries(LEDGER_BEHAVIORS.map((behavior) => [behavior, "pass"])),
      "gold-next-seed": Object.fromEntries(LEDGER_BEHAVIORS.map((behavior) => [behavior, "pass"])),
    },
  },
  behavior_coverage: Object.fromEntries(
    LEDGER_BEHAVIORS.map((behaviorId) => [
      behaviorId,
      [
        "red",
        ...validObservationCatalog.counterexamples
          .slice(1)
          .filter((entry) => (entry.expected_failures as readonly string[]).includes(behaviorId))
          .map((entry) => entry.candidate_id),
      ],
    ]),
  ),
  checks: {
    red_detected: true,
    gold_passed: true,
    counterexamples_matched: true,
    repeatable: true,
    seed_stable: true,
    coverage_complete: true,
  },
  status: "admitted",
  diagnostics: [],
} as const;

const behaviorResult = (behaviorId: (typeof LEDGER_BEHAVIORS)[number]) => ({
  behavior_id: behaviorId,
  status: "pass" as const,
  evidence_ref: "artifact://campaign/oracle/treatment/behavior.json",
});

export const validDeliveryEvaluationReport = {
  schema_version: 1,
  evaluation_id: "delivery-implement-reservation-ledger-v1",
  source: {
    domain_manifest_sha256: validClaimIr.source.domain_manifest.sha256,
    requirement_sha256: validClaimIr.source.requirement.sha256,
    claim_ir_sha256: canonicalJsonDigest(validClaimIr),
    oracle_plan_sha256: canonicalJsonDigest(validOraclePlan),
    grader_admission_sha256: canonicalJsonDigest(validGraderAdmission),
    campaign_id: "campaign-phase3b-synthetic",
    paired_evaluation: {
      ref: "artifact://campaign/evaluation.json",
      sha256: digest("8"),
    },
    paired_report: { ref: "artifact://campaign/report.json", sha256: digest("9") },
  },
  verdict: "accept",
  axes: {
    requirement_delta: {
      status: "pass",
      claims: [
        {
          claim_id: "reservation-command-contract",
          status: "pass",
          behaviors: commandBehaviors.map(behaviorResult),
        },
      ],
    },
    domain_preservation: {
      status: "pass",
      claims: [
        {
          claim_id: "reservation-state-integrity",
          status: "pass",
          behaviors: preservationBehaviors.map(behaviorResult),
        },
      ],
    },
    semantic_residual: { status: "not_required", claims: [] },
    measurement_validity: { status: "valid", reason_codes: [] },
    harness_impact: {
      status: "valid",
      changed_behaviors: [],
      cost_delta: {
        elapsed_ms: 5000,
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 25,
        failed_tool_calls: 0,
      },
    },
  },
  traceability: validClaimIr.traceability,
} as const;
