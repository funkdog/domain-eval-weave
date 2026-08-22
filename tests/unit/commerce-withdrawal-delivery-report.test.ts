import assert from "node:assert/strict";
import test from "node:test";

import { buildCommerceGraderAdmission } from "../../src/commerce-withdrawal/admission.js";
import { buildCommerceDeliveryReport } from "../../src/commerce-withdrawal/delivery-report.js";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  validCommerceWithdrawalAdmission,
  validCommerceWithdrawalCatalog,
  validCommerceWithdrawalClaimIr,
  validCommerceWithdrawalOraclePlan,
  validCommerceWithdrawalPairedEvaluation,
  validCommerceWithdrawalPairedEvaluationPointer,
  validCommerceWithdrawalPairedReport,
} from "../helpers/commerce-withdrawal-artifact-fixtures.js";

function build(input: { pairedEvaluation?: unknown; claimIr?: unknown; admission?: unknown } = {}) {
  const pairedEvaluation = input.pairedEvaluation ?? validCommerceWithdrawalPairedEvaluation;
  const pointer = {
    ...validCommerceWithdrawalPairedEvaluationPointer,
    sha256: canonicalJsonDigest(pairedEvaluation),
  };
  const paired = pairedEvaluation as typeof validCommerceWithdrawalPairedEvaluation;
  const pairedReport = {
    ...validCommerceWithdrawalPairedReport,
    arms: {
      control: paired.arms.control.result,
      treatment: paired.arms.treatment.result,
    },
    evidence: {
      ...validCommerceWithdrawalPairedReport.evidence,
      evaluation: pointer,
    },
  };
  return buildCommerceDeliveryReport({
    evaluationId: "delivery-commerce-withdrawal-test",
    claimIr: input.claimIr ?? validCommerceWithdrawalClaimIr,
    oraclePlan: validCommerceWithdrawalOraclePlan,
    catalog: validCommerceWithdrawalCatalog,
    admission: input.admission ?? validCommerceWithdrawalAdmission,
    pairedEvaluation,
    pairedReport,
    pairedEvaluationPointer: pointer,
    pairedReportPointer: {
      ref: "artifact://campaign/report.json",
      sha256: canonicalJsonDigest(pairedReport),
    },
  });
}

test("an admitted all-pass withdrawal Campaign yields accept without a score", () => {
  const report = build();
  assert.equal(report.template_id, "commerce-order-cancellation-v2");
  assert.equal(report.verdict, "accept");
  assert.equal(report.axes.requirement_delta.status, "pass");
  assert.equal(report.axes.domain_preservation.status, "pass");
  assert.equal(report.axes.semantic_residual.status, "not_required");
  assert.equal("overall_score" in report, false);
  assert.equal(Object.keys(report.traceability.behavior_to_claims).length, 16);
});

test("one withdrawal failure rejects and cannot be offset", () => {
  const paired = structuredClone(validCommerceWithdrawalPairedEvaluation);
  paired.arms.treatment.result.outcome.behavior_vector.withdrawal_completion_precedes_cancellation =
    "fail";
  paired.arms.treatment.result.outcome.externally_verified_completion = false;
  const report = build({ pairedEvaluation: paired });
  assert.equal(report.verdict, "reject");
  assert.equal(report.axes.requirement_delta.status, "fail");
});

test("a mutated Claim IR cannot reuse the admitted Oracle Plan", () => {
  const claimIr = {
    ...validCommerceWithdrawalClaimIr,
    semantic_residual: [
      {
        claim_id: "unobserved-commerce-claim",
        axis: "domain_preservation" as const,
        reason_code: "OBSERVATION_BINDING_MISSING" as const,
      },
    ],
  };
  assert.throws(() => build({ claimIr }), /Claim IR/);
});

test("a non-admitted withdrawal Grader cannot produce accept", () => {
  const calibration = structuredClone(validCommerceWithdrawalAdmission.calibration);
  calibration.vectors["gold-next-seed"].unpaid_cancel_has_no_refund = "fail";
  const admission = buildCommerceGraderAdmission({
    oraclePlan: validCommerceWithdrawalOraclePlan,
    catalog: validCommerceWithdrawalCatalog,
    calibration: {
      schema_version: 2,
      template_id: "commerce-order-cancellation-v2",
      vectors: calibration.vectors,
    },
    seed: calibration.seed,
    evalPackageDigest: validCommerceWithdrawalAdmission.eval_package_sha256,
  });
  assert.equal(admission.status, "rejected");
  const report = build({ admission });
  assert.equal(report.verdict, "inconclusive");
  assert.equal(report.axes.measurement_validity.status, "invalid");
});
