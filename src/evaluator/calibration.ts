import type { EvaluationRun } from "../capsule/contracts.js";
import type { LoadedCapsule } from "../capsule/loader.js";
import { findEvaluator } from "../capsule/loader.js";
import type { ReleasedCapsule } from "../capsule/release.js";
import type { CandidateRunner } from "./command-runner.js";
import { evaluateCandidate } from "./engine.js";

export interface CalibrationReport {
  readonly evaluator: { readonly evaluator_id: string; readonly version: string };
  readonly qualified: boolean;
  readonly failed_case_ids: readonly string[];
  readonly cases: readonly {
    readonly case_id: string;
    readonly kind: "gold" | "equivalent" | "mutant";
    readonly matched: boolean;
    readonly mismatches: readonly {
      readonly claim_id: string;
      readonly expected: EvaluationRun["claims"][number]["status"];
      readonly actual: EvaluationRun["claims"][number]["status"] | "missing";
    }[];
  }[];
}

export async function calibrateEvaluator(input: {
  readonly capsule: LoadedCapsule;
  readonly release: ReleasedCapsule;
  readonly evaluatorRef: string;
  readonly runner?: CandidateRunner;
}): Promise<CalibrationReport> {
  const evaluator = findEvaluator(input.capsule, input.evaluatorRef);
  const results = [];
  for (const calibrationCase of input.capsule.cases) {
    const evaluated = await evaluateCandidate({
      capsule: input.capsule,
      release: input.release,
      evaluatorRef: input.evaluatorRef,
      requirementId: evaluator.requirement_id,
      candidateId: calibrationCase.candidate_id,
      ...(input.runner === undefined ? {} : { runner: input.runner }),
      persist: false,
    });
    const actual = new Map(evaluated.run.claims.map((claim) => [claim.claim_id, claim.status]));
    const mismatches: {
      claim_id: string;
      expected: EvaluationRun["claims"][number]["status"];
      actual: EvaluationRun["claims"][number]["status"] | "missing";
    }[] = calibrationCase.expected_claims.flatMap((expected) => {
      const status: EvaluationRun["claims"][number]["status"] | "missing" =
        actual.get(expected.claim_id) ?? "missing";
      return status === expected.status
        ? []
        : [{ claim_id: expected.claim_id, expected: expected.status, actual: status }];
    });
    for (const target of calibrationCase.target_claim_ids ?? []) {
      if (actual.get(target) !== "fail" && !mismatches.some((entry) => entry.claim_id === target)) {
        mismatches.push({
          claim_id: target,
          expected: "fail",
          actual: actual.get(target) ?? "missing",
        });
      }
    }
    results.push({
      case_id: calibrationCase.case_id,
      kind: calibrationCase.kind,
      matched: mismatches.length === 0,
      mismatches,
    });
  }
  const failedCaseIds = results
    .filter((result) => !result.matched)
    .map((result) => result.case_id)
    .sort();
  return {
    evaluator: { evaluator_id: evaluator.evaluator_id, version: evaluator.version },
    qualified: failedCaseIds.length === 0,
    failed_case_ids: failedCaseIds,
    cases: results,
  };
}

export interface EvaluatorComparison {
  readonly left: string;
  readonly right: string;
  readonly changed_cases: readonly {
    readonly case_id: string;
    readonly claim_changes: readonly {
      readonly claim_id: string;
      readonly left: EvaluationRun["claims"][number]["status"];
      readonly right: EvaluationRun["claims"][number]["status"];
    }[];
  }[];
}

export async function compareEvaluators(input: {
  readonly capsule: LoadedCapsule;
  readonly release: ReleasedCapsule;
  readonly requirementId: string;
  readonly leftEvaluatorRef: string;
  readonly rightEvaluatorRef: string;
  readonly runner?: CandidateRunner;
}): Promise<EvaluatorComparison> {
  const changedCases = [];
  for (const calibrationCase of input.capsule.cases) {
    const [left, right] = await Promise.all(
      [input.leftEvaluatorRef, input.rightEvaluatorRef].map((evaluatorRef) =>
        evaluateCandidate({
          capsule: input.capsule,
          release: input.release,
          evaluatorRef,
          requirementId: input.requirementId,
          candidateId: calibrationCase.candidate_id,
          ...(input.runner === undefined ? {} : { runner: input.runner }),
          persist: false,
        }),
      ),
    );
    const rightByClaim = new Map(right?.run.claims.map((claim) => [claim.claim_id, claim.status]));
    const claimChanges = (left?.run.claims ?? []).flatMap((claim) => {
      const rightStatus = rightByClaim.get(claim.claim_id);
      return rightStatus === undefined || rightStatus === claim.status
        ? []
        : [{ claim_id: claim.claim_id, left: claim.status, right: rightStatus }];
    });
    if (claimChanges.length > 0) {
      changedCases.push({ case_id: calibrationCase.case_id, claim_changes: claimChanges });
    }
  }
  return {
    left: input.leftEvaluatorRef,
    right: input.rightEvaluatorRef,
    changed_cases: changedCases,
  };
}
