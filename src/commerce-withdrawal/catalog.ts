import { z } from "zod";

import { COMMERCE_BEHAVIORS } from "../oracle/commerce-order-v2.js";

const commerceBehaviorSchema = z.enum(COMMERCE_BEHAVIORS);
const mutantIdSchema = z.enum([
  "red",
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
]);

const expectedFailures = {
  red: COMMERCE_BEHAVIORS,
  "mutant-handed-off-cancel": ["handed_off_order_requires_after_sales"],
  "mutant-overrefund-or-currency": [
    "paid_unstarted_creates_paid_amount_refund",
    "withdrawal_completion_precedes_cancellation",
    "restart_recovery_preserves_handoffs_and_audit",
    "refund_preserves_paid_amount_currency_and_units",
    "expired_replay_reconciles_or_fails_closed",
  ],
  "mutant-premature-cancel": [
    "active_fulfillment_enters_pending_withdrawal",
    "withdrawal_completion_precedes_cancellation",
    "withdrawal_rejection_preserves_order_and_effects",
    "withdrawal_failure_is_recoverable_without_effects",
    "inventory_compensation_is_exactly_once",
    "restart_recovery_preserves_handoffs_and_audit",
    "audit_and_retention_policy_are_complete",
  ],
  "mutant-withdrawal-rejection-effects": ["withdrawal_rejection_preserves_order_and_effects"],
  "mutant-withdrawal-failure-effects": ["withdrawal_failure_is_recoverable_without_effects"],
  "mutant-double-effects": [
    "inventory_compensation_is_exactly_once",
    "request_replay_and_conflict_are_idempotent",
    "expired_replay_reconciles_or_fails_closed",
  ],
  "mutant-coupon-always-restored": ["coupon_restore_requires_current_eligibility"],
  "mutant-no-ownership": ["customer_ownership_is_enforced"],
  "mutant-no-persistence": [
    "withdrawal_failure_is_recoverable_without_effects",
    "restart_recovery_preserves_handoffs_and_audit",
    "expired_replay_reconciles_or_fails_closed",
  ],
  "mutant-expired-replay-fresh": ["expired_replay_reconciles_or_fails_closed"],
  "mutant-sparse-audit": [
    "withdrawal_failure_is_recoverable_without_effects",
    "restart_recovery_preserves_handoffs_and_audit",
    "expired_replay_reconciles_or_fails_closed",
    "audit_and_retention_policy_are_complete",
  ],
} as const;

const mutantIds = Object.keys(expectedFailures) as Array<keyof typeof expectedFailures>;

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const commerceObservationCatalogSchema = z
  .strictObject({
    schema_version: z.literal(2),
    catalog_id: z.literal("commerce-order-cancellation-v2"),
    catalog_version: z.literal(1),
    task_id: z.literal("open-coding-ts-commerce-order-v2"),
    oracle_version: z.literal("commerce-order-oracle-v2"),
    template_id: z.literal("commerce-order-cancellation-v2"),
    behaviors: z.array(
      z.strictObject({
        behavior_id: commerceBehaviorSchema,
        template_id: z.literal("commerce-order-cancellation-v2"),
        statement: z.string().min(1),
        risk_weight: z.number().finite().int().min(1).max(5),
      }),
    ),
    counterexamples: z.array(
      z.strictObject({
        candidate_id: mutantIdSchema,
        expected_failures: z
          .array(commerceBehaviorSchema)
          .min(1)
          .refine((values) => new Set(values).size === values.length, "failures must be unique"),
      }),
    ),
  })
  .superRefine((catalog, context) => {
    if (
      catalog.behaviors.length !== COMMERCE_BEHAVIORS.length ||
      catalog.behaviors.some((entry, index) => entry.behavior_id !== COMMERCE_BEHAVIORS[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["behaviors"],
        message: "commerce behaviors must use the exact canonical order",
      });
    }
    if (catalog.counterexamples.length !== mutantIds.length) {
      context.addIssue({
        code: "custom",
        path: ["counterexamples"],
        message: "commerce counterexamples are incomplete",
      });
    }
    for (const [index, candidateId] of mutantIds.entries()) {
      const entry = catalog.counterexamples[index];
      if (
        entry?.candidate_id !== candidateId ||
        !same(entry.expected_failures, expectedFailures[candidateId])
      ) {
        context.addIssue({
          code: "custom",
          path: ["counterexamples", index],
          message: "commerce counterexample expectation drifted",
        });
      }
    }
  });

export type CommerceObservationCatalog = z.infer<typeof commerceObservationCatalogSchema>;

export function parseCommerceObservationCatalog(input: unknown): CommerceObservationCatalog {
  return commerceObservationCatalogSchema.parse(input);
}
