import assert from "node:assert/strict";
import test from "node:test";

import { buildGraderAdmission } from "../../src/delivery/admission.js";
import { type BehaviorVector, LEDGER_BEHAVIORS } from "../../src/oracle/ledger.js";
import { validObservationCatalog, validOraclePlan } from "../helpers/phase3b-fixtures.js";

const digest = (character: string): string => character.repeat(64);

function vector(failures: readonly (typeof LEDGER_BEHAVIORS)[number][]): BehaviorVector {
  return Object.fromEntries(
    LEDGER_BEHAVIORS.map((behavior) => [behavior, failures.includes(behavior) ? "fail" : "pass"]),
  ) as BehaviorVector;
}

const passing = vector([]);
const calibration = {
  schema_version: 1 as const,
  vectors: {
    red: vector(LEDGER_BEHAVIORS),
    gold: passing,
    "mutant-no-lock": vector(["no_oversubscription_concurrent"]),
    "mutant-no-persistence": vector(["restart_recovery"]),
    "mutant-corrupt-resets": vector(["corrupt_state_fail_closed"]),
    "mutant-broken-release": vector(["terminal_transition_idempotency", "restart_recovery"]),
    "mutant-release-not-persisted": vector(["restart_recovery"]),
    "gold-repeat": passing,
    "gold-next-seed": passing,
  },
} as const;

test("Gold, Red, targeted mutants, repeatability, and seed stability admit the Plan", () => {
  const admission = buildGraderAdmission({
    oraclePlan: validOraclePlan,
    catalog: validObservationCatalog,
    calibration,
    seed: 1729,
    evalPackageDigest: digest("7"),
  });
  assert.equal(admission.status, "admitted");
  assert.deepEqual(admission.diagnostics, []);
  for (const behavior of LEDGER_BEHAVIORS) {
    assert.equal(admission.behavior_coverage[behavior].includes("red"), true);
  }
});

test("caller enthusiasm cannot upgrade an Oracle error to admitted", () => {
  const brokenGold = {
    ...calibration,
    vectors: {
      ...calibration.vectors,
      gold: { ...passing, basic_reservation: "error" as const },
    },
  };
  const admission = buildGraderAdmission({
    oraclePlan: validOraclePlan,
    catalog: validObservationCatalog,
    calibration: brokenGold,
    seed: 1729,
    evalPackageDigest: digest("7"),
  });
  assert.equal(admission.status, "rejected");
  assert.equal(admission.checks.gold_passed, false);
  assert.equal(
    admission.diagnostics.some((entry) => entry.code === "GOLD_DID_NOT_PASS"),
    true,
  );
});

test("an extra mutant failure rejects exact calibration expectations", () => {
  const broadMutant = {
    ...calibration,
    vectors: {
      ...calibration.vectors,
      "mutant-no-lock": vector(["no_oversubscription_concurrent", "restart_recovery"]),
    },
  };
  const admission = buildGraderAdmission({
    oraclePlan: validOraclePlan,
    catalog: validObservationCatalog,
    calibration: broadMutant,
    seed: 1729,
    evalPackageDigest: digest("7"),
  });
  assert.equal(admission.status, "rejected");
  assert.equal(admission.checks.counterexamples_matched, false);
});

test("Plan/catalog digest mismatch is a pre-admission identity error", () => {
  assert.throws(
    () =>
      buildGraderAdmission({
        oraclePlan: { ...validOraclePlan, observation_catalog_sha256: digest("8") },
        catalog: validObservationCatalog,
        calibration,
        seed: 1729,
        evalPackageDigest: digest("7"),
      }),
    /catalog digest/,
  );
});
