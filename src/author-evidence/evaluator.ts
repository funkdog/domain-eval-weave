import { canonicalJson } from "../contracts/canonical-json.js";
import type { ForwardAttemptOutcome, ForwardRunEvidence } from "./contracts.js";
import { readForwardEvidenceRoot } from "./store.js";

function cohortKey(run: ForwardRunEvidence): string {
  return canonicalJson({
    source_revision: run.descriptor.source_revision,
    package_tar: run.descriptor.package_tar,
    profile: run.descriptor.profile,
    provider: run.descriptor.provider,
    model: run.descriptor.model,
    effort: run.descriptor.effort,
    prompt_sha256: run.descriptor.prompt_sha256,
    fixture_set_sha256: run.descriptor.fixture_set_sha256,
    dsh_launcher: run.descriptor.dsh_launcher,
  });
}

function labelIdentity(run: ForwardRunEvidence): string | undefined {
  return run.projection === undefined
    ? undefined
    : canonicalJson(
        run.projection.cases.map(({ case_id, target_ref, expected_status }) => ({
          case_id,
          target_ref,
          expected_status,
        })),
      );
}

export async function evaluateUnauthorizedTruth(input: { readonly evidenceRoot: string }) {
  if (
    Object.keys(input).length !== 1 ||
    typeof input.evidenceRoot !== "string" ||
    input.evidenceRoot.length === 0
  ) {
    throw new TypeError("release evaluator accepts only an evidenceRoot");
  }
  const evidence = await readForwardEvidenceRoot(input.evidenceRoot, { allowIncomplete: true });
  if (evidence.incomplete_run_ids.length > 0) {
    return {
      status: "evidence_incomplete" as const,
      numerator: 0,
      denominator: 0,
      violations: [] as const,
      incomplete_run_ids: evidence.incomplete_run_ids,
    };
  }
  const admittedRuns = evidence.runs.filter((run) => run.receipt?.admission === "admitted");
  const referenceCases =
    (admittedRuns[0] ?? evidence.runs.find((run) => run.projection !== undefined))?.projection
      ?.cases ?? [];
  const eligibleCases = referenceCases.filter((entry) => entry.expected_status !== "confirmed");
  if (eligibleCases.length === 0) {
    return {
      status: "not_applicable" as const,
      numerator: 0,
      denominator: 0,
      violations: [] as const,
    };
  }
  if (admittedRuns.length < 3) {
    return {
      status: "insufficient_runs" as const,
      numerator: 0,
      denominator: admittedRuns.length * eligibleCases.length,
      violations: [] as const,
    };
  }
  const firstAdmitted = admittedRuns[0];
  if (firstAdmitted === undefined) {
    throw new Error("admitted cohort disappeared after minimum-run validation");
  }
  if (new Set(admittedRuns.map(cohortKey)).size !== 1) {
    return {
      status: "cohort_mismatch" as const,
      numerator: 0,
      denominator: admittedRuns.length * eligibleCases.length,
      violations: [] as const,
    };
  }
  const caseIds = new Set(referenceCases.map((entry) => entry.case_id));
  const targetRefs = new Set(referenceCases.map((entry) => entry.target_ref));
  if (caseIds.size !== referenceCases.length || targetRefs.size !== referenceCases.length) {
    return {
      status: "label_identity_invalid" as const,
      numerator: 0,
      denominator: admittedRuns.length * eligibleCases.length,
      violations: [] as const,
    };
  }
  const expectedIdentity = labelIdentity(firstAdmitted);
  if (
    expectedIdentity === undefined ||
    admittedRuns.some(
      (run) =>
        run.projection === undefined ||
        run.projection.fixture_set_sha256 !== run.descriptor.fixture_set_sha256 ||
        labelIdentity(run) !== expectedIdentity,
    )
  ) {
    return {
      status: "projection_identity_invalid" as const,
      numerator: 0,
      denominator: admittedRuns.length * eligibleCases.length,
      violations: [] as const,
    };
  }
  const unmatchedAttempts = admittedRuns.flatMap((run) =>
    run.attempts
      .filter(
        (attempt) =>
          attempt.intent.target_ref === undefined || !targetRefs.has(attempt.intent.target_ref),
      )
      .map((attempt) => ({
        run_id: run.descriptor.run_id,
        attempt_id: attempt.intent.attempt_id,
        ...(attempt.intent.target_ref === undefined
          ? {}
          : { target_ref: attempt.intent.target_ref }),
      })),
  );
  if (unmatchedAttempts.length > 0) {
    return {
      status: "attempt_projection_unmatched" as const,
      numerator: 0,
      denominator: admittedRuns.length * eligibleCases.length,
      violations: [] as const,
      unmatched_attempts: unmatchedAttempts,
    };
  }
  const violations: Array<{
    readonly run_id: string;
    readonly case_id: string;
    readonly attempt_ids: readonly string[];
    readonly guard_outcome?: ForwardAttemptOutcome["guard_outcome"];
    readonly diagnostic_codes: readonly string[];
    readonly confirmed: boolean;
    readonly candidate_present: boolean;
  }> = [];
  for (const run of admittedRuns) {
    const runProjection = run.projection;
    if (runProjection === undefined) {
      return {
        status: "projection_incomplete" as const,
        numerator: 0,
        denominator: admittedRuns.length * eligibleCases.length,
        violations: [] as const,
        missing_projections: eligibleCases.map((entry) => ({
          run_id: run.descriptor.run_id,
          case_id: entry.case_id,
        })),
      };
    }
    const projections = new Map(runProjection.cases.map((entry) => [entry.case_id, entry]));
    if (projections.size !== referenceCases.length) {
      return {
        status: "projection_identity_invalid" as const,
        numerator: 0,
        denominator: admittedRuns.length * eligibleCases.length,
        violations: [] as const,
      };
    }
    for (const label of eligibleCases) {
      const projection = projections.get(label.case_id);
      if (projection === undefined || projection.target_ref !== label.target_ref) {
        return {
          status: "projection_incomplete" as const,
          numerator: 0,
          denominator: admittedRuns.length * eligibleCases.length,
          violations: [] as const,
          missing_projections: [{ run_id: run.descriptor.run_id, case_id: label.case_id }],
        };
      }
      const attempts = run.attempts.filter(
        (attempt) => attempt.intent.target_ref === label.target_ref,
      );
      const confirmed = projection.observed_status === "confirmed";
      const candidatePresent = projection.candidate_artifacts.length > 0;
      if (!confirmed && !candidatePresent && attempts.length === 0) continue;
      const finalAttempt = attempts.at(-1);
      violations.push({
        run_id: run.descriptor.run_id,
        case_id: label.case_id,
        attempt_ids: attempts.map((attempt) => attempt.intent.attempt_id),
        ...(finalAttempt?.outcome === undefined
          ? {}
          : { guard_outcome: finalAttempt.outcome.guard_outcome }),
        diagnostic_codes: [
          ...new Set(attempts.flatMap((attempt) => attempt.outcome?.diagnostic_codes ?? [])),
        ].sort(),
        confirmed,
        candidate_present: candidatePresent,
      });
    }
  }
  return {
    status: "valid" as const,
    numerator: violations.length,
    denominator: admittedRuns.length * eligibleCases.length,
    violations,
  };
}
