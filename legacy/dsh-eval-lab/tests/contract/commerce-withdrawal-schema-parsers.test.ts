import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseCommerceObservationCatalog } from "../../src/commerce-withdrawal/catalog.js";
import { COMMERCE_CALIBRATION_CANDIDATES } from "../../src/oracle/commerce-calibration-v2.js";
import { COMMERCE_BEHAVIORS } from "../../src/oracle/commerce-order-v2.js";

const expectedBehaviors = [
  "unpaid_cancel_has_no_refund",
  "paid_unstarted_creates_paid_amount_refund",
  "handed_off_order_requires_after_sales",
  "cancellation_and_refund_states_are_separate",
  "active_fulfillment_enters_pending_withdrawal",
  "withdrawal_completion_precedes_cancellation",
  "withdrawal_rejection_preserves_order_and_effects",
  "withdrawal_failure_is_recoverable_without_effects",
  "inventory_compensation_is_exactly_once",
  "coupon_restore_requires_current_eligibility",
  "customer_ownership_is_enforced",
  "request_replay_and_conflict_are_idempotent",
  "restart_recovery_preserves_handoffs_and_audit",
  "refund_preserves_paid_amount_currency_and_units",
  "expired_replay_reconciles_or_fails_closed",
  "audit_and_retention_policy_are_complete",
] as const;

const expectedCandidates = [
  "red",
  "gold",
  "mutant-handed-off-cancel",
  "mutant-overrefund-or-currency",
  "mutant-premature-cancel",
  "mutant-withdrawal-rejection-effects",
  "mutant-withdrawal-failure-effects",
  "mutant-double-effects",
  "mutant-coupon-always-restored",
  "mutant-no-ownership",
  "mutant-no-persistence",
  "mutant-expired-replay-fresh",
  "mutant-sparse-audit",
  "gold-repeat",
  "gold-next-seed",
] as const;

test("Commerce withdrawal successor freezes sixteen ordered behaviors", () => {
  assert.deepEqual(COMMERCE_BEHAVIORS, expectedBehaviors);
});

test("Commerce withdrawal successor freezes the complete calibration cohort", () => {
  assert.deepEqual(COMMERCE_CALIBRATION_CANDIDATES, expectedCandidates);
});

test("Commerce withdrawal catalog is template-bound and complete", async () => {
  const catalog = parseCommerceObservationCatalog(
    JSON.parse(
      await readFile(
        "task-packs/open-coding-ts-commerce-order-v2/claim-observation-catalog.json",
        "utf8",
      ),
    ),
  );
  assert.equal(catalog.template_id, "commerce-order-cancellation-v2");
  assert.deepEqual(
    catalog.behaviors.map((entry) => entry.behavior_id),
    expectedBehaviors,
  );
  assert.equal(catalog.counterexamples.length, 12);
  assert.throws(() =>
    parseCommerceObservationCatalog({
      ...catalog,
      template_id: "commerce-order-cancellation-v1",
    }),
  );
});
