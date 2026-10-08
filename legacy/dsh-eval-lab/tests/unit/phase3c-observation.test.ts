import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  buildObservationBoundaryAdmission,
  deriveExpressionDimensions,
  EFFECT_DIMENSION,
  evaluateObservationExpression,
  normalizeOperationTransport,
  PHASE3C_DIMENSIONS,
  PHASE3C_PUBLIC_OBSERVATION_CATALOG,
  parseDomainObservationNormalForm,
  runDeterministicObservations,
  STATE_DIMENSION,
  validateObservationBoundary,
} from "../../src/phase3c/index.js";

const sha = (value: string) => value.repeat(64);
const pointer = (name: string, digest = sha("a")) => ({
  ref: `artifact://campaign/phase3c/${name}.json`,
  sha256: digest,
});

function authorityMap() {
  const deterministic = new Set([
    "cancel_order_outcome",
    "order_status_state",
    "refund_requested_effect",
    "withdrawal_before_cancellation",
    "retention_window",
  ]);
  return {
    schema_version: 1 as const,
    catalog_sha256: canonicalJsonDigest(PHASE3C_PUBLIC_OBSERVATION_CATALOG),
    claim_ir_sha256: sha("b"),
    dimensions: PHASE3C_DIMENSIONS.map((dimensionId) => ({
      dimension_id: dimensionId,
      disposition: deterministic.has(dimensionId)
        ? ("deterministic" as const)
        : ("out_of_scope" as const),
      claim_ids: deterministic.has(dimensionId) ? ["claim-cancel"] : [],
      authority_refs: [pointer(`authority-${dimensionId}`)],
    })),
  };
}

function boundary() {
  const authority = authorityMap();
  return {
    schema_version: 3 as const,
    boundary_id: "commerce-order-observation-boundary-v3" as const,
    template_id: "commerce-order-cancellation-v3" as const,
    source: {
      domain_manifest: pointer("domain"),
      requirement: pointer("requirement"),
      claim_ir: pointer("claim-ir", authority.claim_ir_sha256),
      task_pack: pointer("task-pack"),
    },
    public_surface_sha256: sha("c"),
    public_observation_catalog_sha256: authority.catalog_sha256,
    authority_map_sha256: canonicalJsonDigest(authority),
    bindings: [
      {
        observation_id: "cancel-observation",
        claim_id: "claim-cancel",
        axis: "requirement_delta" as const,
        dimension_ids: [
          "cancel_order_outcome",
          "order_status_state",
          "refund_requested_effect",
          "withdrawal_before_cancellation",
          "retention_window",
        ],
        stimulus_id: "paid_order" as const,
        expression: {
          type: "all_of" as const,
          children: [
            {
              type: "operation_status_is" as const,
              operation_id: "cancel_order" as const,
              expected_status: "accepted" as const,
            },
            {
              type: "state_field_compare" as const,
              slot: "after" as const,
              field_id: "order_status" as const,
              comparator: "equals" as const,
              expected_values: [
                {
                  type: "scalar_literal" as const,
                  domain_id: "order_status_enum" as const,
                  value: "cancelled",
                },
              ],
            },
            {
              type: "effect_count_is" as const,
              slot: "after" as const,
              effect_id: "refund_requested" as const,
              cardinality: { mode: "exactly" as const, value: 1 },
            },
            {
              type: "relation_holds" as const,
              relation_id: "withdrawal_before_cancellation" as const,
            },
            {
              type: "retention_window_compare" as const,
              clock_stimulus_id: "retention_clock" as const,
              comparator: "within" as const,
              window_ms: 1_000,
            },
          ],
        },
      },
    ],
    normal_form_version: "domain-observation-normal-form-v1" as const,
    runner_sha256: sha("d"),
  };
}

const after = {
  schema_version: 1,
  operation: { status: "accepted" },
  state: [
    { field_id: "order_status", value: { domain_id: "order_status_enum", scalar: "cancelled" } },
    { field_id: "refund_amount", value: { domain_id: "nonnegative_minor_units", scalar: 8_000 } },
  ],
  effects: [
    {
      effect_id: "refund_requested",
      identity: [
        { field_id: "order_id", value: "order-1" },
        { field_id: "effect_key", value: "refund-order-1" },
      ],
      attributes: [
        { field_id: "amount", value: 8_000 },
        { field_id: "currency", value: "USD" },
      ],
    },
  ],
  relations: [{ relation_id: "withdrawal_before_cancellation", status: true }],
};

function firstBinding(value: ReturnType<typeof boundary>) {
  const binding = value.bindings[0];
  if (binding === undefined) throw new Error("Phase 3C fixture binding is missing");
  return binding;
}

test("Boundary validation proves complete deterministic dimension execution coverage", () => {
  const value = validateObservationBoundary({
    boundary: boundary(),
    authorityMap: authorityMap(),
    claimAxes: { "claim-cancel": "requirement_delta" },
  });
  assert.deepEqual(value.derivedDimensions, boundary().bindings[0]?.dimension_ids);

  const missing = structuredClone(boundary());
  const missingBinding = firstBinding(missing);
  const expression = missingBinding.expression;
  if (expression?.type !== "all_of") throw new Error("bad fixture");
  expression.children = expression.children.filter((child) => child.type !== "effect_count_is");
  missingBinding.dimension_ids = missingBinding.dimension_ids.filter(
    (dimension) => dimension !== "refund_requested_effect",
  );
  assert.throws(
    () =>
      validateObservationBoundary({
        boundary: missing,
        authorityMap: authorityMap(),
        claimAxes: { "claim-cancel": "requirement_delta" },
      }),
    /complete deterministic dimension/i,
  );

  const residualReference = structuredClone(boundary());
  firstBinding(residualReference).dimension_ids.push("currency_state");
  assert.throws(
    () =>
      validateObservationBoundary({
        boundary: residualReference,
        authorityMap: authorityMap(),
        claimAxes: { "claim-cancel": "requirement_delta" },
      }),
    /derived dimension|deterministic/i,
  );
});

test("AST dimensions are derived from fixed vocabulary", () => {
  const expression = firstBinding(boundary()).expression;
  assert.deepEqual(deriveExpressionDimensions(expression), [
    "cancel_order_outcome",
    "order_status_state",
    "refund_requested_effect",
    "withdrawal_before_cancellation",
    "retention_window",
  ]);
  assert.equal(STATE_DIMENSION.order_status, "order_status_state");
  assert.equal(EFFECT_DIMENSION.refund_requested, "refund_requested_effect");
});

test("throw and typed rejection normalize to the same domain outcome", () => {
  assert.equal(normalizeOperationTransport({ kind: "throw" }), "rejected");
  assert.equal(normalizeOperationTransport({ kind: "typed_rejection" }), "rejected");
  assert.equal(normalizeOperationTransport({ kind: "success" }), "accepted");
  assert.equal(normalizeOperationTransport({ kind: "unavailable" }), "unavailable");
});

test("normal-form evaluator checks state, exactly-once effects, relations, and retention", () => {
  const parsed = parseDomainObservationNormalForm(after);
  assert.equal(
    evaluateObservationExpression(firstBinding(boundary()).expression, {
      operations: { cancel_order: "accepted" },
      normalForms: { after: parsed },
      stimuli: {},
      retentionAgeMs: { retention_clock: 500 },
    }),
    true,
  );

  const doubleRefund = structuredClone(parsed);
  const refund = doubleRefund.effects[0];
  if (refund === undefined) throw new Error("Phase 3C refund fixture is missing");
  doubleRefund.effects.push(structuredClone(refund));
  assert.equal(
    evaluateObservationExpression(firstBinding(boundary()).expression, {
      operations: { cancel_order: "accepted" },
      normalForms: { after: doubleRefund },
      stimuli: {},
      retentionAgeMs: { retention_clock: 500 },
    }),
    false,
  );
});

test("deterministic runner freezes Candidate identity and calibration separates equivalents from mutants", async () => {
  const candidate = pointer("candidate/archive", sha("e"));
  const result = await runDeterministicObservations({
    boundary: boundary(),
    authorityMap: authorityMap(),
    claimAxes: { "claim-cancel": "requirement_delta" },
    candidateArchive: candidate,
    candidateTreeSha256Before: sha("f"),
    candidateTreeSha256After: async () => sha("f"),
    seed: 1729,
    executor: {
      async execute() {
        return {
          context: {
            operations: { cancel_order: "accepted" },
            normalForms: { after: parseDomainObservationNormalForm(after) },
            stimuli: {},
            retentionAgeMs: { retention_clock: 500 },
          },
          normalFormRef: pointer("normal-forms/cancel", sha("1")),
          evidenceRefs: [pointer("evidence/cancel", sha("2"))],
        };
      },
      async captureFailure() {
        return { evidenceRefs: [pointer("evidence/error", sha("3"))] };
      },
    },
  });
  assert.equal(result.measurement_validity, "valid");
  assert.equal(result.observations[0]?.status, "pass");

  const calibrationCase = (
    caseId: string,
    caseKind: "gold" | "equivalent" | "mutant" | "relaxation_mutant",
    expectedFailedObservationIds: readonly string[],
  ) => {
    const caseDigest = {
      gold: "9",
      equivalent: "a",
      mutant: "b",
      relaxation_mutant: "c",
    }[caseKind];
    const archive = pointer(`calibration/${caseId}/candidate`, sha(caseDigest));
    const candidateResult = {
      ...result,
      candidate_archive: archive,
      observations: result.observations.map((observation) => ({
        ...observation,
        status: expectedFailedObservationIds.includes(observation.observation_id)
          ? ("fail" as const)
          : ("pass" as const),
      })),
    };
    return {
      caseId,
      caseKind,
      candidateArchive: archive,
      expectedFailedObservationIds,
      result: candidateResult,
      resultPointer: pointer(`calibration/${caseId}/result`, canonicalJsonDigest(candidateResult)),
    };
  };
  const admission = buildObservationBoundaryAdmission({
    boundary: boundary(),
    taskPackSha256: sha("4"),
    seed: 1729,
    cases: [
      calibrationCase("gold", "gold", []),
      calibrationCase("typed-rejection", "equivalent", []),
      calibrationCase("missing-refund", "mutant", ["cancel-observation"]),
      calibrationCase("normalizer-escape", "relaxation_mutant", ["cancel-observation"]),
    ],
  });
  assert.equal(admission.status, "admitted");
  assert.deepEqual(admission.false_reject_case_ids, []);
  assert.deepEqual(admission.false_accept_case_ids, []);
});

test("deterministic runner marks execution errors and post-run Candidate drift invalid", async () => {
  const value = await runDeterministicObservations({
    boundary: boundary(),
    authorityMap: authorityMap(),
    claimAxes: { "claim-cancel": "requirement_delta" },
    candidateArchive: pointer("candidate/archive", sha("5")),
    candidateTreeSha256Before: sha("6"),
    candidateTreeSha256After: async () => sha("7"),
    seed: 1729,
    executor: {
      async execute() {
        throw new Error("synthetic execution failure");
      },
      async captureFailure() {
        return { evidenceRefs: [pointer("evidence/error", sha("8"))] };
      },
    },
  });
  assert.equal(value.measurement_validity, "invalid");
  assert.equal(value.observations[0]?.status, "error");
  assert.equal(value.observations[0]?.normal_form_ref, null);
});
