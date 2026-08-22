import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import type { CommerceCalibrationEvidence } from "../oracle/commerce-calibration-v2.js";
import {
  COMMERCE_BEHAVIORS,
  type CommerceBehavior,
  type CommerceBehaviorVector,
} from "../oracle/commerce-order-v2.js";
import { parseCommerceObservationCatalog } from "./catalog.js";
import {
  type CommerceGraderAdmission,
  parseCommerceGraderAdmission,
  parseCommerceOraclePlan,
} from "./delivery-contracts.js";

function statuses(
  vector: CommerceBehaviorVector,
  status: "pass" | "fail" | "error",
): readonly CommerceBehavior[] {
  return COMMERCE_BEHAVIORS.filter((behavior) => vector[behavior] === status);
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameVector(left: CommerceBehaviorVector, right: CommerceBehaviorVector): boolean {
  return COMMERCE_BEHAVIORS.every((behavior) => left[behavior] === right[behavior]);
}

function diagnostic(code: string, message: string) {
  return { code, message };
}

export function buildCommerceGraderAdmission(input: {
  readonly oraclePlan: unknown;
  readonly catalog: unknown;
  readonly calibration: CommerceCalibrationEvidence;
  readonly seed: number;
  readonly evalPackageDigest: string;
}): CommerceGraderAdmission {
  const plan = parseCommerceOraclePlan(input.oraclePlan);
  const catalog = parseCommerceObservationCatalog(input.catalog);
  const catalogDigest = canonicalJsonDigest(catalog);
  if (plan.observation_catalog_sha256 !== catalogDigest) {
    throw new Error("Commerce Oracle Plan catalog digest does not match admission catalog");
  }
  if (
    input.calibration.schema_version !== 2 ||
    input.calibration.template_id !== "commerce-order-cancellation-v2"
  ) {
    throw new Error("unsupported commerce calibration evidence");
  }
  const red = input.calibration.vectors.red;
  const gold = input.calibration.vectors.gold;
  const redDetected = statuses(red, "fail").length > 0 && statuses(red, "error").length === 0;
  const goldPassed = statuses(gold, "fail").length === 0 && statuses(gold, "error").length === 0;
  const counterexamplesMatched = catalog.counterexamples.every((entry) => {
    const vector = input.calibration.vectors[entry.candidate_id];
    return (
      statuses(vector, "error").length === 0 &&
      same(statuses(vector, "fail"), entry.expected_failures)
    );
  });
  const behaviorCoverage = Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [
      behavior,
      catalog.counterexamples
        .filter((entry) => input.calibration.vectors[entry.candidate_id][behavior] === "fail")
        .map((entry) => entry.candidate_id),
    ]),
  );
  const checks = {
    red_detected: redDetected,
    gold_passed: goldPassed,
    counterexamples_matched: counterexamplesMatched,
    repeatable: sameVector(gold, input.calibration.vectors["gold-repeat"]),
    seed_stable: sameVector(gold, input.calibration.vectors["gold-next-seed"]),
    coverage_complete: COMMERCE_BEHAVIORS.every(
      (behavior) => (behaviorCoverage[behavior] as readonly string[] | undefined)?.length,
    ),
  };
  const diagnostics = [
    ...(checks.red_detected
      ? []
      : [diagnostic("COMMERCE_RED_NOT_REJECTED", "Commerce red baseline was not rejected.")]),
    ...(checks.gold_passed
      ? []
      : [diagnostic("COMMERCE_GOLD_DID_NOT_PASS", "Commerce Gold failed or errored.")]),
    ...(checks.counterexamples_matched
      ? []
      : [
          diagnostic(
            "COMMERCE_COUNTEREXAMPLE_MISMATCH",
            "Commerce counterexample vectors drifted from exact expectations.",
          ),
        ]),
    ...(checks.repeatable
      ? []
      : [diagnostic("COMMERCE_NOT_REPEATABLE", "Commerce repeated Gold vector drifted.")]),
    ...(checks.seed_stable
      ? []
      : [diagnostic("COMMERCE_NOT_SEED_STABLE", "Commerce Gold changed under next seed.")]),
    ...(checks.coverage_complete
      ? []
      : [diagnostic("COMMERCE_COVERAGE_INCOMPLETE", "Commerce behavior coverage is incomplete.")]),
  ];
  return parseCommerceGraderAdmission({
    schema_version: 2,
    template_id: "commerce-order-cancellation-v2",
    admission_id: `${plan.plan_id}-admission`,
    oracle_plan_sha256: canonicalJsonDigest(plan),
    task_pack_sha256: plan.task_pack_sha256,
    observation_catalog_sha256: catalogDigest,
    eval_package_sha256: input.evalPackageDigest,
    calibration: { seed: input.seed, vectors: input.calibration.vectors },
    behavior_coverage: behaviorCoverage,
    checks,
    status: Object.values(checks).every(Boolean) ? "admitted" : "rejected",
    diagnostics,
  });
}
