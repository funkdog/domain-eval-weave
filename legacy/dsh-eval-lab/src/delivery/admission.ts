import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  DETAILED_CALIBRATION_CANDIDATES,
  type DetailedCalibrationEvidence,
} from "../oracle/calibration.js";
import {
  type BehaviorStatus,
  type BehaviorVector,
  LEDGER_BEHAVIORS,
  type LedgerBehavior,
} from "../oracle/ledger.js";
import {
  type GraderAdmission,
  parseGraderAdmission,
  parseObservationCatalog,
  parseOraclePlan,
} from "./contracts.js";

function statuses(vector: BehaviorVector, status: BehaviorStatus): readonly LedgerBehavior[] {
  return LEDGER_BEHAVIORS.filter((behavior) => vector[behavior] === status);
}

function sameBehaviors(left: readonly LedgerBehavior[], right: readonly LedgerBehavior[]): boolean {
  return left.length === right.length && left.every((behavior, index) => behavior === right[index]);
}

function sameVector(left: BehaviorVector, right: BehaviorVector): boolean {
  return LEDGER_BEHAVIORS.every((behavior) => left[behavior] === right[behavior]);
}

function diagnostic(code: string, message: string) {
  return { code, message };
}

export function buildGraderAdmission(input: {
  readonly oraclePlan: unknown;
  readonly catalog: unknown;
  readonly calibration: DetailedCalibrationEvidence;
  readonly seed: number;
  readonly evalPackageDigest: string;
}): GraderAdmission {
  const oraclePlan = parseOraclePlan(input.oraclePlan);
  const catalog = parseObservationCatalog(input.catalog);
  const catalogDigest = canonicalJsonDigest(catalog);
  if (oraclePlan.observation_catalog_sha256 !== catalogDigest) {
    throw new Error(
      "Oracle Plan observation catalog digest does not match admission catalog digest",
    );
  }
  if (input.calibration.schema_version !== 1) {
    throw new Error("unsupported detailed calibration evidence version");
  }
  for (const candidate of DETAILED_CALIBRATION_CANDIDATES) {
    const vector = input.calibration.vectors[candidate];
    if (
      vector === undefined ||
      LEDGER_BEHAVIORS.some((behavior) => !["pass", "fail", "error"].includes(vector[behavior]))
    ) {
      throw new Error(`detailed calibration vector is incomplete: ${candidate}`);
    }
  }

  const redFailures = statuses(input.calibration.vectors.red, "fail");
  const redErrors = statuses(input.calibration.vectors.red, "error");
  const goldFailures = statuses(input.calibration.vectors.gold, "fail");
  const goldErrors = statuses(input.calibration.vectors.gold, "error");
  const redDetected = redFailures.length > 0 && redErrors.length === 0;
  const goldPassed = goldFailures.length === 0 && goldErrors.length === 0;
  const counterexamplesMatched = catalog.counterexamples.every((entry) => {
    const vector = input.calibration.vectors[entry.candidate_id];
    return (
      statuses(vector, "error").length === 0 &&
      sameBehaviors(statuses(vector, "fail"), entry.expected_failures)
    );
  });
  const behaviorCoverage = Object.fromEntries(
    LEDGER_BEHAVIORS.map((behavior) => [
      behavior,
      catalog.counterexamples
        .filter((entry) =>
          statuses(input.calibration.vectors[entry.candidate_id], "fail").includes(behavior),
        )
        .map((entry) => entry.candidate_id),
    ]),
  );
  const planBehaviors = new Set(oraclePlan.checks.map((check) => check.behavior_id));
  const coverageComplete = LEDGER_BEHAVIORS.every(
    (behavior) =>
      !planBehaviors.has(behavior) ||
      ((behaviorCoverage[behavior] as readonly string[] | undefined)?.length ?? 0) > 0,
  );
  const checks = {
    red_detected: redDetected,
    gold_passed: goldPassed,
    counterexamples_matched: counterexamplesMatched,
    repeatable: sameVector(
      input.calibration.vectors.gold,
      input.calibration.vectors["gold-repeat"],
    ),
    seed_stable: sameVector(
      input.calibration.vectors.gold,
      input.calibration.vectors["gold-next-seed"],
    ),
    coverage_complete: coverageComplete,
  };
  const diagnostics = [
    ...(checks.red_detected
      ? []
      : [
          diagnostic(
            "RED_NOT_REJECTED",
            "Red baseline did not produce a clean deterministic failure.",
          ),
        ]),
    ...(checks.gold_passed
      ? []
      : [diagnostic("GOLD_DID_NOT_PASS", "Gold produced a fail or measurement error.")]),
    ...(checks.counterexamples_matched
      ? []
      : [
          diagnostic(
            "COUNTEREXAMPLE_MISMATCH",
            "One or more calibrated counterexamples did not match exact expected failures.",
          ),
        ]),
    ...(checks.repeatable
      ? []
      : [diagnostic("CALIBRATION_NOT_REPEATABLE", "Repeated Gold vector drifted.")]),
    ...(checks.seed_stable
      ? []
      : [diagnostic("CALIBRATION_NOT_SEED_STABLE", "Gold changed under the next seed.")]),
    ...(checks.coverage_complete
      ? []
      : [
          diagnostic(
            "BEHAVIOR_COVERAGE_INCOMPLETE",
            "At least one Oracle Plan behavior lacks a failing counterexample.",
          ),
        ]),
  ];
  return parseGraderAdmission({
    schema_version: 1,
    admission_id: `${oraclePlan.plan_id}-admission`,
    oracle_plan_sha256: canonicalJsonDigest(oraclePlan),
    task_pack_sha256: oraclePlan.task_pack_sha256,
    observation_catalog_sha256: catalogDigest,
    eval_package_sha256: input.evalPackageDigest,
    calibration: {
      seed: input.seed,
      vectors: input.calibration.vectors,
    },
    behavior_coverage: behaviorCoverage,
    checks,
    status: Object.values(checks).every(Boolean) ? "admitted" : "rejected",
    diagnostics,
  });
}
