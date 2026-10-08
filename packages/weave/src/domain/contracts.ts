import { z } from "zod";

const INTERNAL_SCHEMA_VERSION = "domain-first-internal-v0" as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const idSchema = z.string().regex(ID_PATTERN);
const versionSchema = z
  .union([z.string(), z.number().finite().nonnegative()])
  .transform(String)
  .pipe(z.string().regex(VERSION_PATTERN))
  .refine((value) => value.toLowerCase() !== "latest", "version must be exact");
const sha256Schema = z.string().regex(SHA256_PATTERN);
const timestampSchema = z.string().datetime({ offset: true });
const domainReferenceSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}#[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const versionedReferenceSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  .refine((value) => !value.toLowerCase().endsWith("@latest"), "reference must be exact");
const domainReferenceListSchema = z
  .array(domainReferenceSchema)
  .refine((values) => new Set(values).size === values.length, "references must be unique");
const relativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("://") &&
      !value.split("/").some((part) => part === "" || part === "." || part === ".."),
    "path must be normalized, relative, and contained",
  );

function uniqueBy<T extends z.ZodType>(schema: T, key: (value: z.infer<T>) => string) {
  return z
    .array(schema)
    .refine((values) => new Set(values.map(key)).size === values.length, "entries must be unique");
}

function uniqueStrings() {
  return z.array(idSchema).refine((values) => new Set(values).size === values.length, {
    message: "ids must be unique",
  });
}

export const sourceIndexSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  sources: uniqueBy(
    z.strictObject({
      source_id: idSchema,
      kind: z.enum([
        "implementation_artifact",
        "industry_guidance",
        "industry_standard",
        "provider_contract",
        "product_policy",
        "internal_contract",
        "network_rules",
        "regulation",
      ]),
      title: z.string().min(1).max(512),
      path: relativePathSchema,
      content_sha256: sha256Schema,
      recorded_at: timestampSchema,
      license: z.string().min(1).max(128),
      provenance: z.string().min(1).max(512),
      authority_scopes: z.array(z.string().min(1).max(512)).min(1),
    }),
    (source) => source.source_id,
  ),
});

const authorityAssertionSchema = z.strictObject({
  authority_id: idSchema,
  kind: z.enum([
    "implementation_maintainer",
    "industry_expert",
    "industry_standard",
    "service_provider",
    "product_owner",
    "internal_finance_owner",
    "payment_network",
    "regulator",
  ]),
  source_id: idSchema,
  scope: z.string().min(1).max(512),
});

const claimSchema = z.strictObject({
  claim_id: idSchema,
  subject_ref: idSchema,
  kind: z.enum([
    "descriptive_fact",
    "normative_rule",
    "industry_practice",
    "product_policy",
    "expert_judgment",
    "hypothesis",
  ]),
  epistemic_state: z.enum([
    "proposed",
    "grounded",
    "confirmed",
    "conflicted",
    "contested",
    "unknown",
    "retired",
  ]),
  observability: z.enum(["observable", "partially_observable", "unobservable", "unknown"]),
  statement: z.string().min(1),
  applicability: z.record(z.string().min(1), z.union([z.string(), z.number(), z.boolean()])),
  source_ids: uniqueStrings(),
  authority_assertions: uniqueBy(authorityAssertionSchema, (authority) => authority.authority_id),
  conflicts_with: uniqueStrings().optional(),
  valid_time: z.strictObject({
    from: timestampSchema,
    to: timestampSchema.optional(),
  }),
  recorded_at: timestampSchema,
});

const conceptSchema = z.strictObject({
  concept_id: idSchema,
  kind: idSchema,
  definition: z.string().min(1),
});

const relationSchema = z.strictObject({
  relation_id: idSchema,
  subject_ref: idSchema,
  predicate: idSchema,
  object_ref: idSchema,
});

const structuredModelSchema = z.strictObject({
  source_ids: uniqueStrings().min(1),
  documents: uniqueBy(
    z.strictObject({
      document_id: idSchema,
      title: z.string().min(1),
      path: relativePathSchema,
      content_sha256: sha256Schema,
    }),
    (document) => document.document_id,
  ),
  structures: uniqueBy(
    z.strictObject({
      concept_ref: idSchema,
      owner_ref: idSchema.optional(),
      boundary: z.string().min(1),
      fields: uniqueBy(
        z.strictObject({
          name: idSchema,
          type: z.string().min(1),
          nullable: z.boolean(),
          description: z.string().min(1),
          role: z.enum([
            "identity",
            "stored",
            "reference",
            "derived",
            "boundary",
            "adjacent",
            "representation",
          ]),
        }),
        (field) => field.name,
      ).min(1),
    }),
    (structure) => structure.concept_ref,
  ),
  states: uniqueBy(
    z.strictObject({ state_id: idSchema, description: z.string().min(1) }),
    (state) => state.state_id,
  ),
  transitions: uniqueBy(
    z.strictObject({
      transition_id: idSchema,
      from: idSchema,
      to: idSchema,
      trigger: idSchema,
      description: z.string().min(1),
    }),
    (transition) => transition.transition_id,
  ),
  flows: uniqueBy(
    z.strictObject({
      flow_id: idSchema,
      description: z.string().min(1),
      concept_refs: uniqueStrings().min(1),
      steps: uniqueBy(
        z.strictObject({ step_id: idSchema, description: z.string().min(1) }),
        (step) => step.step_id,
      ).min(1),
    }),
    (flow) => flow.flow_id,
  ),
  invariants: uniqueBy(
    z.strictObject({ rule_id: idSchema, description: z.string().min(1) }),
    (rule) => rule.rule_id,
  ),
});

const evolutionSchema = z.strictObject({
  evolution_id: idSchema,
  kind: z.enum(["revision", "split", "supersede", "merge"]),
  predecessor_ref: idSchema,
  successor_refs: uniqueStrings().min(1),
  source_ids: uniqueStrings().min(1),
  recorded_at: timestampSchema,
  impact: z.strictObject({
    affected_mapping_ids: uniqueStrings(),
    affected_landscape_ids: uniqueStrings().min(1),
  }),
});

export const domainModuleSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  module_id: idSchema,
  release: z.strictObject({
    version: versionSchema,
    recorded_at: timestampSchema,
  }),
  maintainers: uniqueBy(
    z.strictObject({ maintainer_id: idSchema }),
    (maintainer) => maintainer.maintainer_id,
  ).min(1),
  scope: z.strictObject({
    statement: z.string().min(1),
    includes: uniqueStrings(),
    excludes: uniqueStrings(),
  }),
  concepts: uniqueBy(conceptSchema, (concept) => concept.concept_id).min(1),
  relations: uniqueBy(relationSchema, (relation) => relation.relation_id),
  claims: uniqueBy(claimSchema, (claim) => claim.claim_id),
  model: structuredModelSchema.optional(),
  evolutions: uniqueBy(evolutionSchema, (evolution) => evolution.evolution_id).optional(),
});

const moduleReleaseReferenceSchema = z.strictObject({
  module_id: idSchema,
  version: versionSchema,
  path: relativePathSchema,
  content_sha256: sha256Schema,
});

const mappingSchema = z.strictObject({
  mapping_id: idSchema,
  version: versionSchema,
  from_ref: z.string().min(3).max(512),
  relation: z.enum([
    "broader_than",
    "narrower_than",
    "related_to",
    "part_of",
    "specializes",
    "distinct_from",
    "imports",
    "maps_to",
    "depends_on",
    "translates_via",
    "overlaps_with",
    "realizes",
    "governs",
  ]),
  to_ref: z.string().min(3).max(512),
  scope: z.string().min(1).max(512),
  required: z.boolean(),
  reviewers: uniqueStrings().min(1),
});

export const domainLandscapeSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  landscape_id: idSchema,
  release: z.strictObject({
    version: versionSchema,
    recorded_at: timestampSchema,
  }),
  curators: uniqueBy(z.strictObject({ curator_id: idSchema }), (curator) => curator.curator_id).min(
    1,
  ),
  module_releases: z.array(moduleReleaseReferenceSchema).min(1),
  mappings: uniqueBy(mappingSchema, (mapping) => mapping.mapping_id),
});

const commitmentSchema = z.strictObject({
  commitment_id: idSchema,
  target_ref: z.string().min(3).max(512),
  statement: z.string().min(1),
  deadline: z.strictObject({ value: z.number().finite().positive(), unit: idSchema }).optional(),
  required: z.boolean().optional(),
});

export const productContractsSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  product_contracts: uniqueBy(
    z.strictObject({
      contract_id: idSchema,
      version: versionSchema,
      domain_view_ref: z.string().min(3).max(512),
      product: z.strictObject({ product_id: idSchema, jurisdiction: idSchema }),
      authority: z.strictObject({
        kind: z.literal("product_owner"),
        authority_id: idSchema,
        source_id: idSchema,
        scope: z.string().min(1).max(512),
      }),
      commitments: uniqueBy(commitmentSchema, (commitment) => commitment.commitment_id).min(1),
    }),
    (contract) => contract.contract_id,
  ),
});

export const domainScopeSchema = z
  .strictObject({
    schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
    scope_id: idSchema,
    version: versionSchema,
    landscape_ref: versionedReferenceSchema,
    statement: z.string().min(1),
    included: domainReferenceListSchema.min(1),
    adjacent: domainReferenceListSchema,
    out_of_scope: uniqueStrings(),
    coverage_statuses: z
      .array(z.enum(["missing", "unknown", "contested", "unobservable", "out_of_scope"]))
      .min(1)
      .refine((values) => new Set(values).size === values.length, "statuses must be unique"),
    anti_truncation: z.strictObject({
      concept_ref: domainReferenceSchema,
      remains_in_scope_when_unobservable: z.literal(true),
    }),
  })
  .superRefine((scope, context) => {
    if (scope.adjacent.some((reference) => scope.included.includes(reference))) {
      context.addIssue({
        code: "custom",
        message: "included and adjacent references must be disjoint",
      });
    }
    if (!scope.included.includes(scope.anti_truncation.concept_ref)) {
      context.addIssue({ code: "custom", message: "anti-truncation Concept must remain included" });
    }
  });

export const domainViewSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  view_id: idSchema,
  version: versionSchema,
  landscape_ref: versionedReferenceSchema,
  scope_ref: versionedReferenceSchema,
  context: z.strictObject({
    jurisdiction: idSchema,
    customer_type: idSchema,
    channel: idSchema,
    order_payment_state: idSchema,
    fulfillment_state: idSchema,
    valid_at: timestampSchema,
    knowledge_recorded_at: timestampSchema,
  }),
  selected_claim_refs: domainReferenceListSchema.min(1),
  preserve_epistemic_states: z.array(
    z.enum(["proposed", "grounded", "confirmed", "conflicted", "contested", "unknown", "retired"]),
  ),
  preserve_observability_states: z.array(
    z.enum(["observable", "partially_observable", "unobservable", "unknown"]),
  ),
});

const gradeOutcomeSchema = z.enum([
  "pass",
  "fail",
  "not_applicable",
  "insufficient_evidence",
  "indeterminate",
]);

const cohortReferenceSchema = z.strictObject({
  cohort_id: idSchema,
  cases_path: relativePathSchema,
  expectations_path: relativePathSchema,
  content_sha256: sha256Schema,
});

export const domainEvaluationSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  episode: z.strictObject({
    episode_id: idSchema,
    identities: z.strictObject({
      order_id: idSchema,
      refund_instruction_id: idSchema,
      provider_refund_id: idSchema,
      coupon_entitlement_id: idSchema,
      ledger_reconciliation_id: idSchema,
    }),
    opportunity: z.strictObject({
      order_id: idSchema,
      paid: z.boolean(),
      fulfillment_state: idSchema,
      cancellation_accepted_at: timestampSchema,
    }),
    original_value: z.strictObject({
      currency: idSchema,
      cash: z.number().finite().nonnegative(),
      coupon: z.number().finite().nonnegative(),
    }),
    expected_consequence: z.strictObject({
      cash_to_original_tender: z.number().finite().nonnegative(),
      coupon_entitlement_restored: z.number().finite().nonnegative(),
      successful_economic_refund_count: z.number().int().nonnegative(),
      ledger_balanced: z.boolean(),
    }),
  }),
  projections: uniqueBy(
    z.strictObject({
      projection_id: idSchema,
      version: versionSchema,
      domain_view_ref: versionedReferenceSchema,
      product_contract_ref: versionedReferenceSchema,
      selected_refs: domainReferenceListSchema.min(1),
      exclusions: uniqueBy(
        z.strictObject({ concept_ref: domainReferenceSchema, reason: z.string().min(1) }),
        (exclusion) => exclusion.concept_ref,
      ),
    }),
    (projection) => projection.projection_id,
  ),
  observation_profiles: uniqueBy(
    z
      .strictObject({
        observation_profile_id: idSchema,
        time_semantics: z.strictObject({
          business_time_field: idSchema,
          observation_time_field: idSchema,
          allowed_lateness: z.strictObject({
            value: z.number().finite().nonnegative(),
            unit: idSchema,
          }),
        }),
        absence_semantics: z.strictObject({
          complete_channel_absence: z.literal("fail"),
          unavailable_channel_absence: z.literal("insufficient_evidence"),
        }),
        bindings: uniqueBy(
          z.strictObject({
            concept_ref: domainReferenceSchema,
            source: idSchema,
            completeness: z.enum(["complete", "partial", "unavailable"]),
            covers_refs: domainReferenceListSchema.min(1),
          }),
          (binding) => binding.concept_ref,
        ),
      })
      .superRefine((profile, context) => {
        const covered = new Set<string>();
        for (const binding of profile.bindings) {
          if (!binding.covers_refs.includes(binding.concept_ref)) {
            context.addIssue({
              code: "custom",
              message: `binding ${binding.concept_ref} must cover itself`,
            });
          }
          for (const reference of binding.covers_refs) {
            if (covered.has(reference)) {
              context.addIssue({
                code: "custom",
                message: `observation coverage overlaps at ${reference}`,
              });
            }
            covered.add(reference);
          }
        }
      }),
    (profile) => profile.observation_profile_id,
  ),
  closure_expectations: uniqueBy(
    z
      .strictObject({
        closure_id: idSchema,
        projection_ref: versionedReferenceSchema,
        observation_profile_ref: idSchema,
        expected_status: z.enum(["complete", "refused"]),
        expected_blocker: idSchema.optional(),
        blocker_ref: domainReferenceSchema.optional(),
      })
      .superRefine((closure, context) => {
        const hasBlocker =
          closure.expected_blocker !== undefined || closure.blocker_ref !== undefined;
        if (closure.expected_status === "complete" && hasBlocker) {
          context.addIssue({
            code: "custom",
            message: "complete Closure declaration cannot carry a blocker",
          });
        }
        if (
          closure.expected_status === "refused" &&
          (closure.expected_blocker === undefined || closure.blocker_ref === undefined)
        ) {
          context.addIssue({
            code: "custom",
            message: "refused Closure declaration requires exact blocker code and reference",
          });
        }
      }),
    (closure) => closure.closure_id,
  ),
  grade_atoms: uniqueBy(
    z.strictObject({
      grade_id: idSchema,
      target_claim_ref: domainReferenceSchema,
      expected_outcomes: z.array(gradeOutcomeSchema).min(1),
      utility_claim: z.string().min(1),
      estimator: z.strictObject({
        predicate_id: idSchema,
        input_fields: uniqueStrings().min(1),
      }),
      validity_bounds: z.array(z.string().min(1)).min(1),
      consumer: z.strictObject({ role: idSchema, action: idSchema }),
      calibration_plan: z.strictObject({
        development_cohort_ref: idSchema,
        calibration_cohort_ref: idSchema,
        validation_cohort_ref: idSchema,
      }),
      repeatability_contract: z.strictObject({
        mode: z.literal("artifact-only"),
        allowed_variance: z.literal("zero"),
        frozen_inputs: uniqueStrings().min(1),
      }),
    }),
    (grade) => grade.grade_id,
  ),
  verdict_policy: z.strictObject({
    preserve_atomic_vector: z.literal(true),
    precedence: z.tuple([
      z.literal("fail"),
      z.literal("indeterminate"),
      z.literal("insufficient_evidence"),
      z.literal("pass"),
      z.literal("not_applicable"),
    ]),
  }),
  validation_cohort_plan: z.strictObject({
    development: cohortReferenceSchema,
    calibration: cohortReferenceSchema,
    validation: cohortReferenceSchema,
    cohorts_must_be_disjoint: z.literal(true),
  }),
  qualification_protocol: z.strictObject({
    candidate_freeze_schema: z.literal("domain-first-qualification-candidate-v0"),
    curator_freeze_schema: z.literal("domain-first-holdout-freeze-v0"),
    execution_schema: z.literal("domain-first-holdout-execution-v0"),
    unseal_schema: z.literal("domain-first-holdout-unseal-v0"),
    independent_curator_required: z.literal(true),
    retired_holdout_observation_digests: z.array(sha256Schema),
  }),
});

const observationValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const cohortCasesSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  cohort_id: idSchema,
  role: z.enum(["development", "calibration", "validation"]),
  cases: uniqueBy(
    z.strictObject({
      case_id: idSchema,
      kind: z.enum(["development", "gold", "equivalent", "mutant"]),
      observations: z.record(z.string().min(1), observationValueSchema),
    }),
    (fixtureCase) => fixtureCase.case_id,
  ).min(1),
});

export const cohortExpectationsSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  cohort_id: idSchema,
  authored_independently: z.literal(true).optional(),
  reference_expectations: z.literal(true).optional(),
  expectations: uniqueBy(
    z.strictObject({
      case_id: idSchema,
      atoms: z.record(idSchema, gradeOutcomeSchema),
      overall: gradeOutcomeSchema,
    }),
    (expectation) => expectation.case_id,
  ).min(1),
});

export const qualificationCasesSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  cohort_id: idSchema,
  role: z.literal("qualification"),
  curator_id: idSchema,
  curator_authority: z.strictObject({
    provider: z.literal("cat-cafe"),
    assignment_message_id: z.string().min(1),
    acceptance_message_id: z.string().min(1),
  }),
  cases: uniqueBy(
    z.strictObject({
      case_id: idSchema,
      kind: z.enum(["gold", "equivalent", "mutant"]),
      observations: z.record(z.string().min(1), observationValueSchema),
    }),
    (fixtureCase) => fixtureCase.case_id,
  ).min(1),
});

export const qualificationExpectationsSchema = z.strictObject({
  schema_version: z.literal(INTERNAL_SCHEMA_VERSION),
  cohort_id: idSchema,
  curator_id: idSchema,
  expectations: uniqueBy(
    z.strictObject({
      case_id: idSchema,
      atoms: z.record(idSchema, gradeOutcomeSchema),
      overall: gradeOutcomeSchema,
    }),
    (expectation) => expectation.case_id,
  ).min(1),
});

export type SourceIndex = z.infer<typeof sourceIndexSchema>;
export type DomainModule = z.infer<typeof domainModuleSchema>;
export type DomainLandscape = z.infer<typeof domainLandscapeSchema>;
export type ProductContracts = z.infer<typeof productContractsSchema>;
export type DomainScope = z.infer<typeof domainScopeSchema>;
export type DomainView = z.infer<typeof domainViewSchema>;
export type DomainEvaluation = z.infer<typeof domainEvaluationSchema>;
export type CohortCases = z.infer<typeof cohortCasesSchema>;
export type CohortExpectations = z.infer<typeof cohortExpectationsSchema>;
export type QualificationCases = z.infer<typeof qualificationCasesSchema>;
export type QualificationExpectations = z.infer<typeof qualificationExpectationsSchema>;
