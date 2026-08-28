import { z } from "zod";
import { packageRelativeRefSchema } from "../contracts/phase2.js";
import { LEDGER_BEHAVIORS } from "../oracle/ledger.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_REF_PATTERN =
  /^artifact:\/\/campaign\/(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))(?!.*\/\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

const idSchema = z.string().regex(ID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const artifactRefSchema = z.string().regex(ARTIFACT_REF_PATTERN);
const behaviorSchema = z.enum(LEDGER_BEHAVIORS);
const riskSchema = z.enum(["low", "medium", "high", "critical"]);
const axisSchema = z.enum(["requirement_delta", "domain_preservation"]);
const deterministicStatusSchema = z.enum(["pass", "fail", "error"]);
const behaviorVectorSchema = z.strictObject(
  Object.fromEntries(LEDGER_BEHAVIORS.map((behavior) => [behavior, deterministicStatusSchema])) as {
    [K in (typeof LEDGER_BEHAVIORS)[number]]: typeof deterministicStatusSchema;
  },
);

const uniqueStrings = <T extends z.ZodType<string>>(item: T, minimum = 0) =>
  z
    .array(item)
    .min(minimum)
    .refine((values) => new Set(values).size === values.length, "values must be unique");

const portablePointerSchema = z.strictObject({
  ref: packageRelativeRefSchema,
  sha256: sha256Schema,
});

const campaignPointerSchema = z.strictObject({ ref: artifactRefSchema, sha256: sha256Schema });

const counterexampleIdSchema = z.enum([
  "red",
  "mutant-no-lock",
  "mutant-no-persistence",
  "mutant-corrupt-resets",
  "mutant-broken-release",
  "mutant-release-not-persisted",
]);

const frozenCounterexampleFailures = {
  red: LEDGER_BEHAVIORS,
  "mutant-no-lock": ["no_oversubscription_concurrent"],
  "mutant-no-persistence": ["restart_recovery"],
  "mutant-corrupt-resets": ["corrupt_state_fail_closed"],
  "mutant-broken-release": ["terminal_transition_idempotency", "restart_recovery"],
  "mutant-release-not-persisted": ["restart_recovery"],
} as const;

const frozenCounterexampleIds = Object.keys(frozenCounterexampleFailures) as Array<
  keyof typeof frozenCounterexampleFailures
>;

const catalogBehaviorSchema = z.strictObject({
  behavior_id: behaviorSchema,
  template_id: z.literal("reservation-ledger-v1"),
  statement: z.string().min(1),
  risk_weight: z.number().finite().int().min(1).max(5),
});

const catalogCounterexampleSchema = z.strictObject({
  candidate_id: counterexampleIdSchema,
  expected_failures: uniqueStrings(behaviorSchema, 1),
});

export const observationCatalogSchema = z
  .strictObject({
    schema_version: z.literal(1),
    catalog_id: z.literal("reservation-ledger-v1"),
    catalog_version: z.literal(1),
    task_id: z.literal("open-coding-ts-ledger-v1"),
    oracle_version: z.literal("ledger-oracle-v3"),
    template_id: z.literal("reservation-ledger-v1"),
    behaviors: z.array(catalogBehaviorSchema).length(LEDGER_BEHAVIORS.length),
    counterexamples: z.array(catalogCounterexampleSchema).length(frozenCounterexampleIds.length),
  })
  .superRefine((catalog, context) => {
    if (catalog.behaviors.some((entry, index) => entry.behavior_id !== LEDGER_BEHAVIORS[index])) {
      context.addIssue({
        code: "custom",
        path: ["behaviors"],
        message: "catalog behaviors must contain the frozen canonical behavior order",
      });
    }
    if (
      new Set(catalog.counterexamples.map((entry) => entry.candidate_id)).size !==
      catalog.counterexamples.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["counterexamples"],
        message: "counterexample ids must be unique",
      });
    }
    if (catalog.counterexamples[0]?.candidate_id !== "red") {
      context.addIssue({
        code: "custom",
        path: ["counterexamples"],
        message: "the frozen red candidate must be the first counterexample",
      });
    }
    for (const [index, candidateId] of frozenCounterexampleIds.entries()) {
      const entry = catalog.counterexamples[index];
      if (
        entry?.candidate_id !== candidateId ||
        !sameStrings(entry.expected_failures, frozenCounterexampleFailures[candidateId])
      ) {
        context.addIssue({
          code: "custom",
          path: ["counterexamples", index],
          message: "counterexample expectations must match the frozen bounded template",
        });
      }
    }
  });

const observationBindingSchema = z.strictObject({
  behavior_id: behaviorSchema,
  entry_sha256: sha256Schema,
});

const claimIrClaimSchema = z.strictObject({
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
      "observation behavior ids must be unique",
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
    LEDGER_BEHAVIORS.map((behavior) => [behavior, uniqueStrings(idSchema, 1)]),
  ) as {
    [K in (typeof LEDGER_BEHAVIORS)[number]]: ReturnType<typeof uniqueStrings<typeof idSchema>>;
  },
);

const traceabilitySchema = z.strictObject({
  claim_to_behaviors: claimToBehaviorsSchema,
  behavior_to_claims: behaviorToClaimsSchema,
});

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const claimIrSchema = z
  .strictObject({
    schema_version: z.literal(1),
    compiler: z.strictObject({
      compiler_id: z.literal("phase3b-deterministic-compiler"),
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
    claims: z.array(claimIrClaimSchema).min(1),
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
        message: "residual claim ids must be unique and disjoint from deterministic claims",
      });
    }
    const forwardKeys = Object.keys(ir.traceability.claim_to_behaviors).sort();
    const claimKeys = [...claims.keys()].sort();
    if (!sameStrings(forwardKeys, claimKeys)) {
      context.addIssue({
        code: "custom",
        path: ["traceability", "claim_to_behaviors"],
        message: "forward traceability must name every deterministic claim exactly once",
      });
    }
    for (const claim of ir.claims) {
      const expected = claim.observation_bindings.map((binding) => binding.behavior_id);
      const actual = ir.traceability.claim_to_behaviors[claim.claim_id];
      if (actual === undefined || !sameStrings(actual, expected)) {
        context.addIssue({
          code: "custom",
          path: ["traceability", "claim_to_behaviors", claim.claim_id],
          message: "forward traceability drifted from Claim observations",
        });
      }
      if (
        (claim.effect === "uses") !== (claim.axis === "requirement_delta") ||
        (claim.effect === "preserves") !== (claim.axis === "domain_preservation")
      ) {
        context.addIssue({
          code: "custom",
          path: ["claims", claim.claim_id, "axis"],
          message: "Claim effect and report axis disagree",
        });
      }
      if (claim.dependencies.some((dependency) => !claims.has(dependency))) {
        context.addIssue({
          code: "custom",
          path: ["claims", claim.claim_id, "dependencies"],
          message: "Claim dependency is absent from the compiled closure",
        });
      }
    }
    for (const behavior of LEDGER_BEHAVIORS) {
      const expected = ir.claims
        .filter((claim) =>
          claim.observation_bindings.some((binding) => binding.behavior_id === behavior),
        )
        .map((claim) => claim.claim_id);
      const actual = ir.traceability.behavior_to_claims[behavior];
      if (!sameStrings(actual, expected)) {
        context.addIssue({
          code: "custom",
          path: ["traceability", "behavior_to_claims", behavior],
          message: "reverse traceability drifted from Claim observations",
        });
      }
    }
  });

const oracleCheckSchema = z.strictObject({
  behavior_id: behaviorSchema,
  template_id: z.literal("reservation-ledger-v1"),
  claim_ids: uniqueStrings(idSchema, 1),
  axes: uniqueStrings(axisSchema, 1),
  risk_weight: z.number().finite().int().min(1).max(5),
  hard_gate: z.literal(true),
});

export const oraclePlanSchema = z
  .strictObject({
    schema_version: z.literal(1),
    plan_id: idSchema,
    claim_ir_sha256: sha256Schema,
    task_pack_sha256: sha256Schema,
    observation_catalog_sha256: sha256Schema,
    oracle_version: z.literal("ledger-oracle-v3"),
    checks: z.array(oracleCheckSchema).length(LEDGER_BEHAVIORS.length),
  })
  .superRefine((plan, context) => {
    if (plan.checks.some((check, index) => check.behavior_id !== LEDGER_BEHAVIORS[index])) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "Oracle checks must contain the complete canonical behavior vector",
      });
    }
  });

const admissionDiagnosticSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1),
});

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
    LEDGER_BEHAVIORS.map((behavior) => [behavior, uniqueStrings(counterexampleIdSchema)]),
  ) as {
    [K in (typeof LEDGER_BEHAVIORS)[number]]: ReturnType<
      typeof uniqueStrings<typeof counterexampleIdSchema>
    >;
  },
);

const admissionVectorsSchema = z.strictObject({
  red: behaviorVectorSchema,
  gold: behaviorVectorSchema,
  "mutant-no-lock": behaviorVectorSchema,
  "mutant-no-persistence": behaviorVectorSchema,
  "mutant-corrupt-resets": behaviorVectorSchema,
  "mutant-broken-release": behaviorVectorSchema,
  "mutant-release-not-persisted": behaviorVectorSchema,
  "gold-repeat": behaviorVectorSchema,
  "gold-next-seed": behaviorVectorSchema,
});

function vectorStatuses(
  vector: z.infer<typeof behaviorVectorSchema>,
  status: z.infer<typeof deterministicStatusSchema>,
) {
  return LEDGER_BEHAVIORS.filter((behavior) => vector[behavior] === status);
}

export const graderAdmissionSchema = z
  .strictObject({
    schema_version: z.literal(1),
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
    diagnostics: z.array(admissionDiagnosticSchema),
  })
  .superRefine((admission, context) => {
    const vectors = admission.calibration.vectors;
    const redFailures = vectorStatuses(vectors.red, "fail");
    const redDetected = redFailures.length > 0 && vectorStatuses(vectors.red, "error").length === 0;
    const goldPassed = LEDGER_BEHAVIORS.every((behavior) => vectors.gold[behavior] === "pass");
    const counterexamplesMatched = frozenCounterexampleIds.every(
      (candidate) =>
        vectorStatuses(vectors[candidate], "error").length === 0 &&
        sameStrings(
          vectorStatuses(vectors[candidate], "fail"),
          frozenCounterexampleFailures[candidate],
        ),
    );
    const repeatable = sameStrings(
      LEDGER_BEHAVIORS.map((behavior) => vectors.gold[behavior]),
      LEDGER_BEHAVIORS.map((behavior) => vectors["gold-repeat"][behavior]),
    );
    const seedStable = sameStrings(
      LEDGER_BEHAVIORS.map((behavior) => vectors.gold[behavior]),
      LEDGER_BEHAVIORS.map((behavior) => vectors["gold-next-seed"][behavior]),
    );
    const coverage = Object.fromEntries(
      LEDGER_BEHAVIORS.map((behavior) => [
        behavior,
        frozenCounterexampleIds.filter((candidate) => vectors[candidate][behavior] === "fail"),
      ]),
    );
    const coverageComplete = Object.values(coverage).every((candidates) => candidates.length > 0);
    if (JSON.stringify(admission.behavior_coverage) !== JSON.stringify(coverage)) {
      context.addIssue({
        code: "custom",
        path: ["behavior_coverage"],
        message: "behavior coverage must be derived from persisted calibration vectors",
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
        message: "admission checks must be derived from persisted calibration vectors",
      });
    }
    const allPassed = Object.values(admission.checks).every(Boolean);
    if ((admission.status === "admitted") !== (allPassed && admission.diagnostics.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "admission status must be derived from every frozen admission gate",
      });
    }
  });

const behaviorResultSchema = z.strictObject({
  behavior_id: behaviorSchema,
  status: deterministicStatusSchema,
  evidence_ref: artifactRefSchema,
});

const claimResultSchema = z
  .strictObject({
    claim_id: idSchema,
    status: deterministicStatusSchema,
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
        message: "Claim status must be derived from its deterministic behaviors",
      });
    }
  });

const deterministicAxisSchema = z
  .strictObject({
    status: deterministicStatusSchema,
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
        message: "axis status must be derived from Claim results",
      });
    }
  });

const nullableIntegerSchema = z.number().finite().int().nullable();

export const deliveryEvaluationReportSchema = z
  .strictObject({
    schema_version: z.literal(1),
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
              message: "semantic residual status must match residual Claim presence",
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
    const expectedVerdict =
      axes.measurement_validity.status !== "valid" ||
      axes.harness_impact.status !== "valid" ||
      axes.semantic_residual.status !== "not_required" ||
      axes.requirement_delta.status === "error" ||
      axes.domain_preservation.status === "error"
        ? "inconclusive"
        : axes.requirement_delta.status === "fail" || axes.domain_preservation.status === "fail"
          ? "reject"
          : "accept";
    if (report.verdict !== expectedVerdict) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "Delivery verdict must follow the frozen five-axis precedence",
      });
    }
    const claimResults = [...axes.requirement_delta.claims, ...axes.domain_preservation.claims];
    const forward = Object.fromEntries(
      claimResults.map((claim) => [
        claim.claim_id,
        claim.behaviors.map((behavior) => behavior.behavior_id),
      ]),
    );
    if (JSON.stringify(forward) !== JSON.stringify(report.traceability.claim_to_behaviors)) {
      context.addIssue({
        code: "custom",
        path: ["traceability", "claim_to_behaviors"],
        message: "report traceability drifted from persisted Claim results",
      });
    }
    const reverse = Object.fromEntries(
      LEDGER_BEHAVIORS.map((behavior) => [
        behavior,
        claimResults
          .filter((claim) => claim.behaviors.some((result) => result.behavior_id === behavior))
          .map((claim) => claim.claim_id),
      ]),
    );
    if (JSON.stringify(reverse) !== JSON.stringify(report.traceability.behavior_to_claims)) {
      context.addIssue({
        code: "custom",
        path: ["traceability", "behavior_to_claims"],
        message: "report reverse traceability drifted from persisted Claim results",
      });
    }
  });

export type ObservationCatalog = z.infer<typeof observationCatalogSchema>;
export type ClaimIr = z.infer<typeof claimIrSchema>;
export type OraclePlan = z.infer<typeof oraclePlanSchema>;
export type GraderAdmission = z.infer<typeof graderAdmissionSchema>;
export type DeliveryEvaluationReport = z.infer<typeof deliveryEvaluationReportSchema>;

export function parseObservationCatalog(input: unknown): ObservationCatalog {
  return observationCatalogSchema.parse(input);
}

export function parseClaimIr(input: unknown): ClaimIr {
  return claimIrSchema.parse(input);
}

export function parseOraclePlan(input: unknown): OraclePlan {
  return oraclePlanSchema.parse(input);
}

export function parseGraderAdmission(input: unknown): GraderAdmission {
  return graderAdmissionSchema.parse(input);
}

export function parseDeliveryEvaluationReport(input: unknown): DeliveryEvaluationReport {
  return deliveryEvaluationReportSchema.parse(input);
}
