import assert from "node:assert/strict";
import test from "node:test";

import { buildPhase3cDeliveryReport, projectHarnessEffect } from "../../src/phase3c/index.js";

const sha = (value: string) => value.repeat(64);
const pointer = (name: string) => ({
  ref: `artifact://campaign/phase3c/${name}.json`,
  sha256: sha("a"),
});

const contract = {
  schema_version: 1 as const,
  contract_id: "tdd-skill-harness-effect-v1" as const,
  harness_binding_sha256: sha("1"),
  task_registry_sha256: sha("2"),
  opportunity_rules: [
    { bucket: "TDD-suitable" as const, expected_opportunity: "eligible" as const },
    { bucket: "borderline" as const, expected_opportunity: "unknown" as const },
    { bucket: "non-trigger" as const, expected_opportunity: "ineligible" as const },
    { bucket: "holdout" as const, expected_opportunity: "unknown" as const },
  ],
  activation: {
    source_schema_sha256: sha("3"),
    event_ids: [
      "skill_loaded",
      "first_test_write",
      "first_production_write",
      "focused_red",
      "focused_green",
      "full_suite_green",
      "refactor_after_green",
    ] as const,
    dependency_escape_event_id: "codebase_design_requested" as const,
  },
  quality_partial_order: {
    delivery: ["fail", "pass"] as const,
    semantic: ["fail", "pass"] as const,
    code_quality: ["fail", "concern", "pass"] as const,
  },
  cost: {
    rules: [
      ["elapsed_ms", "milliseconds", 50],
      ["input_tokens", "tokens", 10],
      ["cached_input_tokens", "tokens", 10],
      ["output_tokens", "tokens", 10],
      ["failed_tool_calls", "calls", 0],
    ].map(([metricId, unit, tolerance]) => ({
      metric_id: metricId,
      unit,
      direction: "lower_is_better" as const,
      tolerance,
      budget: { kind: "none" as const, value: null },
      missing_or_null: "insufficient" as const,
    })),
  },
  claim_strength_rules: {
    single_pair: "descriptive" as const,
    repeated_known_tasks: "diagnostic" as const,
    holdout_minimum: 2,
    effect_eligible_minimum: 6,
  },
};

const cost = {
  elapsed_ms: 1_000,
  input_tokens: 100,
  cached_input_tokens: 0,
  output_tokens: 50,
  failed_tool_calls: 0,
};

test("Harness Effect projects improvement, no activation, and mixed tradeoffs", () => {
  const improved = projectHarnessEffect({
    contract,
    bucket: "TDD-suitable",
    activation: "activated",
    validity: { mechanism: "valid", cost: "valid" },
    control: { delivery: "fail", semantic: "pass", codeQuality: "concern", cost },
    treatment: { delivery: "pass", semantic: "pass", codeQuality: "pass", cost },
    repeatedKnownTasks: 1,
    holdoutTasks: 0,
  });
  assert.equal(improved.status, "improvement_observed");
  assert.equal(improved.claimStrength, "descriptive");

  const qualityImprovedWithToleratedCost = projectHarnessEffect({
    contract,
    bucket: "TDD-suitable",
    activation: "activated",
    validity: { mechanism: "valid", cost: "valid" },
    control: { delivery: "fail", semantic: "pass", codeQuality: "pass", cost },
    treatment: {
      delivery: "pass",
      semantic: "pass",
      codeQuality: "pass",
      cost: { ...cost, input_tokens: 500 },
    },
    repeatedKnownTasks: 1,
    holdoutTasks: 0,
  });
  assert.equal(qualityImprovedWithToleratedCost.status, "improvement_observed");

  const silent = projectHarnessEffect({
    contract,
    bucket: "TDD-suitable",
    activation: "not_activated",
    validity: { mechanism: "valid", cost: "valid" },
    control: { delivery: "pass", semantic: "pass", codeQuality: "pass", cost },
    treatment: { delivery: "pass", semantic: "pass", codeQuality: "pass", cost },
    repeatedKnownTasks: 1,
    holdoutTasks: 0,
  });
  assert.equal(silent.status, "not_activated");

  const mixed = projectHarnessEffect({
    contract,
    bucket: "TDD-suitable",
    activation: "activated",
    validity: { mechanism: "valid", cost: "valid" },
    control: { delivery: "fail", semantic: "pass", codeQuality: "pass", cost },
    treatment: {
      delivery: "pass",
      semantic: "pass",
      codeQuality: "concern",
      cost: { ...cost, input_tokens: 500 },
    },
    repeatedKnownTasks: 3,
    holdoutTasks: 0,
  });
  assert.equal(mixed.status, "mixed");
  assert.equal(mixed.claimStrength, "diagnostic");
});

function report(input: {
  delivery?: "pass" | "fail" | "error";
  semantic?: "pass" | "fail" | "abstain" | "not_required" | "error";
  codeQuality?: "pass" | "concern" | "fail" | "abstain" | "error";
  harnessValidity?: "valid" | "insufficient" | "invalid";
}) {
  const deliveryStatus = input.delivery ?? "pass";
  const semanticStatus = input.semantic ?? "pass";
  const codeQualityStatus = input.codeQuality ?? "pass";
  const semanticDimensions =
    semanticStatus === "not_required" || semanticStatus === "error"
      ? []
      : [
          {
            dimension_id: "requirement_intent_alignment" as const,
            applicability: "applicable" as const,
            verdict:
              semanticStatus === "abstain"
                ? ("abstain" as const)
                : semanticStatus === "fail"
                  ? ("fail" as const)
                  : ("pass" as const),
            severity: semanticStatus === "fail" ? ("blocking" as const) : ("none" as const),
            matched_condition_ids: [],
            evidence:
              semanticStatus === "abstain"
                ? []
                : [
                    {
                      source_ref: "artifact://campaign/candidate/diff.patch",
                      locator: "src/order.ts:1",
                    },
                  ],
            rationale: "Synthetic Semantic decision.",
            counterevidence: null,
            abstention_reason:
              semanticStatus === "abstain" ? ("insufficient_evidence" as const) : null,
          },
        ];
  const codeQualityDimensions =
    codeQualityStatus === "error"
      ? []
      : [
          {
            dimension_id: "change_scope_discipline" as const,
            applicability: "applicable" as const,
            verdict:
              codeQualityStatus === "abstain"
                ? ("abstain" as const)
                : codeQualityStatus === "fail" || codeQualityStatus === "concern"
                  ? ("fail" as const)
                  : ("pass" as const),
            severity:
              codeQualityStatus === "fail"
                ? ("blocking" as const)
                : codeQualityStatus === "concern"
                  ? ("concern" as const)
                  : ("none" as const),
            matched_condition_ids:
              codeQualityStatus === "fail" || codeQualityStatus === "concern"
                ? ["scope-condition"]
                : [],
            evidence:
              codeQualityStatus === "abstain"
                ? []
                : [
                    {
                      source_ref: "artifact://campaign/candidate/diff.patch",
                      locator: "src/order.ts:1",
                    },
                  ],
            rationale: "Synthetic Code Quality decision.",
            counterevidence: null,
            abstention_reason:
              codeQualityStatus === "abstain" ? ("insufficient_evidence" as const) : null,
          },
        ];
  return buildPhase3cDeliveryReport({
    evaluationId: "phase3c-report-test",
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
      harness_effect_contract: pointer("harness"),
    },
    validity: {
      deterministic: "valid",
      semanticJudge: semanticStatus === "error" ? "invalid" : "valid",
      codeQualityJudge: codeQualityStatus === "error" ? "invalid" : "valid",
      harnessMechanism: input.harnessValidity ?? "insufficient",
      cost: "valid",
      reasons: [],
    },
    delivery: {
      requirementDelta: [
        {
          observation_id: "delivery-observation",
          claim_id: "claim-one",
          axis: "requirement_delta",
          dimension_ids: ["cancel_order_outcome"],
          status: deliveryStatus,
          normal_form_ref: deliveryStatus === "error" ? null : pointer("normal-form"),
          evidence_refs: [pointer("delivery-evidence")],
        },
      ],
      domainPreservation: [],
    },
    semantic: { required: semanticStatus !== "not_required", dimensions: semanticDimensions },
    codeQuality: { dimensions: codeQualityDimensions },
    harnessEffect: {
      contractSha256: contract.harness_binding_sha256,
      status: "inconclusive",
      opportunity: "eligible",
      activation: "unknown",
      costDelta: {
        elapsed_ms: null,
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        failed_tool_calls: null,
      },
      claimStrength: "descriptive",
    },
    traceability: { claim_to_dimensions: {}, dimension_to_claims: {} },
  });
}

test("Candidate verdict is independent from Harness validity", () => {
  const value = report({ codeQuality: "concern", harnessValidity: "insufficient" });
  assert.equal(value.verdict, "accept");
  assert.equal(value.measurement_validity.candidate_verdict, "valid");
  assert.equal(value.measurement_validity.harness_effect, "insufficient");
});

test("Delivery failure rejects and required abstention is inconclusive", () => {
  assert.equal(report({ delivery: "fail" }).verdict, "reject");
  assert.equal(report({ semantic: "abstain" }).verdict, "inconclusive");
  assert.equal(report({ codeQuality: "fail" }).verdict, "reject");
});
