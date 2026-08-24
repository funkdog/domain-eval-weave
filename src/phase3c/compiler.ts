import {
  type CommerceClaimIr,
  parseCommerceClaimIr,
} from "../commerce-withdrawal/delivery-contracts.js";
import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import { COMMERCE_BEHAVIORS, type CommerceBehavior } from "../oracle/commerce-order-v2.js";
import {
  type ExpectedValue,
  type ObservationAuthorityMap,
  type ObservationBoundarySpec,
  type ObservationExpression,
  type Phase3cArtifactPointer,
  parseObservationAuthorityMap,
  parseObservationBoundarySpec,
} from "./contracts.js";
import { deriveExpressionDimensions, validateObservationBoundary } from "./observation.js";
import {
  PHASE3C_DIMENSIONS,
  PHASE3C_PUBLIC_OBSERVATION_CATALOG,
  type Phase3cDimension,
  type Phase3cScalarDomain,
  type Phase3cStimulus,
} from "./vocabulary.js";

interface ScenarioTemplate {
  readonly scenarioId: string;
  readonly claimIds: readonly string[];
  readonly behaviorIds: readonly CommerceBehavior[];
  readonly stimulusId: Phase3cStimulus;
  readonly expression: ObservationExpression;
}

const scalar = (
  domain_id: Phase3cScalarDomain,
  value: string | number | boolean,
): ExpectedValue => ({
  type: "scalar_literal" as const,
  domain_id,
  value,
});
const operation = (
  operation_id:
    | "create_order"
    | "cancel_order"
    | "resolve_withdrawal"
    | "mark_refunded"
    | "get_order"
    | "get_audit"
    | "get_retention",
  expected_status: "accepted" | "rejected" | "unavailable" = "accepted",
): ObservationExpression => ({ type: "operation_status_is", operation_id, expected_status });
const state = (
  slot: "before" | "after" | "first" | "replay" | "restart",
  field_id:
    | "order_status"
    | "fulfillment_state"
    | "withdrawal_state"
    | "refund_status"
    | "refund_amount"
    | "currency"
    | "inventory_reserved"
    | "coupon_state"
    | "version",
  domain: Phase3cScalarDomain,
  value: string | number | boolean,
): ObservationExpression => ({
  type: "state_field_compare",
  slot,
  field_id,
  comparator: "equals",
  expected_values: [scalar(domain, value)],
});
const count = (
  slot: "before" | "after" | "first" | "replay" | "restart",
  effect_id:
    | "order_cancelled"
    | "refund_requested"
    | "inventory_compensated"
    | "coupon_restored"
    | "command_rejected"
    | "withdrawal_requested"
    | "withdrawal_completed"
    | "idempotency_conflict",
  value: number,
): ObservationExpression => ({
  type: "effect_count_is",
  slot,
  effect_id,
  cardinality: { mode: "exactly", value },
});
const all = (...children: readonly ObservationExpression[]): ObservationExpression => ({
  type: "all_of",
  children,
});

export const PHASE3C_SCENARIOS: readonly ScenarioTemplate[] = [
  {
    scenarioId: "paid-unstarted",
    claimIds: ["CLM-COMMERCE-R01"],
    behaviorIds: [
      "unpaid_cancel_has_no_refund",
      "paid_unstarted_creates_paid_amount_refund",
      "cancellation_and_refund_states_are_separate",
    ],
    stimulusId: "paid_order",
    expression: all(
      operation("create_order"),
      operation("cancel_order"),
      operation("get_order"),
      state("after", "order_status", "order_status_enum", "cancelled"),
      state("after", "fulfillment_state", "fulfillment_state_enum", "not_started"),
      state("after", "withdrawal_state", "withdrawal_state_enum", "none"),
      state("after", "refund_status", "refund_status_enum", "pending"),
      {
        type: "state_field_compare",
        slot: "after",
        field_id: "version",
        comparator: "not_equals",
        expected_values: [{ type: "state_value", slot: "before", field_id: "version" }],
      },
      count("after", "order_cancelled", 1),
    ),
  },
  {
    scenarioId: "paid-unstarted",
    claimIds: ["CLM-COMMERCE-R02"],
    behaviorIds: ["cancellation_and_refund_states_are_separate"],
    stimulusId: "paid_order",
    expression: all(
      operation("mark_refunded"),
      state("after", "order_status", "order_status_enum", "cancelled"),
      state("after", "refund_status", "refund_status_enum", "pending"),
      state("replay", "order_status", "order_status_enum", "cancelled"),
      state("replay", "refund_status", "refund_status_enum", "refunded"),
    ),
  },
  {
    scenarioId: "paid-unstarted",
    claimIds: ["CLM-COMMERCE-R03"],
    behaviorIds: [
      "paid_unstarted_creates_paid_amount_refund",
      "refund_preserves_paid_amount_currency_and_units",
    ],
    stimulusId: "paid_order",
    expression: all(
      state("after", "refund_amount", "nonnegative_minor_units", 8_000),
      state("after", "currency", "currency_enum", "USD"),
      count("after", "refund_requested", 1),
      {
        type: "effect_attributes_compare",
        slot: "after",
        effect_id: "refund_requested",
        field_id: "amount",
        comparator: "equals",
        expected_values: [scalar("nonnegative_minor_units", 8_000)],
      },
    ),
  },
  {
    scenarioId: "paid-unstarted",
    claimIds: ["CLM-COMMERCE-R04"],
    behaviorIds: ["refund_preserves_paid_amount_currency_and_units"],
    stimulusId: "paid_order",
    expression: all(state("after", "currency", "currency_enum", "USD"), {
      type: "effect_attributes_compare",
      slot: "after",
      effect_id: "refund_requested",
      field_id: "currency",
      comparator: "equals",
      expected_values: [scalar("currency_enum", "USD")],
    }),
  },
  {
    scenarioId: "paid-unstarted",
    claimIds: ["CLM-COMMERCE-D03"],
    behaviorIds: ["inventory_compensation_is_exactly_once"],
    stimulusId: "paid_order",
    expression: all(
      state("after", "inventory_reserved", "boolean", false),
      count("after", "inventory_compensated", 1),
    ),
  },
  {
    scenarioId: "active-completion",
    claimIds: ["CLM-COMMERCE-R07"],
    behaviorIds: [
      "active_fulfillment_enters_pending_withdrawal",
      "withdrawal_completion_precedes_cancellation",
    ],
    stimulusId: "active_fulfillment_order",
    expression: all(
      operation("resolve_withdrawal"),
      state("after", "order_status", "order_status_enum", "cancelled"),
      state("after", "withdrawal_state", "withdrawal_state_enum", "completed"),
      state("after", "refund_status", "refund_status_enum", "pending"),
      count("after", "withdrawal_requested", 1),
      count("after", "withdrawal_completed", 1),
    ),
  },
  {
    scenarioId: "active-completion",
    claimIds: ["CLM-COMMERCE-D02"],
    behaviorIds: ["withdrawal_completion_precedes_cancellation"],
    stimulusId: "active_fulfillment_order",
    expression: all(state("after", "fulfillment_state", "fulfillment_state_enum", "active"), {
      type: "relation_holds",
      relation_id: "withdrawal_before_cancellation",
    }),
  },
  {
    scenarioId: "active-rejection",
    claimIds: ["CLM-COMMERCE-D02"],
    behaviorIds: ["withdrawal_rejection_preserves_order_and_effects"],
    stimulusId: "active_fulfillment_order",
    expression: all(
      operation("resolve_withdrawal"),
      state("after", "order_status", "order_status_enum", "paid"),
      state("after", "withdrawal_state", "withdrawal_state_enum", "rejected"),
      count("after", "order_cancelled", 0),
      count("after", "refund_requested", 0),
      count("after", "inventory_compensated", 0),
      count("after", "coupon_restored", 0),
    ),
  },
  {
    scenarioId: "active-failure",
    claimIds: ["CLM-COMMERCE-D02"],
    behaviorIds: ["withdrawal_failure_is_recoverable_without_effects"],
    stimulusId: "active_fulfillment_order",
    expression: all(
      operation("resolve_withdrawal"),
      state("after", "order_status", "order_status_enum", "paid"),
      state("after", "withdrawal_state", "withdrawal_state_enum", "failed"),
      count("after", "order_cancelled", 0),
      count("after", "refund_requested", 0),
      count("after", "inventory_compensated", 0),
      count("after", "coupon_restored", 0),
    ),
  },
  {
    scenarioId: "handoff-rejection",
    claimIds: ["CLM-COMMERCE-D01"],
    behaviorIds: ["handed_off_order_requires_after_sales"],
    stimulusId: "handed_off_order",
    expression: all(
      operation("cancel_order", "rejected"),
      state("after", "fulfillment_state", "fulfillment_state_enum", "handed_off"),
      count("after", "command_rejected", 1),
    ),
  },
  {
    scenarioId: "ownership-rejection",
    claimIds: ["CLM-COMMERCE-R05"],
    behaviorIds: ["customer_ownership_is_enforced"],
    stimulusId: "paid_order",
    expression: all(operation("cancel_order", "rejected"), count("after", "command_rejected", 1)),
  },
  {
    scenarioId: "coupon-eligibility",
    claimIds: ["CLM-COMMERCE-D04"],
    behaviorIds: ["coupon_restore_requires_current_eligibility"],
    stimulusId: "unpaid_order",
    expression: all(
      state("after", "coupon_state", "coupon_state_enum", "restored"),
      state("replay", "coupon_state", "coupon_state_enum", "expired"),
      count("after", "coupon_restored", 1),
      count("replay", "coupon_restored", 0),
    ),
  },
  {
    scenarioId: "request-replay",
    claimIds: ["CLM-COMMERCE-R06"],
    behaviorIds: ["request_replay_and_conflict_are_idempotent"],
    stimulusId: "replay_request",
    expression: all(
      count("replay", "idempotency_conflict", 1),
      count("replay", "inventory_compensated", 1),
      count("replay", "refund_requested", 0),
      { type: "relation_holds", relation_id: "request_replay_same_as_first" },
      {
        type: "multiset_compare",
        left: "first",
        right: "replay",
        effect_id: "order_cancelled",
        comparator: "multiset_equals",
      },
    ),
  },
  {
    scenarioId: "expired-replay",
    claimIds: ["CLM-COMMERCE-D07"],
    behaviorIds: ["expired_replay_reconciles_or_fails_closed"],
    stimulusId: "replay_request",
    expression: all(
      { type: "relation_holds", relation_id: "request_replay_same_as_first" },
      {
        type: "multiset_compare",
        left: "first",
        right: "replay",
        effect_id: "all",
        comparator: "multiset_equals",
      },
      {
        type: "retention_window_compare",
        clock_stimulus_id: "retention_clock",
        comparator: "within",
        window_ms: 90 * 24 * 60 * 60 * 1_000,
      },
    ),
  },
  {
    scenarioId: "restart-recovery",
    claimIds: ["CLM-COMMERCE-R08"],
    behaviorIds: ["restart_recovery_preserves_handoffs_and_audit"],
    stimulusId: "restart_checkpoint",
    expression: all(
      operation("cancel_order"),
      operation("get_order"),
      operation("get_audit"),
      { type: "relation_holds", relation_id: "restart_preserves_public_state" },
      {
        type: "multiset_compare",
        left: "before",
        right: "restart",
        effect_id: "all",
        comparator: "multiset_equals",
      },
    ),
  },
  {
    scenarioId: "restart-recovery",
    claimIds: ["CLM-COMMERCE-D08"],
    behaviorIds: ["restart_recovery_preserves_handoffs_and_audit"],
    stimulusId: "restart_checkpoint",
    expression: all(
      operation("cancel_order"),
      { type: "relation_holds", relation_id: "restart_preserves_public_state" },
      {
        type: "state_field_compare",
        slot: "restart",
        field_id: "version",
        comparator: "unchanged",
        expected_values: [],
      },
    ),
  },
  {
    scenarioId: "retention-policy",
    claimIds: ["CLM-COMMERCE-D09"],
    behaviorIds: ["audit_and_retention_policy_are_complete"],
    stimulusId: "retention_clock",
    expression: all(
      operation("cancel_order"),
      operation("get_audit"),
      operation("get_retention"),
      count("after", "order_cancelled", 1),
      {
        type: "retention_window_compare",
        clock_stimulus_id: "retention_clock",
        comparator: "within",
        window_ms: 90 * 24 * 60 * 60 * 1_000,
      },
    ),
  },
] as const;

function claimAxes(claimIr: CommerceClaimIr) {
  return Object.fromEntries(claimIr.claims.map((claim) => [claim.claim_id, claim.axis]));
}

function scenarioDimensions(scenario: ScenarioTemplate): readonly Phase3cDimension[] {
  return deriveExpressionDimensions(scenario.expression);
}

export function compilePhase3cObservationBoundary(input: {
  readonly claimIr: unknown;
  readonly source: ObservationBoundarySpec["source"];
  readonly publicSurfaceSha256: string;
  readonly runnerSha256: string;
  readonly authorityRef: Phase3cArtifactPointer;
}): { readonly authorityMap: ObservationAuthorityMap; readonly boundary: ObservationBoundarySpec } {
  const claimIr = parseCommerceClaimIr(input.claimIr);
  const claims = new Map(claimIr.claims.map((claim) => [claim.claim_id, claim]));
  const expectedClaims = [
    ...new Set(PHASE3C_SCENARIOS.flatMap((scenario) => scenario.claimIds)),
  ].sort();
  if (
    claims.size !== expectedClaims.length ||
    [...claims.keys()].sort().join("\0") !== expectedClaims.join("\0") ||
    claimIr.semantic_residual.length !== 0
  ) {
    throw new Error("Phase 3C requires the exact deterministic Commerce v2 Claim closure");
  }
  for (const scenario of PHASE3C_SCENARIOS) {
    for (const claimId of scenario.claimIds) {
      const claim = claims.get(claimId);
      if (
        claim === undefined ||
        !claim.observation_bindings.some((binding) =>
          scenario.behaviorIds.includes(binding.behavior_id),
        )
      ) {
        throw new Error(
          `Phase 3C scenario lacks Claim authority: ${scenario.scenarioId}/${claimId}`,
        );
      }
    }
  }
  const dimensionClaims = new Map<Phase3cDimension, Set<string>>(
    PHASE3C_DIMENSIONS.map((dimension) => [dimension, new Set<string>()]),
  );
  for (const scenario of PHASE3C_SCENARIOS) {
    for (const dimension of scenarioDimensions(scenario)) {
      const claimIds = dimensionClaims.get(dimension);
      if (claimIds === undefined) throw new Error(`Unknown Phase 3C dimension: ${dimension}`);
      for (const claimId of scenario.claimIds) claimIds.add(claimId);
    }
  }
  const authorityMap = parseObservationAuthorityMap({
    schema_version: 1,
    catalog_sha256: canonicalJsonDigest(PHASE3C_PUBLIC_OBSERVATION_CATALOG),
    claim_ir_sha256: canonicalJsonDigest(claimIr),
    dimensions: PHASE3C_DIMENSIONS.map((dimensionId) => ({
      dimension_id: dimensionId,
      disposition: "deterministic",
      claim_ids: [...(dimensionClaims.get(dimensionId) ?? [])].sort(),
      authority_refs: [input.authorityRef],
    })),
  });
  const boundary = parseObservationBoundarySpec({
    schema_version: 3,
    boundary_id: "commerce-order-observation-boundary-v3",
    template_id: "commerce-order-cancellation-v3",
    source: input.source,
    public_surface_sha256: input.publicSurfaceSha256,
    public_observation_catalog_sha256: authorityMap.catalog_sha256,
    authority_map_sha256: canonicalJsonDigest(authorityMap),
    bindings: PHASE3C_SCENARIOS.flatMap((scenario) => {
      const dimensions = scenarioDimensions(scenario);
      return scenario.claimIds.map((claimId) => ({
        observation_id: `${scenario.scenarioId}-${claimId.toLowerCase()}`,
        claim_id: claimId,
        axis: claims.get(claimId)?.axis,
        dimension_ids: dimensions,
        stimulus_id: scenario.stimulusId,
        expression: scenario.expression,
      }));
    }),
    normal_form_version: "domain-observation-normal-form-v1",
    runner_sha256: input.runnerSha256,
  });
  validateObservationBoundary({ boundary, authorityMap, claimAxes: claimAxes(claimIr) });
  if (
    new Set(
      claimIr.claims.flatMap((claim) =>
        claim.observation_bindings.map((entry) => entry.behavior_id),
      ),
    ).size !== COMMERCE_BEHAVIORS.length
  ) {
    throw new Error("Phase 3C Claim IR no longer covers the complete Commerce behavior catalog");
  }
  return { authorityMap, boundary };
}
