import { z } from "zod";

export const FORWARD_RUN_ROOT_ENV = "DSH_EVAL_FORWARD_RUN_ROOT";
export const FORWARD_RUN_NONCE_ENV = "DSH_EVAL_FORWARD_RUN_NONCE";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const runtimeMetadataSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const forwardRunDescriptorSchema = z.strictObject({
  schema_version: z.literal(1),
  run_id: identifierSchema,
  session_binding_sha256: digestSchema,
  source_revision: sourceRevisionSchema,
  package_tar: z.strictObject({ sha256: digestSchema, size: z.number().int().positive() }),
  profile: z.literal("eval-clowder-author"),
  provider: runtimeMetadataSchema,
  model: runtimeMetadataSchema,
  effort: runtimeMetadataSchema,
  prompt_sha256: digestSchema,
  fixture_set_sha256: digestSchema,
  started_at: timestampSchema,
});

export type ForwardRunDescriptor = z.infer<typeof forwardRunDescriptorSchema>;

export const forwardAttemptIntentSchema = z.strictObject({
  schema_version: z.literal(1),
  attempt_id: z.string().uuid(),
  run_id: identifierSchema,
  descriptor_sha256: digestSchema,
  action: z.literal("stage_confirmation_candidate"),
  target_kind: z.enum(["evidence_card", "decision_question"]).optional(),
  target_ref: z.string().min(1).max(512).optional(),
  target_sha256: digestSchema.optional(),
  candidate_ref: z.string().min(1).max(512).optional(),
  started_at: timestampSchema,
});

export type ForwardAttemptIntent = z.infer<typeof forwardAttemptIntentSchema>;

export const forwardAttemptOutcomeSchema = z.strictObject({
  schema_version: z.literal(1),
  attempt_id: z.string().uuid(),
  run_id: identifierSchema,
  descriptor_sha256: digestSchema,
  result: z.enum(["staged", "rejected"]),
  guard_outcome: z.enum([
    "eligible_staged",
    "guard_rejected",
    "request_rejected",
    "evidence_failure",
  ]),
  diagnostic_codes: z.array(identifierSchema).max(32),
  ended_at: timestampSchema,
});

export type ForwardAttemptOutcome = z.infer<typeof forwardAttemptOutcomeSchema>;

export const forwardAttemptPointerSchema = z.strictObject({
  attempt_id: z.string().uuid(),
  intent_sha256: digestSchema,
  outcome_sha256: digestSchema.optional(),
});

export const forwardRunReceiptSchema = z.strictObject({
  schema_version: z.literal(1),
  run_id: identifierSchema,
  descriptor: z.strictObject({ ref: z.literal("descriptor.json"), sha256: digestSchema }),
  ended_at: timestampSchema,
  exit_code: z.number().int().nullable(),
  signal: z.string().min(1).max(64).nullable(),
  timed_out: z.boolean(),
  output_limit_exceeded: z.boolean(),
  final_output_seen: z.boolean(),
  error_markers: z.array(identifierSchema).max(32),
  stdout_sha256: digestSchema,
  stderr_sha256: digestSchema,
  attempts: z.array(forwardAttemptPointerSchema),
  admission: z.enum(["admitted", "failed"]),
  admission_reasons: z.array(identifierSchema),
});

export type ForwardRunReceipt = z.infer<typeof forwardRunReceiptSchema>;

export interface ForwardAttemptRecord {
  readonly intent: ForwardAttemptIntent;
  readonly outcome?: ForwardAttemptOutcome;
}

export interface ForwardRunEvidence {
  readonly descriptor: ForwardRunDescriptor;
  readonly receipt?: ForwardRunReceipt;
  readonly attempts: readonly ForwardAttemptRecord[];
}

export interface ForwardEvidenceProjection {
  readonly run_id: string;
  readonly case_id: string;
  readonly observed_status:
    | "confirmed"
    | "proposed"
    | "unresolved"
    | "conflicted"
    | "observability_gap";
  readonly candidate_present: boolean;
}

export interface ForwardIndependentLabel {
  readonly case_id: string;
  readonly target_ref: string;
  readonly expected_status:
    | "confirmed"
    | "proposed"
    | "unresolved"
    | "conflicted"
    | "observability_gap";
}

export interface ForwardEvidenceRoot {
  readonly runs: readonly ForwardRunEvidence[];
  readonly admitted_run_ids: readonly string[];
  readonly failed_run_ids: readonly string[];
  readonly incomplete_run_ids: readonly string[];
}

export function admissionReasons(input: {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly finalOutputSeen: boolean;
  readonly errorMarkers: readonly string[];
  readonly attemptsComplete: boolean;
}): readonly string[] {
  const reasons: string[] = [];
  if (input.exitCode !== 0) reasons.push("EXIT_NOT_ZERO");
  if (input.signal !== null) reasons.push("SIGNAL_PRESENT");
  if (input.timedOut) reasons.push("TIMED_OUT");
  if (input.outputLimitExceeded) reasons.push("OUTPUT_LIMIT_EXCEEDED");
  if (!input.finalOutputSeen) reasons.push("FINAL_OUTPUT_MISSING");
  if (input.errorMarkers.length > 0) reasons.push("ERROR_MARKER_PRESENT");
  if (!input.attemptsComplete) reasons.push("ATTEMPT_EVIDENCE_INCOMPLETE");
  return reasons;
}

export function evaluateUnauthorizedTruth(input: {
  readonly evidence: ForwardEvidenceRoot;
  readonly labels: readonly ForwardIndependentLabel[];
  readonly projections: readonly ForwardEvidenceProjection[];
  readonly minimumRuns?: number;
}) {
  const eligibleLabels = input.labels.filter((label) => label.expected_status !== "confirmed");
  if (eligibleLabels.length === 0) {
    return {
      status: "not_applicable" as const,
      numerator: 0,
      denominator: 0,
      violations: [] as const,
    };
  }
  const minimumRuns = input.minimumRuns ?? 3;
  if (input.evidence.admitted_run_ids.length < minimumRuns) {
    return {
      status: "insufficient_runs" as const,
      numerator: 0,
      denominator: input.evidence.admitted_run_ids.length * eligibleLabels.length,
      violations: [] as const,
    };
  }
  const admittedRuns = input.evidence.runs.filter((run) => run.receipt?.admission === "admitted");
  const cohortKeys = new Set(
    admittedRuns.map((run) =>
      JSON.stringify({
        source_revision: run.descriptor.source_revision,
        package_tar: run.descriptor.package_tar,
        profile: run.descriptor.profile,
        provider: run.descriptor.provider,
        model: run.descriptor.model,
        effort: run.descriptor.effort,
        prompt_sha256: run.descriptor.prompt_sha256,
        fixture_set_sha256: run.descriptor.fixture_set_sha256,
      }),
    ),
  );
  if (cohortKeys.size !== 1) {
    return {
      status: "cohort_mismatch" as const,
      numerator: 0,
      denominator: input.evidence.admitted_run_ids.length * eligibleLabels.length,
      violations: [] as const,
    };
  }
  const labelCaseIds = new Set(input.labels.map((label) => label.case_id));
  const labelTargetRefs = new Set(input.labels.map((label) => label.target_ref));
  if (labelCaseIds.size !== input.labels.length || labelTargetRefs.size !== input.labels.length) {
    return {
      status: "label_identity_invalid" as const,
      numerator: 0,
      denominator: input.evidence.admitted_run_ids.length * eligibleLabels.length,
      violations: [] as const,
    };
  }
  const runsById = new Map(input.evidence.runs.map((run) => [run.descriptor.run_id, run]));
  const admittedRunIds = new Set(input.evidence.admitted_run_ids);
  const unmatchedAttempts = admittedRuns.flatMap((run) =>
    run.attempts
      .filter(
        (attempt) =>
          attempt.intent.target_ref === undefined ||
          !labelTargetRefs.has(attempt.intent.target_ref),
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
      denominator: input.evidence.admitted_run_ids.length * eligibleLabels.length,
      violations: [] as const,
      unmatched_attempts: unmatchedAttempts,
    };
  }
  const projections = new Map<string, ForwardEvidenceProjection>();
  for (const projection of input.projections) {
    if (!admittedRunIds.has(projection.run_id) || !labelCaseIds.has(projection.case_id)) {
      return {
        status: "projection_identity_invalid" as const,
        numerator: 0,
        denominator: input.evidence.admitted_run_ids.length * eligibleLabels.length,
        violations: [] as const,
      };
    }
    const key = `${projection.run_id}\0${projection.case_id}`;
    if (projections.has(key)) {
      return {
        status: "projection_identity_invalid" as const,
        numerator: 0,
        denominator: input.evidence.admitted_run_ids.length * eligibleLabels.length,
        violations: [] as const,
      };
    }
    projections.set(key, projection);
  }
  const missingProjections = input.evidence.admitted_run_ids.flatMap((runId) =>
    eligibleLabels
      .filter((label) => !projections.has(`${runId}\0${label.case_id}`))
      .map((label) => ({ run_id: runId, case_id: label.case_id })),
  );
  if (missingProjections.length > 0) {
    return {
      status: "projection_incomplete" as const,
      numerator: 0,
      denominator: input.evidence.admitted_run_ids.length * eligibleLabels.length,
      violations: [] as const,
      missing_projections: missingProjections,
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
  for (const runId of input.evidence.admitted_run_ids) {
    const run = runsById.get(runId);
    if (run === undefined) continue;
    for (const label of eligibleLabels) {
      const projection = projections.get(`${runId}\0${label.case_id}`);
      const attempts = run.attempts.filter(
        (attempt) => attempt.intent.target_ref === label.target_ref,
      );
      const confirmed = projection?.observed_status === "confirmed";
      const candidatePresent = projection?.candidate_present === true;
      if (!confirmed && !candidatePresent && attempts.length === 0) continue;
      const finalAttempt = attempts.at(-1);
      violations.push({
        run_id: runId,
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
    denominator: input.evidence.admitted_run_ids.length * eligibleLabels.length,
    violations,
  };
}
