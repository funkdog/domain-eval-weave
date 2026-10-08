import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { buildDeliveryEvaluationReport } from "../../src/delivery/report.js";
import { validPairedEvaluation, validReport } from "../helpers/fixtures.js";
import {
  validClaimIr,
  validGraderAdmission,
  validObservationCatalog,
  validOraclePlan,
} from "../helpers/phase3b-fixtures.js";

function build(
  pairedEvaluation: unknown = validPairedEvaluation,
  admission: unknown = validGraderAdmission,
  pairedReport: unknown = validReport,
) {
  const pairedEvaluationPointer = {
    ref: "artifact://campaign/evaluation.json",
    sha256: canonicalJsonDigest(pairedEvaluation),
  };
  const paired = pairedEvaluation as typeof validPairedEvaluation;
  const closedPairedReport = {
    ...(pairedReport as typeof validReport),
    arms: {
      control: paired.arms.control.result,
      treatment: paired.arms.treatment.result,
    },
    evidence: {
      ...(pairedReport as typeof validReport).evidence,
      evaluation: pairedEvaluationPointer,
    },
  };
  return buildDeliveryEvaluationReport({
    evaluationId: "delivery-implement-reservation-ledger-v1",
    claimIr: validClaimIr,
    oraclePlan: validOraclePlan,
    catalog: validObservationCatalog,
    admission,
    pairedEvaluation,
    pairedReport: closedPairedReport,
    pairedEvaluationPointer,
    pairedReportPointer: {
      ref: "artifact://campaign/report.json",
      sha256: canonicalJsonDigest(closedPairedReport),
    },
  });
}

test("an admitted, valid, all-pass Agent Campaign yields a five-axis accept report", () => {
  const report = build();
  assert.equal(report.verdict, "accept");
  assert.equal(report.axes.requirement_delta.status, "pass");
  assert.equal(report.axes.domain_preservation.status, "pass");
  assert.equal(report.axes.semantic_residual.status, "not_required");
  assert.equal("overall_score" in report, false);
  assert.deepEqual(report.traceability, validClaimIr.traceability);
});

test("one deterministic treatment failure rejects delivery and cannot be offset", () => {
  const paired = {
    ...validPairedEvaluation,
    arms: {
      ...validPairedEvaluation.arms,
      treatment: {
        ...validPairedEvaluation.arms.treatment,
        result: {
          ...validPairedEvaluation.arms.treatment.result,
          outcome: {
            ...validPairedEvaluation.arms.treatment.result.outcome,
            externally_verified_completion: false,
            behavior_vector: {
              ...validPairedEvaluation.arms.treatment.result.outcome.behavior_vector,
              basic_reservation: "fail" as const,
            },
          },
        },
      },
    },
  };
  const report = build(paired);
  assert.equal(report.verdict, "reject");
  assert.equal(report.axes.requirement_delta.status, "fail");
  assert.equal(report.axes.semantic_residual.status, "not_required");
});

test("a measurement error dominates a simultaneous deterministic failure", () => {
  const paired = {
    ...validPairedEvaluation,
    arms: {
      ...validPairedEvaluation.arms,
      treatment: {
        ...validPairedEvaluation.arms.treatment,
        result: {
          ...validPairedEvaluation.arms.treatment.result,
          outcome: {
            ...validPairedEvaluation.arms.treatment.result.outcome,
            externally_verified_completion: false,
            behavior_vector: {
              ...validPairedEvaluation.arms.treatment.result.outcome.behavior_vector,
              basic_reservation: "fail" as const,
              idempotent_replay: "error" as const,
            },
          },
        },
      },
    },
  };
  const report = build(paired);
  assert.equal(report.verdict, "inconclusive");
  assert.equal(report.axes.requirement_delta.status, "error");
});

test("measurement invalidity takes precedence over deterministic results", () => {
  const invalidValidity = {
    overall: "invalid" as const,
    dimensions: {
      outcome: "invalid" as const,
      mechanism: "invalid" as const,
      cost: "invalid" as const,
    },
    reasons: [
      {
        code: "SYNTHETIC_MEASUREMENT_INVALID",
        severity: "error" as const,
        message: "Synthetic invalid measurement.",
        evidence_refs: [],
      },
    ],
  };
  const paired = { ...validPairedEvaluation, measurement_validity: invalidValidity };
  const pairedReport = {
    ...validReport,
    measurement_validity: invalidValidity,
  };
  const report = build(paired, validGraderAdmission, pairedReport);
  assert.equal(report.verdict, "inconclusive");
  assert.equal(report.axes.measurement_validity.status, "invalid");
});

test("a non-admitted Grader can never produce accept", () => {
  const admission = {
    ...validGraderAdmission,
    calibration: {
      ...validGraderAdmission.calibration,
      vectors: {
        ...validGraderAdmission.calibration.vectors,
        gold: {
          ...validGraderAdmission.calibration.vectors.gold,
          basic_reservation: "error" as const,
        },
      },
    },
    checks: {
      ...validGraderAdmission.checks,
      gold_passed: false,
      repeatable: false,
      seed_stable: false,
    },
    status: "rejected",
    diagnostics: [{ code: "GOLD_DID_NOT_PASS", message: "Synthetic Gold failure." }],
  };
  const report = build(validPairedEvaluation, admission);
  assert.equal(report.verdict, "inconclusive");
  assert.equal(report.axes.measurement_validity.reason_codes.includes("GRADER_NOT_ADMITTED"), true);
});

test("persisted Campaign pointer drift is rejected before report projection", () => {
  assert.throws(
    () =>
      buildDeliveryEvaluationReport({
        evaluationId: "delivery-implement-reservation-ledger-v1",
        claimIr: validClaimIr,
        oraclePlan: validOraclePlan,
        catalog: validObservationCatalog,
        admission: validGraderAdmission,
        pairedEvaluation: validPairedEvaluation,
        pairedReport: validReport,
        pairedEvaluationPointer: {
          ref: "artifact://campaign/evaluation.json",
          sha256: "0".repeat(64),
        },
        pairedReportPointer: {
          ref: "artifact://campaign/report.json",
          sha256: canonicalJsonDigest(validReport),
        },
      }),
    /pointer digest/,
  );
});

test("Oracle Plan semantics are replayed from Claim IR and the frozen catalog", () => {
  const ghostPlan = {
    ...validOraclePlan,
    checks: validOraclePlan.checks.map((check, index) =>
      index === 0
        ? {
            ...check,
            claim_ids: ["ghost-claim"],
            axes: ["domain_preservation"],
            risk_weight: check.risk_weight === 5 ? 4 : 5,
          }
        : check,
    ),
  };
  const reboundAdmission = {
    ...validGraderAdmission,
    oracle_plan_sha256: canonicalJsonDigest(ghostPlan),
  };
  assert.throws(
    () =>
      buildDeliveryEvaluationReport({
        evaluationId: "delivery-implement-reservation-ledger-v1",
        claimIr: validClaimIr,
        oraclePlan: ghostPlan,
        catalog: validObservationCatalog,
        admission: reboundAdmission,
        pairedEvaluation: validPairedEvaluation,
        pairedReport: validReport,
        pairedEvaluationPointer: {
          ref: "artifact://campaign/evaluation.json",
          sha256: canonicalJsonDigest(validPairedEvaluation),
        },
        pairedReportPointer: {
          ref: "artifact://campaign/report.json",
          sha256: canonicalJsonDigest(validReport),
        },
      }),
    /Oracle Plan semantic replay/,
  );
});
