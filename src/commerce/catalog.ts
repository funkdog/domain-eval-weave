import { z } from "zod";

import { COMMERCE_BEHAVIORS } from "../oracle/commerce-order.js";

const commerceBehaviorSchema = z.enum(COMMERCE_BEHAVIORS);
const mutantIdSchema = z.enum([
  "red",
  "mutant-shipped-cancel",
  "mutant-overrefund",
  "mutant-double-effects",
  "mutant-coupon-always-restored",
  "mutant-no-ownership-or-persistence",
]);

const expectedFailures = {
  red: COMMERCE_BEHAVIORS,
  "mutant-shipped-cancel": ["shipped_order_requires_after_sales"],
  "mutant-overrefund": ["paid_unshipped_creates_paid_amount_refund"],
  "mutant-double-effects": [
    "inventory_release_is_exactly_once",
    "restart_recovery_preserves_idempotency_and_audit",
  ],
  "mutant-coupon-always-restored": ["coupon_restore_requires_current_eligibility"],
  "mutant-no-ownership-or-persistence": [
    "customer_ownership_is_enforced",
    "restart_recovery_preserves_idempotency_and_audit",
  ],
} as const;

const mutantIds = Object.keys(expectedFailures) as Array<keyof typeof expectedFailures>;

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const commerceObservationCatalogSchema = z
  .strictObject({
    schema_version: z.literal(2),
    catalog_id: z.literal("commerce-order-cancellation-v1"),
    catalog_version: z.literal(1),
    task_id: z.literal("open-coding-ts-commerce-order-v1"),
    oracle_version: z.literal("commerce-order-oracle-v1"),
    template_id: z.literal("commerce-order-cancellation-v1"),
    behaviors: z.array(
      z.strictObject({
        behavior_id: commerceBehaviorSchema,
        template_id: z.literal("commerce-order-cancellation-v1"),
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
