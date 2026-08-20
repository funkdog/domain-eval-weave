import { z } from "zod";

export const FORWARD_RUN_ROOT_ENV = "DSH_EVAL_FORWARD_RUN_ROOT";
export const FORWARD_RUN_NONCE_ENV = "DSH_EVAL_FORWARD_RUN_NONCE";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const runtimeMetadataSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const timestampSchema = z.string().datetime({ offset: true });
const relativeRefSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      value
        .split("/")
        .every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "must be a normalized relative reference",
  );
const evidenceStatusSchema = z.enum([
  "confirmed",
  "proposed",
  "unresolved",
  "conflicted",
  "observability_gap",
]);

export const forwardIndependentLabelSchema = z.strictObject({
  case_id: identifierSchema,
  target_ref: relativeRefSchema,
  expected_status: evidenceStatusSchema,
});

export const forwardFixtureManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    fixture_set_id: identifierSchema,
    files: z.array(z.strictObject({ ref: relativeRefSchema, sha256: digestSchema })),
  })
  .superRefine((manifest, context) => {
    const fileRefs = new Set(manifest.files.map((entry) => entry.ref));
    if (fileRefs.size !== manifest.files.length) {
      context.addIssue({ code: "custom", path: ["files"], message: "fixture refs must be unique" });
    }
  });

export const forwardIndependentLabelManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    fixture_set_id: identifierSchema,
    fixture_manifest_sha256: digestSchema,
    labels: z.array(forwardIndependentLabelSchema),
  })
  .superRefine((manifest, context) => {
    const caseIds = new Set(manifest.labels.map((entry) => entry.case_id));
    const targetRefs = new Set(manifest.labels.map((entry) => entry.target_ref));
    if (caseIds.size !== manifest.labels.length || targetRefs.size !== manifest.labels.length) {
      context.addIssue({
        code: "custom",
        path: ["labels"],
        message: "independent label case ids and target refs must be unique",
      });
    }
    for (const [index, label] of manifest.labels.entries()) {
      if (!/^evidence-cards\/[^/]+\/r[1-9][0-9]*\.json$/.test(label.target_ref)) {
        context.addIssue({
          code: "custom",
          path: ["labels", index, "target_ref"],
          message: "forward labels must target canonical Evidence Card revisions",
        });
      }
    }
  });

export type ForwardIndependentLabel = z.infer<typeof forwardIndependentLabelSchema>;
export type ForwardFixtureManifest = z.infer<typeof forwardFixtureManifestSchema>;
export type ForwardIndependentLabelManifest = z.infer<typeof forwardIndependentLabelManifestSchema>;

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

export const forwardRunProjectionSchema = z
  .strictObject({
    schema_version: z.literal(1),
    run_id: identifierSchema,
    descriptor_sha256: digestSchema,
    fixture_set_sha256: digestSchema,
    cases: z.array(
      z.strictObject({
        case_id: identifierSchema,
        target_ref: relativeRefSchema,
        expected_status: evidenceStatusSchema,
        observed_status: evidenceStatusSchema.optional(),
        target_sha256: digestSchema.optional(),
        candidate_artifacts: z.array(
          z.strictObject({ ref: relativeRefSchema, sha256: digestSchema }),
        ),
      }),
    ),
  })
  .superRefine((projection, context) => {
    const caseIds = new Set(projection.cases.map((entry) => entry.case_id));
    const targetRefs = new Set(projection.cases.map((entry) => entry.target_ref));
    if (caseIds.size !== projection.cases.length || targetRefs.size !== projection.cases.length) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: "projection case ids and target refs must be unique",
      });
    }
    for (const [index, entry] of projection.cases.entries()) {
      if ((entry.observed_status === undefined) !== (entry.target_sha256 === undefined)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index],
          message: "observed status and target digest must be present together",
        });
      }
      if (
        new Set(entry.candidate_artifacts.map((candidate) => candidate.ref)).size !==
        entry.candidate_artifacts.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "candidate_artifacts"],
          message: "candidate refs must be unique",
        });
      }
    }
  });

export type ForwardRunProjection = z.infer<typeof forwardRunProjectionSchema>;

export const forwardRunReceiptSchema = z.strictObject({
  schema_version: z.literal(1),
  run_id: identifierSchema,
  descriptor: z.strictObject({ ref: z.literal("descriptor.json"), sha256: digestSchema }),
  projection: z.strictObject({ ref: z.literal("projection.json"), sha256: digestSchema }),
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
  readonly projection?: ForwardRunProjection;
  readonly receipt?: ForwardRunReceipt;
  readonly attempts: readonly ForwardAttemptRecord[];
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
  readonly projectionComplete: boolean;
}): readonly string[] {
  const reasons: string[] = [];
  if (input.exitCode !== 0) reasons.push("EXIT_NOT_ZERO");
  if (input.signal !== null) reasons.push("SIGNAL_PRESENT");
  if (input.timedOut) reasons.push("TIMED_OUT");
  if (input.outputLimitExceeded) reasons.push("OUTPUT_LIMIT_EXCEEDED");
  if (!input.finalOutputSeen) reasons.push("FINAL_OUTPUT_MISSING");
  if (input.errorMarkers.length > 0) reasons.push("ERROR_MARKER_PRESENT");
  if (!input.attemptsComplete) reasons.push("ATTEMPT_EVIDENCE_INCOMPLETE");
  if (!input.projectionComplete) reasons.push("FINAL_PROJECTION_INCOMPLETE");
  return reasons;
}
