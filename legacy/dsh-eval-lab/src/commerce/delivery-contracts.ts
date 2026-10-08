import { z } from "zod";

import { canonicalJson } from "../contracts/canonical-json.js";
import { packageRelativeRefSchema } from "../contracts/phase2.js";
import {
  COMMERCE_CALIBRATION_CANDIDATES,
  type CommerceCalibrationCandidate,
} from "../oracle/commerce-calibration.js";
import { COMMERCE_BEHAVIORS } from "../oracle/commerce-order.js";
import { commerceObservationCatalogSchema } from "./catalog.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_REF_PATTERN =
  /^artifact:\/\/campaign\/(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))(?!.*\/\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

const idSchema = z.string().regex(ID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const artifactRefSchema = z.string().regex(ARTIFACT_REF_PATTERN);
const behaviorSchema = z.enum(COMMERCE_BEHAVIORS);
const behaviorStatusSchema = z.enum(["pass", "fail", "error"]);
const axisSchema = z.enum(["requirement_delta", "domain_preservation"]);
const riskSchema = z.enum(["low", "medium", "high", "critical"]);
const candidateSchema = z.enum(COMMERCE_CALIBRATION_CANDIDATES);

const uniqueStrings = <T extends z.ZodType<string>>(item: T, minimum = 0) =>
  z
    .array(item)
    .min(minimum)
    .refine((values) => new Set(values).size === values.length, "values must be unique");

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const commerceBehaviorVectorSchema = z.strictObject(
  Object.fromEntries(COMMERCE_BEHAVIORS.map((behavior) => [behavior, behaviorStatusSchema])) as {
    [K in (typeof COMMERCE_BEHAVIORS)[number]]: typeof behaviorStatusSchema;
  },
);

const portablePointerSchema = z.strictObject({
  ref: packageRelativeRefSchema,
  sha256: sha256Schema,
});

const campaignPointerSchema = z.strictObject({ ref: artifactRefSchema, sha256: sha256Schema });

const observationBindingSchema = z.strictObject({
  behavior_id: behaviorSchema,
  entry_sha256: sha256Schema,
});

const claimSchema = z.strictObject({
  claim_id: idSchema,
  contract_version: z.number().finite().int().positive(),
  domain_id: idSchema,
  effect: z.enum(["uses", "preserves"]),
  axis: axisSchema,
  statement_sha256: sha256Schema,
  false_accept_risk: riskSchema,
  false_reject_risk: riskSchema,
  dependencies: uniqueStrings(idSchema),
  observation_bindings: z
    .array(observationBindingSchema)
    .min(1)
    .refine(
      (bindings) =>
        new Set(bindings.map((binding) => binding.behavior_id)).size === bindings.length,
      "observation bindings must be unique",
    ),
});

const residualClaimSchema = z.strictObject({
  claim_id: idSchema,
  axis: axisSchema,
  reason_code: z.enum([
    "OBSERVATION_BINDING_MISSING",
    "OBSERVATION_TEMPLATE_UNSUPPORTED",
    "PROPOSED_CLAIM_RISK_UNSPECIFIED",
  ]),
});

const claimToBehaviorsSchema = z.record(idSchema, uniqueStrings(behaviorSchema, 1));
const behaviorToClaimsSchema = z.strictObject(
  Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [behavior, uniqueStrings(idSchema, 1)]),
  ) as {
    [K in (typeof COMMERCE_BEHAVIORS)[number]]: ReturnType<typeof uniqueStrings<typeof idSchema>>;
  },
);

const traceabilitySchema = z.strictObject({
  claim_to_behaviors: claimToBehaviorsSchema,
  behavior_to_claims: behaviorToClaimsSchema,
});

export const commerceClaimIrSchema = z
  .strictObject({
    schema_version: z.literal(2),
    template_id: z.literal("commerce-order-cancellation-v1"),
    compiler: z.strictObject({
      compiler_id: z.literal("phase3b1-commerce-compiler"),
      compiler_version: z.literal(1),
    }),
    source: z.strictObject({
      domain_manifest: portablePointerSchema,
      contract: portablePointerSchema,
      requirement: portablePointerSchema,
      task_pack_sha256: sha256Schema,
      observation_catalog_sha256: sha256Schema,
    }),
    requirement: z.strictObject({
      requirement_id: idSchema,
      requirement_version: z.number().finite().int().positive(),
      product_id: idSchema,
    }),
    claims: z.array(claimSchema).min(1),
    semantic_residual: z.array(residualClaimSchema),
    traceability: traceabilitySchema,
  })
  .superRefine((ir, context) => {
    const claims = new Map(ir.claims.map((claim) => [claim.claim_id, claim]));
    if (claims.size !== ir.claims.length) {
      context.addIssue({ code: "custom", path: ["claims"], message: "claim ids must be unique" });
    }
    const residualIds = new Set(ir.semantic_residual.map((claim) => claim.claim_id));
    if (
      residualIds.size !== ir.semantic_residual.length ||
      [...residualIds].some((claimId) => claims.has(claimId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["semantic_residual"],
        message: "residual claims must be unique and disjoint",
      });
    }
    if (!same(Object.keys(ir.traceability.claim_to_behaviors).sort(), [...claims.keys()].sort())) {
      context.addIssue({
        code: "custom",
        path: ["traceability", "claim_to_behaviors"],
        message: "forward traceability must name every Claim",
      });
    }
    for (const claim of ir.claims) {
      const expected = claim.observation_bindings.map((binding) => binding.behavior_id);
      if (!same(ir.traceability.claim_to_behaviors[claim.claim_id] ?? [], expected)) {
        context.addIssue({
          code: "custom",
          path: ["traceability", "claim_to_behaviors", claim.claim_id],
          message: "forward traceability drifted",
        });
      }
      if (
        (claim.effect === "uses") !== (claim.axis === "requirement_delta") ||
        (claim.effect === "preserves") !== (claim.axis === "domain_preservation")
      ) {
        context.addIssue({
          code: "custom",
          path: ["claims", claim.claim_id, "axis"],
          message: "effect and axis disagree",
        });
      }
      if (claim.dependencies.some((dependency) => !claims.has(dependency))) {
        context.addIssue({
          code: "custom",
          path: ["claims", claim.claim_id, "dependencies"],
          message: "dependency is absent from Claim closure",
        });
      }
    }
    for (const behavior of COMMERCE_BEHAVIORS) {
      const expected = ir.claims
        .filter((claim) =>
          claim.observation_bindings.some((binding) => binding.behavior_id === behavior),
        )
        .map((claim) => claim.claim_id);
      if (!same(ir.traceability.behavior_to_claims[behavior], expected)) {
        context.addIssue({
          code: "custom",
          path: ["traceability", "behavior_to_claims", behavior],
          message: "reverse traceability drifted",
        });
      }
    }
  });

const oracleCheckSchema = z.strictObject({
  behavior_id: behaviorSchema,
  template_id: z.literal("commerce-order-cancellation-v1"),
  claim_ids: uniqueStrings(idSchema, 1),
  axes: uniqueStrings(axisSchema, 1),
  risk_weight: z.number().finite().int().min(1).max(5),
  hard_gate: z.literal(true),
});

export const commerceOraclePlanSchema = z
  .strictObject({
    schema_version: z.literal(2),
    template_id: z.literal("commerce-order-cancellation-v1"),
    plan_id: idSchema,
    claim_ir_sha256: sha256Schema,
    task_pack_sha256: sha256Schema,
    observation_catalog_sha256: sha256Schema,
    oracle_version: z.literal("commerce-order-oracle-v1"),
    checks: z.array(oracleCheckSchema),
  })
  .superRefine((plan, context) => {
    if (
      plan.checks.length !== COMMERCE_BEHAVIORS.length ||
      plan.checks.some((check, index) => check.behavior_id !== COMMERCE_BEHAVIORS[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "Oracle Plan must contain the exact commerce behavior order",
      });
    }
  });

const admissionVectorsSchema = z.strictObject(
  Object.fromEntries(
    COMMERCE_CALIBRATION_CANDIDATES.map((candidate) => [candidate, commerceBehaviorVectorSchema]),
  ) as {
    [K in CommerceCalibrationCandidate]: typeof commerceBehaviorVectorSchema;
  },
);

const candidateFailures = {
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

const counterexampleIds = Object.keys(candidateFailures) as Array<keyof typeof candidateFailures>;

function statuses(
  vector: z.infer<typeof commerceBehaviorVectorSchema>,
  status: "pass" | "fail" | "error",
) {
  return COMMERCE_BEHAVIORS.filter((behavior) => vector[behavior] === status);
}

const admissionChecksSchema = z.strictObject({
  red_detected: z.boolean(),
  gold_passed: z.boolean(),
  counterexamples_matched: z.boolean(),
  repeatable: z.boolean(),
  seed_stable: z.boolean(),
  coverage_complete: z.boolean(),
});

const admissionCoverageSchema = z.strictObject(
  Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [behavior, uniqueStrings(candidateSchema)]),
  ) as {
    [K in (typeof COMMERCE_BEHAVIORS)[number]]: ReturnType<
      typeof uniqueStrings<typeof candidateSchema>
    >;
  },
);

export const commerceGraderAdmissionSchema = z
  .strictObject({
    schema_version: z.literal(2),
    template_id: z.literal("commerce-order-cancellation-v1"),
    admission_id: idSchema,
    oracle_plan_sha256: sha256Schema,
    task_pack_sha256: sha256Schema,
    observation_catalog_sha256: sha256Schema,
    eval_package_sha256: sha256Schema,
    calibration: z.strictObject({
      seed: z.number().finite().int().nonnegative(),
      vectors: admissionVectorsSchema,
    }),
    behavior_coverage: admissionCoverageSchema,
    checks: admissionChecksSchema,
    status: z.enum(["admitted", "rejected"]),
    diagnostics: z.array(
      z.strictObject({
        code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        message: z.string().min(1),
      }),
    ),
  })
  .superRefine((admission, context) => {
    const vectors = admission.calibration.vectors;
    const redDetected =
      statuses(vectors.red, "fail").length > 0 && statuses(vectors.red, "error").length === 0;
    const goldPassed = COMMERCE_BEHAVIORS.every((behavior) => vectors.gold[behavior] === "pass");
    const counterexamplesMatched = counterexampleIds.every(
      (candidate) =>
        statuses(vectors[candidate], "error").length === 0 &&
        same(statuses(vectors[candidate], "fail"), candidateFailures[candidate]),
    );
    const repeatable = same(
      COMMERCE_BEHAVIORS.map((behavior) => vectors.gold[behavior]),
      COMMERCE_BEHAVIORS.map((behavior) => vectors["gold-repeat"][behavior]),
    );
    const seedStable = same(
      COMMERCE_BEHAVIORS.map((behavior) => vectors.gold[behavior]),
      COMMERCE_BEHAVIORS.map((behavior) => vectors["gold-next-seed"][behavior]),
    );
    const coverage = Object.fromEntries(
      COMMERCE_BEHAVIORS.map((behavior) => [
        behavior,
        counterexampleIds.filter((candidate) => vectors[candidate][behavior] === "fail"),
      ]),
    );
    const coverageComplete = Object.values(coverage).every((values) => values.length > 0);
    if (JSON.stringify(admission.behavior_coverage) !== JSON.stringify(coverage)) {
      context.addIssue({
        code: "custom",
        path: ["behavior_coverage"],
        message: "coverage must be derived from calibration vectors",
      });
    }
    const derivedChecks = {
      red_detected: redDetected,
      gold_passed: goldPassed,
      counterexamples_matched: counterexamplesMatched,
      repeatable,
      seed_stable: seedStable,
      coverage_complete: coverageComplete,
    };
    if (JSON.stringify(admission.checks) !== JSON.stringify(derivedChecks)) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "checks must be derived from calibration vectors",
      });
    }
    const admitted =
      Object.values(derivedChecks).every(Boolean) && admission.diagnostics.length === 0;
    if ((admission.status === "admitted") !== admitted) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "status must be derived from all admission gates",
      });
    }
  });

const behaviorResultSchema = z.strictObject({
  behavior_id: behaviorSchema,
  status: behaviorStatusSchema,
  evidence_ref: artifactRefSchema,
});

const claimResultSchema = z
  .strictObject({
    claim_id: idSchema,
    status: behaviorStatusSchema,
    behaviors: z.array(behaviorResultSchema).min(1),
  })
  .superRefine((claim, context) => {
    const statuses = claim.behaviors.map((behavior) => behavior.status);
    const expected = statuses.includes("error")
      ? "error"
      : statuses.includes("fail")
        ? "fail"
        : "pass";
    if (claim.status !== expected) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Claim status must derive from commerce behaviors",
      });
    }
  });

const deterministicAxisSchema = z
  .strictObject({
    status: behaviorStatusSchema,
    claims: z.array(claimResultSchema).min(1),
  })
  .superRefine((axis, context) => {
    const statuses = axis.claims.map((claim) => claim.status);
    const expected = statuses.includes("error")
      ? "error"
      : statuses.includes("fail")
        ? "fail"
        : "pass";
    if (axis.status !== expected) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "axis status must derive from commerce Claims",
      });
    }
  });

const nullableIntegerSchema = z.number().finite().int().nullable();

export const commerceDeliveryReportSchema = z
  .strictObject({
    schema_version: z.literal(2),
    template_id: z.literal("commerce-order-cancellation-v1"),
    evaluation_id: idSchema,
    source: z.strictObject({
      domain_manifest_sha256: sha256Schema,
      requirement_sha256: sha256Schema,
      claim_ir_sha256: sha256Schema,
      oracle_plan_sha256: sha256Schema,
      grader_admission_sha256: sha256Schema,
      campaign_id: idSchema,
      paired_evaluation: campaignPointerSchema,
      paired_report: campaignPointerSchema,
    }),
    verdict: z.enum(["accept", "reject", "inconclusive"]),
    axes: z.strictObject({
      requirement_delta: deterministicAxisSchema,
      domain_preservation: deterministicAxisSchema,
      semantic_residual: z
        .strictObject({
          status: z.enum(["not_required", "not_evaluated"]),
          claims: z.array(residualClaimSchema),
        })
        .superRefine((axis, context) => {
          if ((axis.status === "not_required") !== (axis.claims.length === 0)) {
            context.addIssue({
              code: "custom",
              path: ["status"],
              message: "semantic residual status must match Claim presence",
            });
          }
        }),
      measurement_validity: z.strictObject({
        status: z.enum(["valid", "invalid", "insufficient"]),
        reason_codes: uniqueStrings(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
      }),
      harness_impact: z.strictObject({
        status: z.enum(["valid", "invalid", "insufficient"]),
        changed_behaviors: uniqueStrings(behaviorSchema),
        cost_delta: z.strictObject({
          elapsed_ms: nullableIntegerSchema,
          input_tokens: nullableIntegerSchema,
          cached_input_tokens: nullableIntegerSchema,
          output_tokens: nullableIntegerSchema,
          failed_tool_calls: nullableIntegerSchema,
        }),
      }),
    }),
    traceability: traceabilitySchema,
  })
  .superRefine((report, context) => {
    const axes = report.axes;
    const expected =
      axes.measurement_validity.status !== "valid" ||
      axes.harness_impact.status !== "valid" ||
      axes.semantic_residual.status !== "not_required" ||
      axes.requirement_delta.status === "error" ||
      axes.domain_preservation.status === "error"
        ? "inconclusive"
        : axes.requirement_delta.status === "fail" || axes.domain_preservation.status === "fail"
          ? "reject"
          : "accept";
    if (report.verdict !== expected) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "Commerce verdict must follow five-axis precedence",
      });
    }
    const claims = [...axes.requirement_delta.claims, ...axes.domain_preservation.claims];
    const forward = Object.fromEntries(
      claims.map((claim) => [
        claim.claim_id,
        claim.behaviors.map((behavior) => behavior.behavior_id),
      ]),
    );
    const reverse = Object.fromEntries(
      COMMERCE_BEHAVIORS.map((behavior) => [
        behavior,
        claims
          .filter((claim) => claim.behaviors.some((result) => result.behavior_id === behavior))
          .map((claim) => claim.claim_id),
      ]),
    );
    if (canonicalJson(forward) !== canonicalJson(report.traceability.claim_to_behaviors)) {
      context.addIssue({
        code: "custom",
        path: ["traceability", "claim_to_behaviors"],
        message: "Commerce report forward traceability drifted",
      });
    }
    if (canonicalJson(reverse) !== canonicalJson(report.traceability.behavior_to_claims)) {
      context.addIssue({
        code: "custom",
        path: ["traceability", "behavior_to_claims"],
        message: "Commerce report reverse traceability drifted",
      });
    }
  });

export type CommerceObservationCatalog = z.infer<typeof commerceObservationCatalogSchema>;
export type CommerceClaimIr = z.infer<typeof commerceClaimIrSchema>;
export type CommerceOraclePlan = z.infer<typeof commerceOraclePlanSchema>;
export type CommerceGraderAdmission = z.infer<typeof commerceGraderAdmissionSchema>;
export type CommerceBehaviorVector = z.infer<typeof commerceBehaviorVectorSchema>;
export type CommerceDeliveryReport = z.infer<typeof commerceDeliveryReportSchema>;

export function parseCommerceClaimIr(input: unknown): CommerceClaimIr {
  return commerceClaimIrSchema.parse(input);
}

export function parseCommerceOraclePlan(input: unknown): CommerceOraclePlan {
  return commerceOraclePlanSchema.parse(input);
}

export function parseCommerceGraderAdmission(input: unknown): CommerceGraderAdmission {
  return commerceGraderAdmissionSchema.parse(input);
}

export function parseCommerceDeliveryReport(input: unknown): CommerceDeliveryReport {
  return commerceDeliveryReportSchema.parse(input);
}

export { campaignPointerSchema, commerceObservationCatalogSchema };
