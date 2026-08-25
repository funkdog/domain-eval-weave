import { z } from "zod";

import { canonicalJson } from "../contracts/canonical-json.js";
import {
  EFFECT_FIELD_DOMAIN,
  EFFECT_FIELDS,
  PHASE3C_DIMENSIONS,
  PHASE3C_EFFECT_FIELDS,
  PHASE3C_EFFECTS,
  PHASE3C_NORMAL_FORM_SLOTS,
  PHASE3C_OPERATIONS,
  PHASE3C_PUBLIC_OBSERVATION_CATALOG,
  PHASE3C_RELATIONS,
  PHASE3C_SCALAR_DOMAINS,
  PHASE3C_STATE_FIELDS,
  PHASE3C_STIMULI,
  PHASE3C_STIMULUS_FIELDS,
  type Phase3cScalarDomain,
  STATE_FIELD_DOMAIN,
  STIMULUS_FIELD_DOMAIN,
} from "./vocabulary.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_REF_PATTERN =
  /^artifact:\/\/campaign\/(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))(?!.*\/\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

const idSchema = z.string().regex(ID_PATTERN);
export const phase3cSha256Schema = z.string().regex(SHA256_PATTERN);
export const phase3cArtifactPointerSchema = z.strictObject({
  ref: z.string().regex(ARTIFACT_REF_PATTERN),
  sha256: phase3cSha256Schema,
});
const unique = <T extends z.ZodTypeAny>(item: T, minimum = 0, maximum?: number) => {
  let schema = z.array(item).min(minimum);
  if (maximum !== undefined) schema = schema.max(maximum);
  return schema.refine(
    (values) => new Set(values.map((value) => canonicalJson(value))).size === values.length,
    "values must be unique",
  );
};

const operationSchema = z.enum(PHASE3C_OPERATIONS);
const stateFieldSchema = z.enum(PHASE3C_STATE_FIELDS);
const effectSchema = z.enum(PHASE3C_EFFECTS);
const effectFieldSchema = z.enum(PHASE3C_EFFECT_FIELDS);
const stimulusSchema = z.enum(PHASE3C_STIMULI);
const stimulusFieldSchema = z.enum(PHASE3C_STIMULUS_FIELDS);
const slotSchema = z.enum(PHASE3C_NORMAL_FORM_SLOTS);
const relationSchema = z.enum(PHASE3C_RELATIONS);
const scalarDomainSchema = z.enum(PHASE3C_SCALAR_DOMAINS);
const dimensionSchema = z.enum(PHASE3C_DIMENSIONS);
const scalarSchema = z.union([z.string(), z.number().finite().int(), z.boolean(), z.null()]);

export const publicObservationCatalogSchema = z.custom<typeof PHASE3C_PUBLIC_OBSERVATION_CATALOG>(
  (value) => canonicalJson(value) === canonicalJson(PHASE3C_PUBLIC_OBSERVATION_CATALOG),
  "public observation catalog must equal the frozen v3 vocabulary",
);

const authorityDimensionSchema = z.strictObject({
  dimension_id: dimensionSchema,
  disposition: z.enum(["deterministic", "semantic_residual", "out_of_scope"]),
  claim_ids: unique(idSchema),
  authority_refs: unique(phase3cArtifactPointerSchema, 1),
});

export const observationAuthorityMapSchema = z
  .strictObject({
    schema_version: z.literal(1),
    catalog_sha256: phase3cSha256Schema,
    claim_ir_sha256: phase3cSha256Schema,
    dimensions: z.array(authorityDimensionSchema),
  })
  .superRefine((value, context) => {
    const ids = value.dimensions.map((entry) => entry.dimension_id);
    if (canonicalJson(ids) !== canonicalJson(PHASE3C_DIMENSIONS)) {
      context.addIssue({
        code: "custom",
        path: ["dimensions"],
        message: "dimension map must be total and canonical",
      });
    }
    for (const [index, entry] of value.dimensions.entries()) {
      if (
        entry.disposition === "out_of_scope"
          ? entry.claim_ids.length !== 0
          : entry.claim_ids.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["dimensions", index, "claim_ids"],
          message:
            "claimed dimensions and out-of-scope dimensions require different authority shapes",
        });
      }
    }
  });

const scalarLiteralSchema = z.strictObject({
  type: z.literal("scalar_literal"),
  domain_id: scalarDomainSchema,
  value: scalarSchema,
});
const stimulusValueSchema = z.strictObject({
  type: z.literal("stimulus_value"),
  stimulus_id: stimulusSchema,
  field_id: stimulusFieldSchema,
});
const stateValueSchema = z.strictObject({
  type: z.literal("state_value"),
  slot: slotSchema,
  field_id: stateFieldSchema,
});
const effectAttributeValueSchema = z.strictObject({
  type: z.literal("effect_attribute_value"),
  slot: slotSchema,
  effect_id: effectSchema,
  field_id: effectFieldSchema,
});
export const expectedValueSchema = z.discriminatedUnion("type", [
  scalarLiteralSchema,
  stimulusValueSchema,
  stateValueSchema,
  effectAttributeValueSchema,
]);
export type ExpectedValue = z.infer<typeof expectedValueSchema>;

export type ObservationExpression =
  | { readonly type: "all_of" | "any_of"; readonly children: readonly ObservationExpression[] }
  | {
      readonly type: "operation_status_is";
      readonly operation_id: (typeof PHASE3C_OPERATIONS)[number];
      readonly expected_status: "accepted" | "rejected" | "unavailable";
    }
  | {
      readonly type: "state_field_compare";
      readonly slot: (typeof PHASE3C_NORMAL_FORM_SLOTS)[number];
      readonly field_id: (typeof PHASE3C_STATE_FIELDS)[number];
      readonly comparator: "equals" | "not_equals" | "one_of" | "unchanged";
      readonly expected_values: readonly ExpectedValue[];
    }
  | {
      readonly type: "effect_count_is";
      readonly slot: (typeof PHASE3C_NORMAL_FORM_SLOTS)[number];
      readonly effect_id: (typeof PHASE3C_EFFECTS)[number];
      readonly cardinality: {
        readonly mode: "exactly" | "at_least" | "at_most";
        readonly value: number;
      };
    }
  | {
      readonly type: "effect_attributes_compare";
      readonly slot: (typeof PHASE3C_NORMAL_FORM_SLOTS)[number];
      readonly effect_id: (typeof PHASE3C_EFFECTS)[number];
      readonly field_id: (typeof PHASE3C_EFFECT_FIELDS)[number];
      readonly comparator: "equals" | "not_equals" | "one_of";
      readonly expected_values: readonly ExpectedValue[];
    }
  | {
      readonly type: "multiset_compare";
      readonly left: (typeof PHASE3C_NORMAL_FORM_SLOTS)[number];
      readonly right: (typeof PHASE3C_NORMAL_FORM_SLOTS)[number];
      readonly effect_id: (typeof PHASE3C_EFFECTS)[number] | "all";
      readonly comparator: "multiset_equals";
    }
  | { readonly type: "relation_holds"; readonly relation_id: (typeof PHASE3C_RELATIONS)[number] }
  | {
      readonly type: "retention_window_compare";
      readonly clock_stimulus_id: "retention_clock";
      readonly comparator: "within";
      readonly window_ms: number;
    };

function validScalar(domain: Phase3cScalarDomain, value: z.infer<typeof scalarSchema>): boolean {
  if (domain === "boolean") return typeof value === "boolean";
  if (domain === "nonnegative_integer" || domain === "nonnegative_minor_units") {
    return typeof value === "number" && value >= 0;
  }
  if (domain === "positive_version") return typeof value === "number" && value >= 1;
  if (domain === "opaque_id") return typeof value === "string" && value.length > 0;
  if (domain === "timestamp") return typeof value === "string" && !Number.isNaN(Date.parse(value));
  const values: Readonly<Record<string, readonly string[]>> = {
    order_status_enum: ["pending_payment", "paid", "cancelled"],
    fulfillment_state_enum: ["not_started", "active", "handed_off"],
    withdrawal_state_enum: ["none", "pending", "completed", "rejected", "failed"],
    refund_status_enum: ["none", "pending", "refunded"],
    currency_enum: ["USD"],
    coupon_state_enum: ["absent", "eligible", "expired", "restored"],
  };
  return typeof value === "string" && (values[domain]?.includes(value) ?? false);
}

function expectedDomain(value: ExpectedValue): Phase3cScalarDomain {
  if (value.type === "scalar_literal") return value.domain_id;
  if (value.type === "stimulus_value") return STIMULUS_FIELD_DOMAIN[value.field_id];
  if (value.type === "state_value") return STATE_FIELD_DOMAIN[value.field_id];
  return EFFECT_FIELD_DOMAIN[value.field_id];
}

const compositeExpressionSchema: z.ZodTypeAny = z.strictObject({
  type: z.enum(["all_of", "any_of"]),
  children: z.lazy(() => z.array(expressionSchema).min(2).max(32)),
});
const operationExpressionSchema = z.strictObject({
  type: z.literal("operation_status_is"),
  operation_id: operationSchema,
  expected_status: z.enum(["accepted", "rejected", "unavailable"]),
});
const stateExpressionSchema = z
  .strictObject({
    type: z.literal("state_field_compare"),
    slot: slotSchema,
    field_id: stateFieldSchema,
    comparator: z.enum(["equals", "not_equals", "one_of", "unchanged"]),
    expected_values: z.array(expectedValueSchema).max(8),
  })
  .superRefine((value, context) => {
    const expectedCount =
      value.comparator === "unchanged" ? 0 : value.comparator === "one_of" ? undefined : 1;
    if (
      (expectedCount === undefined && value.expected_values.length < 1) ||
      (expectedCount !== undefined && value.expected_values.length !== expectedCount)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expected_values"],
        message: "comparator has an invalid arity",
      });
    }
    const domain = STATE_FIELD_DOMAIN[value.field_id];
    for (const [index, expected] of value.expected_values.entries()) {
      if (
        expectedDomain(expected) !== domain ||
        (expected.type === "scalar_literal" && !validScalar(domain, expected.value))
      ) {
        context.addIssue({
          code: "custom",
          path: ["expected_values", index],
          message: "expected value domain mismatch",
        });
      }
    }
  });
const effectCountExpressionSchema = z.strictObject({
  type: z.literal("effect_count_is"),
  slot: slotSchema,
  effect_id: effectSchema,
  cardinality: z.strictObject({
    mode: z.enum(["exactly", "at_least", "at_most"]),
    value: z.number().finite().int().nonnegative(),
  }),
});
const effectAttributeExpressionSchema = z
  .strictObject({
    type: z.literal("effect_attributes_compare"),
    slot: slotSchema,
    effect_id: effectSchema,
    field_id: effectFieldSchema,
    comparator: z.enum(["equals", "not_equals", "one_of"]),
    expected_values: z.array(expectedValueSchema).min(1).max(8),
  })
  .superRefine((value, context) => {
    const shape = EFFECT_FIELDS[value.effect_id];
    if (![...shape.identity, ...shape.attributes].includes(value.field_id)) {
      context.addIssue({
        code: "custom",
        path: ["field_id"],
        message: "effect field is not public for this effect",
      });
    }
    if (value.comparator !== "one_of" && value.expected_values.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["expected_values"],
        message: "comparator has an invalid arity",
      });
    }
    const domain = EFFECT_FIELD_DOMAIN[value.field_id];
    for (const [index, expected] of value.expected_values.entries()) {
      if (
        expectedDomain(expected) !== domain ||
        (expected.type === "scalar_literal" && !validScalar(domain, expected.value))
      ) {
        context.addIssue({
          code: "custom",
          path: ["expected_values", index],
          message: "expected value domain mismatch",
        });
      }
    }
  });
const multisetExpressionSchema = z.strictObject({
  type: z.literal("multiset_compare"),
  left: slotSchema,
  right: slotSchema,
  effect_id: z.union([effectSchema, z.literal("all")]),
  comparator: z.literal("multiset_equals"),
});
const relationExpressionSchema = z.strictObject({
  type: z.literal("relation_holds"),
  relation_id: relationSchema,
});
const retentionExpressionSchema = z.strictObject({
  type: z.literal("retention_window_compare"),
  clock_stimulus_id: z.literal("retention_clock"),
  comparator: z.literal("within"),
  window_ms: z.number().finite().int().nonnegative(),
});

export const expressionSchema: z.ZodType<ObservationExpression> = z.lazy(
  () =>
    z.union([
      compositeExpressionSchema,
      operationExpressionSchema,
      stateExpressionSchema,
      effectCountExpressionSchema,
      effectAttributeExpressionSchema,
      multisetExpressionSchema,
      relationExpressionSchema,
      retentionExpressionSchema,
    ]) as z.ZodType<ObservationExpression>,
);

const observationBindingSchema = z.strictObject({
  observation_id: idSchema,
  claim_id: idSchema,
  axis: z.enum(["requirement_delta", "domain_preservation"]),
  dimension_ids: unique(dimensionSchema, 1),
  stimulus_id: stimulusSchema,
  expression: expressionSchema,
});

export const observationBoundarySpecSchema = z.strictObject({
  schema_version: z.literal(3),
  boundary_id: z.literal("commerce-order-observation-boundary-v3"),
  template_id: z.literal("commerce-order-cancellation-v3"),
  source: z.strictObject({
    domain_manifest: phase3cArtifactPointerSchema,
    requirement: phase3cArtifactPointerSchema,
    claim_ir: phase3cArtifactPointerSchema,
    task_pack: phase3cArtifactPointerSchema,
  }),
  public_surface_sha256: phase3cSha256Schema,
  public_observation_catalog_sha256: phase3cSha256Schema,
  authority_map_sha256: phase3cSha256Schema,
  bindings: z.array(observationBindingSchema).min(1),
  normal_form_version: z.literal("domain-observation-normal-form-v1"),
  runner_sha256: phase3cSha256Schema,
});

export const deterministicObservationEntrySchema = z.strictObject({
  observation_id: idSchema,
  claim_id: idSchema,
  axis: z.enum(["requirement_delta", "domain_preservation"]),
  dimension_ids: unique(dimensionSchema, 1),
  status: z.enum(["pass", "fail", "error"]),
  normal_form_ref: phase3cArtifactPointerSchema.nullable(),
  evidence_refs: unique(phase3cArtifactPointerSchema, 1),
});

export const deterministicObservationResultSchema = z
  .strictObject({
    schema_version: z.literal(3),
    template_id: z.literal("commerce-order-cancellation-v3"),
    boundary_sha256: phase3cSha256Schema,
    candidate_archive: phase3cArtifactPointerSchema,
    candidate_tree_sha256_before: phase3cSha256Schema,
    candidate_tree_sha256_after: phase3cSha256Schema,
    seed: z.number().int().nonnegative(),
    observations: z.array(deterministicObservationEntrySchema).min(1),
    measurement_validity: z.enum(["valid", "invalid"]),
  })
  .superRefine((value, context) => {
    const observationIds = value.observations.map((entry) => entry.observation_id);
    if (new Set(observationIds).size !== observationIds.length) {
      context.addIssue({
        code: "custom",
        path: ["observations"],
        message: "deterministic observation ids must be unique",
      });
    }
    for (const [index, observation] of value.observations.entries()) {
      if ((observation.status === "error") !== (observation.normal_form_ref === null)) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "normal_form_ref"],
          message: "only execution errors omit a normal form",
        });
      }
    }
    const shouldBeValid =
      value.candidate_tree_sha256_before === value.candidate_tree_sha256_after &&
      value.observations.every((entry) => entry.status !== "error");
    if ((value.measurement_validity === "valid") !== shouldBeValid) {
      context.addIssue({
        code: "custom",
        path: ["measurement_validity"],
        message: "deterministic validity disagrees with execution evidence",
      });
    }
  });

export const observationCalibrationCaseSchema = z.strictObject({
  case_id: idSchema,
  case_kind: z.enum(["gold", "equivalent", "mutant", "relaxation_mutant"]),
  candidate_archive: phase3cArtifactPointerSchema,
  expected_failed_observation_ids: unique(idSchema),
  observed_failed_observation_ids: unique(idSchema),
  deterministic_result: phase3cArtifactPointerSchema,
  match: z.enum(["pass", "fail"]),
});

export const observationBoundaryAdmissionSchema = z
  .strictObject({
    schema_version: z.literal(1),
    boundary_sha256: phase3cSha256Schema,
    task_pack_sha256: phase3cSha256Schema,
    runner_sha256: phase3cSha256Schema,
    seed: z.number().int().nonnegative(),
    cases: z.array(observationCalibrationCaseSchema).min(4),
    false_reject_case_ids: unique(idSchema),
    false_accept_case_ids: unique(idSchema),
    status: z.enum(["admitted", "rejected"]),
  })
  .superRefine((value, context) => {
    const caseIds = value.cases.map((entry) => entry.case_id);
    if (new Set(caseIds).size !== caseIds.length) {
      context.addIssue({ code: "custom", path: ["cases"], message: "case ids must be unique" });
    }
    const kinds = new Set(value.cases.map((entry) => entry.case_kind));
    for (const kind of ["gold", "equivalent", "mutant", "relaxation_mutant"] as const) {
      if (!kinds.has(kind)) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: `calibration is missing ${kind}`,
        });
      }
    }
    const falseRejects = value.cases
      .filter(
        (entry) =>
          (entry.case_kind === "gold" || entry.case_kind === "equivalent") &&
          entry.match === "fail",
      )
      .map((entry) => entry.case_id);
    const falseAccepts = value.cases
      .filter(
        (entry) =>
          (entry.case_kind === "mutant" || entry.case_kind === "relaxation_mutant") &&
          entry.match === "fail",
      )
      .map((entry) => entry.case_id);
    if (
      canonicalJson(value.false_reject_case_ids) !== canonicalJson(falseRejects) ||
      canonicalJson(value.false_accept_case_ids) !== canonicalJson(falseAccepts) ||
      (value.status === "admitted") !== (falseRejects.length === 0 && falseAccepts.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "observation admission is not derived from exact calibration outcomes",
      });
    }
  });

export const ABSTENTION_REASONS = [
  "insufficient_evidence",
  "conflicting_authority",
  "rubric_not_applicable",
  "out_of_distribution",
  "unsafe_or_untrusted_instruction",
  "unstable_across_repeats",
] as const;
const abstentionReasonSchema = z.enum(ABSTENTION_REASONS);

export const SEMANTIC_DIMENSIONS = [
  "requirement_intent_alignment",
  "architecture_fit",
  "failure_semantics_coherence",
  "handoff_comprehensibility",
] as const;
export const CODE_QUALITY_DIMENSIONS = [
  "change_scope_discipline",
  "cohesion_and_responsibility",
  "state_transition_clarity",
  "error_handling_clarity",
  "test_maintainability",
  "duplication_and_locality",
] as const;
export const semanticDimensionSchema = z.enum(SEMANTIC_DIMENSIONS);
export const codeQualityDimensionSchema = z.enum(CODE_QUALITY_DIMENSIONS);
const evidenceKindSchema = z.enum([
  "requirement_ref",
  "domain_ref",
  "code_location",
  "base_or_diff_ref",
]);
export const modelRouteSchema = z.strictObject({
  provider: idSchema,
  model: idSchema,
  reasoning_effort: idSchema,
});

export const semanticJudgeContractSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_contract_id: z.literal("phase3c-semantic-judge-v1"),
  dimensions: z
    .array(
      z.strictObject({
        dimension_id: semanticDimensionSchema,
        applicability: z.enum(["required", "optional"]),
        decision_rule: z.string().min(1).max(2_000),
        blocking: z.boolean(),
        required_evidence: unique(evidenceKindSchema, 1),
      }),
    )
    .min(1),
  model_route: modelRouteSchema,
  prompt_sha256: phase3cSha256Schema,
  output_schema_sha256: phase3cSha256Schema,
  calibration_admission_sha256: phase3cSha256Schema,
  repeats_per_evaluation: z.literal(3),
});

const codeQualityConditionSchema = z.strictObject({
  condition_id: idSchema,
  level: z.enum(["blocking", "concern"]),
  statement: z.string().min(1).max(2_000),
  applicability: z.string().min(1).max(1_000),
  required_evidence: unique(evidenceKindSchema, 1),
});
export const codeQualityJudgeContractSchema = z.strictObject({
  schema_version: z.literal(1),
  rubric_id: z.literal("phase3c-code-quality-v1"),
  dimensions: z
    .array(
      z.strictObject({
        dimension_id: codeQualityDimensionSchema,
        applicability: z.enum(["required", "optional"]),
        decision_rule: z.string().min(1).max(2_000),
        required_evidence: unique(evidenceKindSchema, 1),
        conditions: z.array(codeQualityConditionSchema),
      }),
    )
    .min(1),
  model_route: modelRouteSchema,
  prompt_sha256: phase3cSha256Schema,
  output_schema_sha256: phase3cSha256Schema,
  calibration_admission_sha256: phase3cSha256Schema,
  repeats_per_evaluation: z.literal(3),
});

export const sourceLocatorSchema = z.strictObject({
  source_ref: z.string().regex(ARTIFACT_REF_PATTERN),
  locator: z.string().min(1).max(512),
});
const judgeDimensionBase = {
  applicability: z.enum(["applicable", "not_applicable"]),
  verdict: z.enum(["pass", "fail", "abstain"]),
  severity: z.enum(["blocking", "concern", "none"]),
  matched_condition_ids: unique(idSchema),
  evidence: z.array(sourceLocatorSchema),
  rationale: z.string().min(1).max(2_000),
  counterevidence: z.string().max(2_000).nullable(),
  abstention_reason: abstentionReasonSchema.nullable(),
} as const;
export const semanticJudgeDimensionSchema = z.strictObject({
  dimension_id: semanticDimensionSchema,
  ...judgeDimensionBase,
  matched_condition_ids: z.array(idSchema).max(0),
});
export const codeQualityJudgeDimensionSchema = z.strictObject({
  dimension_id: codeQualityDimensionSchema,
  ...judgeDimensionBase,
});
export const semanticJudgeRunResultSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_kind: z.literal("semantic"),
  judge_contract_sha256: phase3cSha256Schema,
  input_manifest_sha256: phase3cSha256Schema,
  dimensions: z.array(semanticJudgeDimensionSchema).min(1),
  protocol_status: z.enum(["valid", "invalid"]),
});
export const codeQualityJudgeRunResultSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_kind: z.literal("code_quality"),
  rubric_sha256: phase3cSha256Schema,
  input_manifest_sha256: phase3cSha256Schema,
  dimensions: z.array(codeQualityJudgeDimensionSchema).min(1),
  protocol_status: z.enum(["valid", "invalid"]),
});

export const semanticJudgeResultSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_kind: z.literal("semantic"),
  judge_contract_sha256: phase3cSha256Schema,
  input_manifest_sha256: phase3cSha256Schema,
  run_receipts: z.tuple([
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
  ]),
  repeat_results: z.tuple([
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
  ]),
  dimensions: z.array(semanticJudgeDimensionSchema).min(1),
  protocol_status: z.enum(["valid", "invalid"]),
});

export const codeQualityJudgeResultSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_kind: z.literal("code_quality"),
  rubric_sha256: phase3cSha256Schema,
  input_manifest_sha256: phase3cSha256Schema,
  run_receipts: z.tuple([
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
  ]),
  repeat_results: z.tuple([
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
  ]),
  dimensions: z.array(codeQualityJudgeDimensionSchema).min(1),
  protocol_status: z.enum(["valid", "invalid"]),
});

const baseJudgeInputManifest = {
  schema_version: z.literal(1),
  candidate_archive: phase3cArtifactPointerSchema,
  candidate_diff: phase3cArtifactPointerSchema,
  base_tree: phase3cArtifactPointerSchema,
  public_task: phase3cArtifactPointerSchema,
  untrusted_candidate_content: z.literal(true),
} as const;

export const semanticJudgeInputManifestSchema = z.strictObject({
  ...baseJudgeInputManifest,
  judge_kind: z.literal("semantic"),
  requirement: phase3cArtifactPointerSchema,
  domain_refs: unique(phase3cArtifactPointerSchema, 1),
  semantic_residual_claim_ids: unique(idSchema),
  judge_contract: phase3cArtifactPointerSchema,
});

export const codeQualityJudgeInputManifestSchema = z.strictObject({
  ...baseJudgeInputManifest,
  judge_kind: z.literal("code_quality"),
  public_test_evidence: unique(phase3cArtifactPointerSchema),
  rubric: phase3cArtifactPointerSchema,
});

export const judgeInputManifestSchema = z.discriminatedUnion("judge_kind", [
  semanticJudgeInputManifestSchema,
  codeQualityJudgeInputManifestSchema,
]);

export const judgeCaseInputSetSchema = z.strictObject({
  schema_version: z.literal(1),
  set_id: idSchema,
  judge_kind: z.enum(["semantic", "code_quality"]),
  set_kind: z.enum(["development", "locked_admission", "locked_bias"]),
  cases: z
    .array(
      z.strictObject({
        case_id: idSchema,
        input_closure_sha256: phase3cSha256Schema,
        risk_class: z.enum(["critical", "standard"]),
        canonical_case_id: idSchema.nullable(),
        transform_id: idSchema.nullable(),
      }),
    )
    .min(1),
});

const expectedDimensionSchema = z.strictObject({
  dimension_id: z.union([semanticDimensionSchema, codeQualityDimensionSchema]),
  applicability: z.enum(["applicable", "not_applicable"]),
  verdict: z.enum(["pass", "fail", "abstain"]),
  severity: z.enum(["blocking", "concern", "none"]),
  matched_condition_ids: unique(idSchema),
  abstention_reason: abstentionReasonSchema.nullable(),
});
export const judgeLabelSetSchema = z
  .strictObject({
    schema_version: z.literal(1),
    judge_kind: z.enum(["semantic", "code_quality"]),
    set_kind: z.enum(["development", "locked_admission", "locked_bias"]),
    input_set_sha256: phase3cSha256Schema,
    labels: z
      .array(
        z.strictObject({
          case_id: idSchema,
          human_labels: z.tuple([phase3cArtifactPointerSchema, phase3cArtifactPointerSchema]),
          adjudication: phase3cArtifactPointerSchema,
          expected_dimensions: z.array(expectedDimensionSchema).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((value, context) => {
    for (const [labelIndex, label] of value.labels.entries()) {
      if (
        canonicalJson(label.human_labels[0]) === canonicalJson(label.human_labels[1]) ||
        label.human_labels.some(
          (humanLabel) => canonicalJson(humanLabel) === canonicalJson(label.adjudication),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["labels", labelIndex, "human_labels"],
          message: "human labels and adjudication must have independent artifact identities",
        });
      }
      if (
        new Set(label.expected_dimensions.map((dimension) => dimension.dimension_id)).size !==
        label.expected_dimensions.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["labels", labelIndex, "expected_dimensions"],
          message: "expected Judge dimensions must be unique",
        });
      }
      for (const [dimensionIndex, dimension] of label.expected_dimensions.entries()) {
        const semantic = new Set<string>(SEMANTIC_DIMENSIONS).has(dimension.dimension_id);
        if ((value.judge_kind === "semantic") !== semantic) {
          context.addIssue({
            code: "custom",
            path: ["labels", labelIndex, "expected_dimensions", dimensionIndex, "dimension_id"],
            message: "dimension does not match Judge kind",
          });
        }
        if ((dimension.verdict === "abstain") !== (dimension.abstention_reason !== null)) {
          context.addIssue({
            code: "custom",
            path: [
              "labels",
              labelIndex,
              "expected_dimensions",
              dimensionIndex,
              "abstention_reason",
            ],
            message: "abstention reason must match verdict",
          });
        }
        if (value.judge_kind === "semantic" && dimension.matched_condition_ids.length !== 0) {
          context.addIssue({
            code: "custom",
            path: [
              "labels",
              labelIndex,
              "expected_dimensions",
              dimensionIndex,
              "matched_condition_ids",
            ],
            message: "Semantic labels cannot match Code Quality conditions",
          });
        }
      }
    }
  });

const dateTimeSchema = z
  .string()
  .refine(
    (value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value,
    "timestamp must be canonical ISO-8601",
  );

export const judgeRunDescriptorSchema = z.strictObject({
  schema_version: z.literal(1),
  run_id: idSchema,
  judge_kind: z.enum(["semantic", "code_quality"]),
  repeat_index: z.number().int().min(1).max(3),
  contract: phase3cArtifactPointerSchema,
  prompt: phase3cArtifactPointerSchema,
  input_manifest: phase3cArtifactPointerSchema,
  output_schema: phase3cArtifactPointerSchema,
  model_route: modelRouteSchema,
  profile: z.literal("eval-clowder-runner"),
  tool_policy: z.literal("none"),
  permission_mode: z.literal("read-only"),
  started_at: dateTimeSchema,
});

export const judgeRunReceiptSchema = z
  .strictObject({
    schema_version: z.literal(1),
    run_id: idSchema,
    judge_kind: z.enum(["semantic", "code_quality"]),
    session_id: idSchema,
    session_transcript_sha256: phase3cSha256Schema,
    descriptor: phase3cArtifactPointerSchema,
    output: phase3cArtifactPointerSchema.nullable(),
    ended_at: dateTimeSchema,
    exit_code: z.number().int().nullable(),
    signal: z.string().min(1).max(64).nullable(),
    timed_out: z.boolean(),
    output_limit_exceeded: z.boolean(),
    stdout_sha256: phase3cSha256Schema,
    stderr_sha256: phase3cSha256Schema,
    model_route_sha256: phase3cSha256Schema,
    protocol_status: z.enum(["valid", "invalid"]),
    diagnostic_codes: unique(idSchema),
  })
  .superRefine((value, context) => {
    const terminalFailure =
      value.exit_code !== 0 ||
      value.signal !== null ||
      value.timed_out ||
      value.output_limit_exceeded;
    if ((value.protocol_status === "valid") !== (!terminalFailure && value.output !== null)) {
      context.addIssue({
        code: "custom",
        path: ["protocol_status"],
        message: "Judge protocol status disagrees with terminal evidence",
      });
    }
  });
export const judgeFreezeReceiptSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_kind: z.enum(["semantic", "code_quality"]),
  judge_definition_sha256: phase3cSha256Schema,
  rubric_sha256: phase3cSha256Schema,
  prompt_sha256: phase3cSha256Schema,
  model_route_sha256: phase3cSha256Schema,
  output_schema_sha256: phase3cSha256Schema,
  development_set_sha256: phase3cSha256Schema,
  locked_admission_inputs_sha256: phase3cSha256Schema,
  locked_bias_inputs_sha256: phase3cSha256Schema,
  frozen_at: dateTimeSchema,
});
export const judgeExecutionManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_kind: z.enum(["semantic", "code_quality"]),
  set_kind: z.enum(["locked_admission", "locked_bias"]),
  freeze_receipt_sha256: phase3cSha256Schema,
  judge_definition_sha256: phase3cSha256Schema,
  input_set_sha256: phase3cSha256Schema,
  repeats_per_case: z.literal(3),
  created_at: dateTimeSchema,
});
export const judgeLabelsUnsealReceiptSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_kind: z.enum(["semantic", "code_quality"]),
  freeze_receipt_sha256: phase3cSha256Schema,
  locked_admission_execution_sha256: phase3cSha256Schema,
  locked_bias_execution_sha256: phase3cSha256Schema,
  locked_admission_labels_sha256: phase3cSha256Schema,
  locked_bias_labels_sha256: phase3cSha256Schema,
  unsealed_at: dateTimeSchema,
});

const admissionCaseResultSchema = z.strictObject({
  case_id: idSchema,
  repeat_results: z.tuple([
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
    phase3cArtifactPointerSchema,
  ]),
  observed_dimensions: z.array(expectedDimensionSchema).min(1),
  expected_dimensions_sha256: phase3cSha256Schema,
  match: z.enum(["pass", "fail"]),
});
const admissionBiasResultSchema = admissionCaseResultSchema.extend({
  canonical_case_id: idSchema,
  transform_id: idSchema,
});
export const judgeAdmissionSchema = z.strictObject({
  schema_version: z.literal(1),
  judge_kind: z.enum(["semantic", "code_quality"]),
  judge_definition_sha256: phase3cSha256Schema,
  freeze_receipt_sha256: phase3cSha256Schema,
  locked_admission_execution_sha256: phase3cSha256Schema,
  locked_bias_execution_sha256: phase3cSha256Schema,
  locked_admission_labels_sha256: phase3cSha256Schema,
  locked_bias_labels_sha256: phase3cSha256Schema,
  labels_unseal_receipt_sha256: phase3cSha256Schema,
  run_receipts: z.array(phase3cArtifactPointerSchema),
  case_results: z.array(admissionCaseResultSchema).min(1),
  bias_results: z.array(admissionBiasResultSchema).min(1),
  status: z.enum(["admitted", "rejected"]),
});

export const HARNESS_BUCKETS = ["TDD-suitable", "borderline", "non-trigger", "holdout"] as const;
export const HARNESS_EVENTS = [
  "skill_loaded",
  "first_test_write",
  "first_production_write",
  "focused_red",
  "focused_green",
  "full_suite_green",
  "refactor_after_green",
] as const;
export const COST_METRICS = [
  "elapsed_ms",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "failed_tool_calls",
] as const;
const costMetricSchema = z.enum(COST_METRICS);
const costRuleSchema = z
  .strictObject({
    metric_id: costMetricSchema,
    unit: z.enum(["milliseconds", "tokens", "calls"]),
    direction: z.literal("lower_is_better"),
    tolerance: z.number().finite().int().nonnegative(),
    budget: z.strictObject({
      kind: z.enum(["maximum", "none"]),
      value: z.number().finite().int().nonnegative().nullable(),
    }),
    missing_or_null: z.enum(["insufficient", "invalid"]),
  })
  .superRefine((value, context) => {
    const unit =
      value.metric_id === "elapsed_ms"
        ? "milliseconds"
        : value.metric_id === "failed_tool_calls"
          ? "calls"
          : "tokens";
    if (value.unit !== unit)
      context.addIssue({ code: "custom", path: ["unit"], message: "metric unit mismatch" });
    if ((value.budget.kind === "none") !== (value.budget.value === null)) {
      context.addIssue({
        code: "custom",
        path: ["budget"],
        message: "budget kind and value disagree",
      });
    }
  });

export const harnessEffectContractSchema = z
  .strictObject({
    schema_version: z.literal(1),
    contract_id: z.literal("tdd-skill-harness-effect-v1"),
    harness_binding_sha256: phase3cSha256Schema,
    task_registry_sha256: phase3cSha256Schema,
    opportunity_rules: z.array(
      z.strictObject({
        bucket: z.enum(HARNESS_BUCKETS),
        expected_opportunity: z.enum(["eligible", "ineligible", "unknown"]),
      }),
    ),
    activation: z.strictObject({
      source_schema_sha256: phase3cSha256Schema,
      event_ids: z.tuple(
        HARNESS_EVENTS.map((event) => z.literal(event)) as [
          z.ZodLiteral<(typeof HARNESS_EVENTS)[number]>,
          ...z.ZodLiteral<(typeof HARNESS_EVENTS)[number]>[],
        ],
      ),
      dependency_escape_event_id: z.literal("codebase_design_requested"),
    }),
    quality_partial_order: z.strictObject({
      delivery: z.tuple([z.literal("fail"), z.literal("pass")]),
      semantic: z.tuple([z.literal("fail"), z.literal("pass")]),
      code_quality: z.tuple([z.literal("fail"), z.literal("concern"), z.literal("pass")]),
    }),
    cost: z.strictObject({ rules: z.array(costRuleSchema) }),
    claim_strength_rules: z.strictObject({
      single_pair: z.literal("descriptive"),
      repeated_known_tasks: z.literal("diagnostic"),
      holdout_minimum: z.number().finite().int().positive(),
      effect_eligible_minimum: z.number().finite().int().positive(),
    }),
  })
  .superRefine((value, context) => {
    if (
      canonicalJson(value.opportunity_rules.map((rule) => rule.bucket)) !==
      canonicalJson(HARNESS_BUCKETS)
    ) {
      context.addIssue({
        code: "custom",
        path: ["opportunity_rules"],
        message: "opportunity rules must be complete and canonical",
      });
    }
    if (
      canonicalJson(value.cost.rules.map((rule) => rule.metric_id)) !== canonicalJson(COST_METRICS)
    ) {
      context.addIssue({
        code: "custom",
        path: ["cost", "rules"],
        message: "cost rules must be complete and canonical",
      });
    }
    if (
      value.claim_strength_rules.effect_eligible_minimum <
      value.claim_strength_rules.holdout_minimum
    ) {
      context.addIssue({
        code: "custom",
        path: ["claim_strength_rules"],
        message: "effect eligibility cannot require fewer Episodes than holdout",
      });
    }
  });

const diagnosticSchema = z.strictObject({
  code: idSchema,
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  evidence_refs: z.array(z.string()),
});
const validitySchema = z.enum(["valid", "insufficient", "invalid"]);
const costDeltaSchema = z.strictObject(
  Object.fromEntries(
    COST_METRICS.map((metric) => [metric, z.number().finite().int().nullable()]),
  ) as Record<(typeof COST_METRICS)[number], z.ZodNullable<z.ZodNumber>>,
);
export const phase3cDeliveryReportSchema = z
  .strictObject({
    schema_version: z.literal(3),
    evaluation_id: idSchema,
    source: z.strictObject({
      observation_boundary: phase3cArtifactPointerSchema,
      deterministic_observations: phase3cArtifactPointerSchema,
      semantic_judge_contract: phase3cArtifactPointerSchema,
      semantic_judge_admission: phase3cArtifactPointerSchema,
      semantic_judge: phase3cArtifactPointerSchema,
      code_quality_judge_contract: phase3cArtifactPointerSchema,
      code_quality_judge_admission: phase3cArtifactPointerSchema,
      code_quality_judge: phase3cArtifactPointerSchema,
      tdd_skill_binding: phase3cArtifactPointerSchema,
      task_registry: phase3cArtifactPointerSchema,
      harness_effect_contract: phase3cArtifactPointerSchema,
    }),
    measurement_validity: z.strictObject({
      candidate_verdict: validitySchema,
      harness_effect: validitySchema,
      deterministic: z.enum(["valid", "invalid"]),
      semantic_judge: validitySchema,
      code_quality_judge: validitySchema,
      harness_mechanism: validitySchema,
      cost: validitySchema,
      reasons: z.array(diagnosticSchema),
    }),
    verdict: z.enum(["accept", "reject", "inconclusive"]),
    axes: z.strictObject({
      delivery: z.strictObject({
        status: z.enum(["pass", "fail", "error"]),
        requirement_delta: z.array(deterministicObservationEntrySchema),
        domain_preservation: z.array(deterministicObservationEntrySchema),
      }),
      semantic: z.strictObject({
        status: z.enum(["pass", "fail", "abstain", "not_required", "error"]),
        required: z.boolean(),
        dimensions: z.array(semanticJudgeDimensionSchema),
      }),
      code_quality: z.strictObject({
        status: z.enum(["pass", "concern", "fail", "abstain", "error"]),
        dimensions: z.array(codeQualityJudgeDimensionSchema),
      }),
      harness_effect: z.strictObject({
        contract_sha256: phase3cSha256Schema,
        status: z.enum([
          "improvement_observed",
          "harm_observed",
          "mixed",
          "no_observed_difference",
          "not_activated",
          "inconclusive",
        ]),
        opportunity: z.enum(["eligible", "ineligible", "unknown"]),
        activation: z.enum(["activated", "not_activated", "unknown"]),
        changed_delivery_claims: unique(idSchema),
        changed_semantic_dimensions: unique(semanticDimensionSchema),
        changed_code_quality_dimensions: unique(codeQualityDimensionSchema),
        cost_delta: costDeltaSchema,
        claim_strength: z.enum(["descriptive", "diagnostic", "effect_eligible"]),
      }),
    }),
    traceability: z.strictObject({
      claim_to_dimensions: z.record(idSchema, unique(dimensionSchema)),
      dimension_to_claims: z.partialRecord(dimensionSchema, unique(idSchema)),
    }),
  })
  .superRefine((value, context) => {
    const combineValidity = (values: readonly ("valid" | "insufficient" | "invalid")[]) =>
      values.includes("invalid")
        ? "invalid"
        : values.includes("insufficient")
          ? "insufficient"
          : "valid";
    const candidateValidity = combineValidity([
      value.measurement_validity.deterministic,
      value.measurement_validity.semantic_judge,
      value.measurement_validity.code_quality_judge,
    ]);
    const harnessValidity = combineValidity([
      value.measurement_validity.harness_mechanism,
      value.measurement_validity.cost,
    ]);
    if (
      value.measurement_validity.candidate_verdict !== candidateValidity ||
      value.measurement_validity.harness_effect !== harnessValidity
    ) {
      context.addIssue({
        code: "custom",
        path: ["measurement_validity"],
        message: "measurement validity envelope is not mechanically derived",
      });
    }
    if (
      value.axes.delivery.requirement_delta.some((entry) => entry.axis !== "requirement_delta") ||
      value.axes.delivery.domain_preservation.some((entry) => entry.axis !== "domain_preservation")
    ) {
      context.addIssue({
        code: "custom",
        path: ["axes", "delivery"],
        message: "Delivery observations are filed under the wrong axis",
      });
    }
    const deliveryObservations = [
      ...value.axes.delivery.requirement_delta,
      ...value.axes.delivery.domain_preservation,
    ];
    const deliveryStatus = deliveryObservations.some((entry) => entry.status === "error")
      ? "error"
      : deliveryObservations.some((entry) => entry.status === "fail")
        ? "fail"
        : "pass";
    const semanticStatus =
      value.measurement_validity.semantic_judge === "invalid" ||
      (value.axes.semantic.required && value.axes.semantic.dimensions.length === 0)
        ? "error"
        : !value.axes.semantic.required
          ? "not_required"
          : value.axes.semantic.dimensions.some((entry) => entry.verdict === "abstain")
            ? "abstain"
            : value.axes.semantic.dimensions.some((entry) => entry.verdict === "fail")
              ? "fail"
              : "pass";
    const codeQualityStatus =
      value.measurement_validity.code_quality_judge === "invalid" ||
      value.axes.code_quality.dimensions.length === 0
        ? "error"
        : value.axes.code_quality.dimensions.some((entry) => entry.verdict === "abstain")
          ? "abstain"
          : value.axes.code_quality.dimensions.some(
                (entry) => entry.verdict === "fail" && entry.severity === "blocking",
              )
            ? "fail"
            : value.axes.code_quality.dimensions.some(
                  (entry) => entry.verdict === "fail" && entry.severity === "concern",
                )
              ? "concern"
              : "pass";
    if (
      value.axes.delivery.status !== deliveryStatus ||
      value.axes.semantic.status !== semanticStatus ||
      value.axes.code_quality.status !== codeQualityStatus
    ) {
      context.addIssue({
        code: "custom",
        path: ["axes"],
        message: "axis statuses are not mechanically derived",
      });
    }
    const expectedVerdict =
      candidateValidity !== "valid" ||
      deliveryStatus === "error" ||
      semanticStatus === "abstain" ||
      semanticStatus === "error" ||
      codeQualityStatus === "abstain" ||
      codeQualityStatus === "error"
        ? "inconclusive"
        : deliveryStatus === "fail" || semanticStatus === "fail" || codeQualityStatus === "fail"
          ? "reject"
          : "accept";
    if (value.verdict !== expectedVerdict) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "overall verdict is not mechanically derived",
      });
    }
  });

export const phase3cReplayManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  template_id: z.literal("commerce-order-cancellation-v3"),
  public_observation_catalog: phase3cArtifactPointerSchema,
  observation_authority_map: phase3cArtifactPointerSchema,
  observation_boundary: phase3cArtifactPointerSchema,
  deterministic_observations: phase3cArtifactPointerSchema,
  semantic_judge_contract: phase3cArtifactPointerSchema,
  semantic_judge_admission: phase3cArtifactPointerSchema,
  semantic_judge_result: phase3cArtifactPointerSchema,
  code_quality_judge_contract: phase3cArtifactPointerSchema,
  code_quality_judge_admission: phase3cArtifactPointerSchema,
  code_quality_judge_result: phase3cArtifactPointerSchema,
  tdd_skill_binding: phase3cArtifactPointerSchema,
  task_registry: phase3cArtifactPointerSchema,
  harness_effect_contract: phase3cArtifactPointerSchema,
  delivery_report: phase3cArtifactPointerSchema,
});

const domainValueSchema = z.strictObject({
  domain_id: scalarDomainSchema,
  scalar: scalarSchema,
});
const effectValueSchema = z.strictObject({ field_id: effectFieldSchema, value: scalarSchema });
export const domainObservationNormalFormSchema = z
  .strictObject({
    schema_version: z.literal(1),
    operation: z.strictObject({ status: z.enum(["accepted", "rejected", "unavailable"]) }),
    state: z.array(z.strictObject({ field_id: stateFieldSchema, value: domainValueSchema })),
    effects: z.array(
      z.strictObject({
        effect_id: effectSchema,
        identity: z.array(effectValueSchema),
        attributes: z.array(effectValueSchema),
      }),
    ),
    relations: z.array(z.strictObject({ relation_id: relationSchema, status: z.boolean() })),
  })
  .superRefine((value, context) => {
    if (new Set(value.state.map((entry) => entry.field_id)).size !== value.state.length) {
      context.addIssue({ code: "custom", path: ["state"], message: "state fields must be unique" });
    }
    for (const [index, entry] of value.state.entries()) {
      const domain = STATE_FIELD_DOMAIN[entry.field_id];
      if (entry.value.domain_id !== domain || !validScalar(domain, entry.value.scalar)) {
        context.addIssue({
          code: "custom",
          path: ["state", index, "value"],
          message: "state value domain mismatch",
        });
      }
    }
    for (const [index, effect] of value.effects.entries()) {
      const shape = EFFECT_FIELDS[effect.effect_id];
      if (
        canonicalJson(effect.identity.map((field) => field.field_id)) !==
          canonicalJson(shape.identity) ||
        canonicalJson(effect.attributes.map((field) => field.field_id)) !==
          canonicalJson(shape.attributes)
      ) {
        context.addIssue({
          code: "custom",
          path: ["effects", index],
          message: "effect shape mismatch",
        });
      }
      for (const [fieldIndex, field] of [...effect.identity, ...effect.attributes].entries()) {
        const domain = EFFECT_FIELD_DOMAIN[field.field_id];
        if (!validScalar(domain, field.value)) {
          context.addIssue({
            code: "custom",
            path: ["effects", index, fieldIndex],
            message: "effect value domain mismatch",
          });
        }
      }
    }
    if (
      new Set(value.relations.map((entry) => entry.relation_id)).size !== value.relations.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["relations"],
        message: "relations must be unique",
      });
    }
  });

export type PublicObservationCatalog = typeof PHASE3C_PUBLIC_OBSERVATION_CATALOG;
export type Phase3cArtifactPointer = z.infer<typeof phase3cArtifactPointerSchema>;
export type ObservationAuthorityMap = z.infer<typeof observationAuthorityMapSchema>;
export type ObservationBoundarySpec = z.infer<typeof observationBoundarySpecSchema>;
export type DeterministicObservationEntry = z.infer<typeof deterministicObservationEntrySchema>;
export type DeterministicObservationResult = z.infer<typeof deterministicObservationResultSchema>;
export type ObservationBoundaryAdmission = z.infer<typeof observationBoundaryAdmissionSchema>;
export type SemanticJudgeContract = z.infer<typeof semanticJudgeContractSchema>;
export type CodeQualityJudgeContract = z.infer<typeof codeQualityJudgeContractSchema>;
export type JudgeInputManifest = z.infer<typeof judgeInputManifestSchema>;
export type SemanticJudgeInputManifest = z.infer<typeof semanticJudgeInputManifestSchema>;
export type CodeQualityJudgeInputManifest = z.infer<typeof codeQualityJudgeInputManifestSchema>;
export type JudgeRunDescriptor = z.infer<typeof judgeRunDescriptorSchema>;
export type JudgeRunReceipt = z.infer<typeof judgeRunReceiptSchema>;
export type JudgeCaseInputSet = z.infer<typeof judgeCaseInputSetSchema>;
export type JudgeLabelSet = z.infer<typeof judgeLabelSetSchema>;
export type JudgeFreezeReceipt = z.infer<typeof judgeFreezeReceiptSchema>;
export type JudgeExecutionManifest = z.infer<typeof judgeExecutionManifestSchema>;
export type JudgeLabelsUnsealReceipt = z.infer<typeof judgeLabelsUnsealReceiptSchema>;
export type JudgeAdmission = z.infer<typeof judgeAdmissionSchema>;
export type SemanticJudgeRunResult = z.infer<typeof semanticJudgeRunResultSchema>;
export type CodeQualityJudgeRunResult = z.infer<typeof codeQualityJudgeRunResultSchema>;
export type SemanticJudgeResult = z.infer<typeof semanticJudgeResultSchema>;
export type CodeQualityJudgeResult = z.infer<typeof codeQualityJudgeResultSchema>;
export type HarnessEffectContract = z.infer<typeof harnessEffectContractSchema>;
export type Phase3cDeliveryReport = z.infer<typeof phase3cDeliveryReportSchema>;
export type Phase3cReplayManifest = z.infer<typeof phase3cReplayManifestSchema>;
export type DomainObservationNormalForm = z.infer<typeof domainObservationNormalFormSchema>;

export const parsePublicObservationCatalog = (value: unknown): PublicObservationCatalog =>
  publicObservationCatalogSchema.parse(value);
export const parseObservationAuthorityMap = (value: unknown): ObservationAuthorityMap =>
  observationAuthorityMapSchema.parse(value);
export const parseObservationBoundarySpec = (value: unknown): ObservationBoundarySpec =>
  observationBoundarySpecSchema.parse(value);
export const parseDeterministicObservationResult = (
  value: unknown,
): DeterministicObservationResult => deterministicObservationResultSchema.parse(value);
export const parseObservationBoundaryAdmission = (value: unknown): ObservationBoundaryAdmission =>
  observationBoundaryAdmissionSchema.parse(value);
export const parseSemanticJudgeContract = (value: unknown): SemanticJudgeContract =>
  semanticJudgeContractSchema.parse(value);
export const parseCodeQualityJudgeContract = (value: unknown): CodeQualityJudgeContract =>
  codeQualityJudgeContractSchema.parse(value);
export const parseJudgeInputManifest = (value: unknown): JudgeInputManifest =>
  judgeInputManifestSchema.parse(value);
export const parseJudgeRunDescriptor = (value: unknown): JudgeRunDescriptor =>
  judgeRunDescriptorSchema.parse(value);
export const parseJudgeRunReceipt = (value: unknown): JudgeRunReceipt =>
  judgeRunReceiptSchema.parse(value);
export const parseJudgeCaseInputSet = (value: unknown): JudgeCaseInputSet =>
  judgeCaseInputSetSchema.parse(value);
export const parseJudgeLabelSet = (value: unknown): JudgeLabelSet =>
  judgeLabelSetSchema.parse(value);
export const parseJudgeFreezeReceipt = (value: unknown): JudgeFreezeReceipt =>
  judgeFreezeReceiptSchema.parse(value);
export const parseJudgeExecutionManifest = (value: unknown): JudgeExecutionManifest =>
  judgeExecutionManifestSchema.parse(value);
export const parseJudgeLabelsUnsealReceipt = (value: unknown): JudgeLabelsUnsealReceipt =>
  judgeLabelsUnsealReceiptSchema.parse(value);
export const parseJudgeAdmission = (value: unknown): JudgeAdmission =>
  judgeAdmissionSchema.parse(value);
export const parseSemanticJudgeRunResult = (value: unknown): SemanticJudgeRunResult =>
  semanticJudgeRunResultSchema.parse(value);
export const parseCodeQualityJudgeRunResult = (value: unknown): CodeQualityJudgeRunResult =>
  codeQualityJudgeRunResultSchema.parse(value);
export const parseSemanticJudgeResult = (value: unknown): SemanticJudgeResult =>
  semanticJudgeResultSchema.parse(value);
export const parseCodeQualityJudgeResult = (value: unknown): CodeQualityJudgeResult =>
  codeQualityJudgeResultSchema.parse(value);
export const parseHarnessEffectContract = (value: unknown): HarnessEffectContract =>
  harnessEffectContractSchema.parse(value);
export const parsePhase3cDeliveryReport = (value: unknown): Phase3cDeliveryReport =>
  phase3cDeliveryReportSchema.parse(value);
export const parsePhase3cReplayManifest = (value: unknown): Phase3cReplayManifest =>
  phase3cReplayManifestSchema.parse(value);
export const parseDomainObservationNormalForm = (value: unknown): DomainObservationNormalForm =>
  domainObservationNormalFormSchema.parse(value);
