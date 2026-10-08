import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  PHASE3C_DIMENSIONS,
  PHASE3C_PUBLIC_OBSERVATION_CATALOG,
  parseCodeQualityJudgeContract,
  parseHarnessEffectContract,
  parseJudgeCaseInputSet,
  parseJudgeLabelSet,
  parseObservationAuthorityMap,
  parseObservationBoundarySpec,
  parsePhase3cDeliveryReport,
  parsePublicObservationCatalog,
  parseSemanticJudgeContract,
} from "../../src/phase3c/index.js";

const sha = (value: string) => value.repeat(64);
const pointer = (name: string, digest = sha("a")) => ({
  ref: `artifact://campaign/phase3c/${name}.json`,
  sha256: digest,
});

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`fixture value is missing at ${index}`);
  return value;
}

const authorityMap = {
  schema_version: 1,
  catalog_sha256: canonicalJsonDigest(PHASE3C_PUBLIC_OBSERVATION_CATALOG),
  claim_ir_sha256: sha("b"),
  dimensions: PHASE3C_DIMENSIONS.map((dimensionId, index) => ({
    dimension_id: dimensionId,
    disposition: index < 2 ? ("deterministic" as const) : ("out_of_scope" as const),
    claim_ids: index < 2 ? ["claim-order"] : [],
    authority_refs: [pointer(`authority-${index}`)],
  })),
};

const boundary = {
  schema_version: 3,
  boundary_id: "commerce-order-observation-boundary-v3",
  template_id: "commerce-order-cancellation-v3",
  source: {
    domain_manifest: pointer("domain"),
    requirement: pointer("requirement"),
    claim_ir: pointer("claim-ir", authorityMap.claim_ir_sha256),
    task_pack: pointer("task-pack"),
  },
  public_surface_sha256: sha("c"),
  public_observation_catalog_sha256: authorityMap.catalog_sha256,
  authority_map_sha256: canonicalJsonDigest(authorityMap),
  bindings: [
    {
      observation_id: "order-outcome-and-state",
      claim_id: "claim-order",
      axis: "requirement_delta",
      dimension_ids: ["create_order_outcome", "order_status_state"],
      stimulus_id: "paid_order",
      expression: {
        type: "all_of",
        children: [
          {
            type: "operation_status_is",
            operation_id: "create_order",
            expected_status: "accepted",
          },
          {
            type: "state_field_compare",
            slot: "after",
            field_id: "order_status",
            comparator: "equals",
            expected_values: [
              { type: "scalar_literal", domain_id: "order_status_enum", value: "paid" },
            ],
          },
        ],
      },
    },
  ],
  normal_form_version: "domain-observation-normal-form-v1",
  runner_sha256: sha("d"),
};

const semanticContract = {
  schema_version: 1,
  judge_contract_id: "phase3c-semantic-judge-v1",
  dimensions: [
    {
      dimension_id: "requirement_intent_alignment",
      applicability: "required",
      decision_rule: "The implementation fulfills the residual requirement intent.",
      blocking: true,
      required_evidence: ["requirement_ref", "domain_ref", "code_location"],
    },
  ],
  model_route: { provider: "openai-codex", model: "gpt-5.6-sol", reasoning_effort: "xhigh" },
  prompt_sha256: sha("e"),
  output_schema_sha256: sha("f"),
  calibration_admission_sha256: sha("1"),
  repeats_per_evaluation: 3,
};

const codeQualityContract = {
  schema_version: 1,
  rubric_id: "phase3c-code-quality-v1",
  dimensions: [
    {
      dimension_id: "change_scope_discipline",
      applicability: "required",
      decision_rule: "The diff remains within the requirement scope.",
      required_evidence: ["code_location", "base_or_diff_ref"],
      conditions: [
        {
          condition_id: "scope-unrelated-production-change",
          level: "blocking",
          statement: "The Candidate changes production behavior unrelated to the Requirement.",
          applicability: "when unrelated production paths changed",
          required_evidence: ["code_location", "base_or_diff_ref"],
        },
      ],
    },
  ],
  model_route: semanticContract.model_route,
  prompt_sha256: sha("2"),
  output_schema_sha256: sha("3"),
  calibration_admission_sha256: sha("4"),
  repeats_per_evaluation: 3,
};

const harnessEffectContract = {
  schema_version: 1,
  contract_id: "tdd-skill-harness-effect-v1",
  harness_binding_sha256: sha("5"),
  task_registry_sha256: sha("6"),
  opportunity_rules: [
    { bucket: "TDD-suitable", expected_opportunity: "eligible" },
    { bucket: "borderline", expected_opportunity: "unknown" },
    { bucket: "non-trigger", expected_opportunity: "ineligible" },
    { bucket: "holdout", expected_opportunity: "unknown" },
  ],
  activation: {
    source_schema_sha256: sha("7"),
    event_ids: [
      "skill_loaded",
      "first_test_write",
      "first_production_write",
      "focused_red",
      "focused_green",
      "full_suite_green",
      "refactor_after_green",
    ],
    dependency_escape_event_id: "codebase_design_requested",
  },
  quality_partial_order: {
    delivery: ["fail", "pass"],
    semantic: ["fail", "pass"],
    code_quality: ["fail", "concern", "pass"],
  },
  cost: {
    rules: [
      ["elapsed_ms", "milliseconds"],
      ["input_tokens", "tokens"],
      ["cached_input_tokens", "tokens"],
      ["output_tokens", "tokens"],
      ["failed_tool_calls", "calls"],
    ].map(([metricId, unit]) => ({
      metric_id: metricId,
      unit,
      direction: "lower_is_better",
      tolerance: 0,
      budget: { kind: "none", value: null },
      missing_or_null: "insufficient",
    })),
  },
  claim_strength_rules: {
    single_pair: "descriptive",
    repeated_known_tasks: "diagnostic",
    holdout_minimum: 2,
    effect_eligible_minimum: 6,
  },
};

test("Phase 3C strict parsers accept one complete contract family", () => {
  assert.deepEqual(
    parsePublicObservationCatalog(PHASE3C_PUBLIC_OBSERVATION_CATALOG),
    PHASE3C_PUBLIC_OBSERVATION_CATALOG,
  );
  assert.deepEqual(parseObservationAuthorityMap(authorityMap), authorityMap);
  assert.deepEqual(parseObservationBoundarySpec(boundary), boundary);
  assert.deepEqual(parseSemanticJudgeContract(semanticContract), semanticContract);
  assert.deepEqual(parseCodeQualityJudgeContract(codeQualityContract), codeQualityContract);
  assert.deepEqual(parseHarnessEffectContract(harnessEffectContract), harnessEffectContract);
});

test("Authority Map is total and Boundary expressions are closed", () => {
  assert.throws(
    () =>
      parseObservationAuthorityMap({
        ...authorityMap,
        dimensions: authorityMap.dimensions.slice(1),
      }),
    /dimension/i,
  );
  const bad = structuredClone(boundary) as unknown as {
    bindings: Array<{ expression: { children: Array<Record<string, unknown>> } }>;
  };
  requiredAt(requiredAt(bad.bindings, 0).expression.children, 0).reason =
    "carrier_handoff_committed";
  assert.throws(() => parseObservationBoundarySpec(bad), /unrecognized|unknown/i);
  const badValue = structuredClone(boundary) as unknown as {
    bindings: Array<{
      expression: { children: Array<{ expected_values: Array<{ value: unknown }> }> };
    }>;
  };
  requiredAt(
    requiredAt(requiredAt(badValue.bindings, 0).expression.children, 1).expected_values,
    0,
  ).value = { raw: "paid" };
  assert.throws(() => parseObservationBoundarySpec(badValue));
});

test("Judge case inputs exclude Judge configuration and labels are dimension-exact", () => {
  const inputSet = {
    schema_version: 1,
    set_id: "semantic-locked-admission-v1",
    judge_kind: "semantic",
    set_kind: "locked_admission",
    cases: [
      {
        case_id: "semantic-pass",
        input_closure_sha256: sha("8"),
        risk_class: "critical",
        canonical_case_id: null,
        transform_id: null,
      },
    ],
  };
  assert.deepEqual(parseJudgeCaseInputSet(inputSet), inputSet);
  assert.throws(() => parseJudgeCaseInputSet({ ...inputSet, prompt_sha256: sha("9") }));

  const labelSet = {
    schema_version: 1,
    judge_kind: "semantic",
    set_kind: "locked_admission",
    input_set_sha256: canonicalJsonDigest(inputSet),
    labels: [
      {
        case_id: "semantic-pass",
        human_labels: [pointer("label-a"), pointer("label-b")],
        adjudication: pointer("adjudication"),
        expected_dimensions: [
          {
            dimension_id: "requirement_intent_alignment",
            applicability: "applicable",
            verdict: "pass",
            severity: "none",
            matched_condition_ids: [],
            abstention_reason: null,
          },
        ],
      },
    ],
  };
  assert.deepEqual(parseJudgeLabelSet(labelSet), labelSet);
  const bad = structuredClone(labelSet) as unknown as {
    labels: Array<{ expected_dimensions: Array<{ abstention_reason: unknown }> }>;
  };
  requiredAt(requiredAt(bad.labels, 0).expected_dimensions, 0).abstention_reason = "anything";
  assert.throws(() => parseJudgeLabelSet(bad));
});

test("Harness cost rules and report validity remain typed and separated", () => {
  assert.throws(() =>
    parseHarnessEffectContract({
      ...harnessEffectContract,
      cost: { rules: [{ ...harnessEffectContract.cost.rules[0], tolerance: -1 }] },
    }),
  );

  const report = {
    schema_version: 3,
    evaluation_id: "phase3c-evaluation-1",
    source: {
      observation_boundary: pointer("boundary"),
      deterministic_observations: pointer("deterministic"),
      semantic_judge_contract: pointer("semantic-contract"),
      semantic_judge_admission: pointer("semantic-admission"),
      semantic_judge: pointer("semantic"),
      code_quality_judge_contract: pointer("quality-contract"),
      code_quality_judge_admission: pointer("quality-admission"),
      code_quality_judge: pointer("quality"),
      tdd_skill_binding: pointer("tdd-binding"),
      task_registry: pointer("task-registry"),
      harness_effect_contract: pointer("harness-effect"),
    },
    measurement_validity: {
      candidate_verdict: "valid",
      harness_effect: "insufficient",
      deterministic: "valid",
      semantic_judge: "valid",
      code_quality_judge: "valid",
      harness_mechanism: "insufficient",
      cost: "valid",
      reasons: [],
    },
    verdict: "accept",
    axes: {
      delivery: { status: "pass", requirement_delta: [], domain_preservation: [] },
      semantic: { status: "not_required", required: false, dimensions: [] },
      code_quality: {
        status: "pass",
        dimensions: [
          {
            dimension_id: "change_scope_discipline",
            applicability: "applicable",
            verdict: "pass",
            severity: "none",
            matched_condition_ids: [],
            evidence: [
              {
                source_ref: "artifact://campaign/candidate/diff.patch",
                locator: "src/order.ts:1",
              },
            ],
            rationale: "The synthetic diff stays in scope.",
            counterevidence: null,
            abstention_reason: null,
          },
        ],
      },
      harness_effect: {
        contract_sha256: sha("5"),
        status: "inconclusive",
        opportunity: "eligible",
        activation: "unknown",
        changed_delivery_claims: [],
        changed_semantic_dimensions: [],
        changed_code_quality_dimensions: [],
        cost_delta: {
          elapsed_ms: null,
          input_tokens: null,
          cached_input_tokens: null,
          output_tokens: null,
          failed_tool_calls: null,
        },
        claim_strength: "descriptive",
      },
    },
    traceability: { claim_to_dimensions: {}, dimension_to_claims: {} },
  };
  assert.deepEqual(parsePhase3cDeliveryReport(report), report);
});
