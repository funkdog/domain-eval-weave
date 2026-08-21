import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import {
  parseClaimIr,
  parseDeliveryEvaluationReport,
  parseGraderAdmission,
  parseObservationCatalog,
  parseOraclePlan,
} from "../../src/delivery/contracts.js";
import {
  validClaimIr,
  validDeliveryEvaluationReport,
  validGraderAdmission,
  validObservationCatalog,
  validOraclePlan,
} from "../helpers/phase3b-fixtures.js";

const faces = [
  ["claim-observation-catalog.schema.json", validObservationCatalog, parseObservationCatalog],
  ["claim-ir.schema.json", validClaimIr, parseClaimIr],
  ["oracle-plan.schema.json", validOraclePlan, parseOraclePlan],
  ["grader-admission.schema.json", validGraderAdmission, parseGraderAdmission],
  [
    "delivery-evaluation-report.schema.json",
    validDeliveryEvaluationReport,
    parseDeliveryEvaluationReport,
  ],
] as const;

async function validator(name: string) {
  const source = await readFile(new URL(`../../contracts/${name}`, import.meta.url), "utf8");
  return new Ajv2020({ strict: true, allErrors: true }).compile(JSON.parse(source));
}

test("Phase 3B persisted faces have JSON Schema and strict parser parity", async () => {
  for (const [schemaName, value, parser] of faces) {
    const validate = await validator(schemaName);
    assert.equal(validate(value), true, `${schemaName}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(parser(value), value);
  }
});

test("the observation catalog freezes all eight behaviors once in canonical order", async () => {
  const invalid = structuredClone(validObservationCatalog) as Record<string, unknown>;
  const behaviors = invalid.behaviors as Record<string, unknown>[];
  const first = behaviors[0];
  assert.ok(first);
  behaviors[1] = structuredClone(first);
  assert.throws(() => parseObservationCatalog(invalid));
  const validate = await validator("claim-observation-catalog.schema.json");
  assert.equal(validate(invalid), false);
});

test("Claim IR rejects asymmetric traceability and unknown fields", () => {
  const asymmetric = structuredClone(validClaimIr) as Record<string, unknown>;
  const traceability = asymmetric.traceability as Record<string, unknown>;
  const reverse = traceability.behavior_to_claims as Record<string, unknown>;
  reverse.basic_reservation = ["reservation-state-integrity"];
  assert.throws(() => parseClaimIr(asymmetric));

  assert.throws(() => parseClaimIr({ ...validClaimIr, inferred_from_keywords: true }));
});

test("Oracle Plan rejects missing, duplicate, and caller-softened checks", () => {
  assert.throws(() =>
    parseOraclePlan({ ...validOraclePlan, checks: validOraclePlan.checks.slice(1) }),
  );
  assert.throws(() =>
    parseOraclePlan({
      ...validOraclePlan,
      checks: [...validOraclePlan.checks, validOraclePlan.checks[0]],
    }),
  );
  assert.throws(() =>
    parseOraclePlan({
      ...validOraclePlan,
      checks: validOraclePlan.checks.map((check, index) =>
        index === 0 ? { ...check, hard_gate: false } : check,
      ),
    }),
  );
});

test("an admitted Grader cannot carry a failed gate or uncovered behavior", () => {
  assert.throws(() =>
    parseGraderAdmission({
      ...validGraderAdmission,
      checks: { ...validGraderAdmission.checks, coverage_complete: false },
    }),
  );
  const uncovered = structuredClone(validGraderAdmission) as Record<string, unknown>;
  const coverage = uncovered.behavior_coverage as Record<string, unknown>;
  coverage.basic_reservation = [];
  assert.throws(() => parseGraderAdmission(uncovered));

  const forgedRepeatability = structuredClone(validGraderAdmission) as Record<string, unknown>;
  const calibration = forgedRepeatability.calibration as Record<string, unknown>;
  const vectors = calibration.vectors as Record<string, Record<string, unknown>>;
  const repeatedGold = vectors["gold-repeat"];
  assert.ok(repeatedGold);
  repeatedGold.basic_reservation = "fail";
  assert.throws(() => parseGraderAdmission(forgedRepeatability));
});

test("the five-axis report forbids a score and impossible accept verdicts", () => {
  assert.throws(() =>
    parseDeliveryEvaluationReport({ ...validDeliveryEvaluationReport, overall_score: 100 }),
  );
  const failed = structuredClone(validDeliveryEvaluationReport) as Record<string, unknown>;
  const axes = failed.axes as Record<string, Record<string, unknown>>;
  const delta = axes.requirement_delta;
  assert.ok(delta);
  delta.status = "fail";
  assert.throws(() => parseDeliveryEvaluationReport(failed));

  const asymmetric = structuredClone(validDeliveryEvaluationReport) as Record<string, unknown>;
  const traceability = asymmetric.traceability as Record<string, Record<string, unknown>>;
  const reverse = traceability.behavior_to_claims;
  assert.ok(reverse);
  reverse.basic_reservation = ["reservation-state-integrity"];
  assert.throws(() => parseDeliveryEvaluationReport(asymmetric));
});
