import { z } from "zod";

import { parseArtifactRef } from "./artifact-ref.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_TREE_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const idSchema = z.string().regex(ID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const finiteCountSchema = z.number().finite().int().nonnegative();
const nullableCountSchema = finiteCountSchema.nullable();
const artifactRefSchema = z.string().transform((value, context) => {
  try {
    return parseArtifactRef(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "invalid artifact ref",
    });
    return z.NEVER;
  }
});
const dateTimeSchema = z.iso.datetime({ offset: true });

const uniqueArtifactRefsSchema = z
  .array(artifactRefSchema)
  .refine((values) => new Set(values).size === values.length, "artifact refs must be unique");

export const diagnosticSchema = z.strictObject({
  code: z.string().regex(DIAGNOSTIC_CODE_PATTERN),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string().min(1),
  evidence_refs: uniqueArtifactRefsSchema,
});

const validityStatusSchema = z.enum(["valid", "invalid", "insufficient"]);

export const measurementValiditySchema = z.strictObject({
  overall: validityStatusSchema,
  dimensions: z.strictObject({
    outcome: validityStatusSchema,
    mechanism: validityStatusSchema,
    cost: validityStatusSchema,
  }),
  reasons: z.array(diagnosticSchema),
});

const allowedConfigPathsSchema = z.tuple([
  z.literal("goal.disabled"),
  z.literal("goal-round-driver.disabled"),
  z.literal("command-goal.disabled"),
  z.literal("tool-goal.disabled"),
]);

const armOrderSchema = z.union([
  z.tuple([z.literal("control"), z.literal("treatment")]),
  z.tuple([z.literal("treatment"), z.literal("control")]),
]);

export const experimentSpecSchema = z.strictObject({
  schema_version: z.literal(1),
  campaign_id: idSchema,
  created_at: dateTimeSchema,
  domain: z.literal("open-coding-delivery"),
  eval_pack_id: z.literal("open-coding-delivery-v1"),
  task_pack_digest: sha256Schema,
  control_variant_digest: sha256Schema,
  treatment_variant_digest: sha256Schema,
  intervention: z.strictObject({
    id: z.literal("dsh-goal-stack"),
    allowed_config_paths: allowedConfigPathsSchema,
  }),
  arm_order: armOrderSchema,
  timeout_ms_per_arm: finiteCountSchema.min(1).max(5_400_000),
  claim_strength: z.literal("diagnostic"),
  effect_claim_eligible: z.literal(false),
});

const evidenceSchema = z
  .strictObject({
    session_log_ref: artifactRefSchema.optional(),
    session_log_sha256: sha256Schema.optional(),
    candidate_tree: z.string().regex(GIT_TREE_PATTERN).optional(),
    candidate_archive_ref: artifactRefSchema.optional(),
    candidate_archive_sha256: sha256Schema.optional(),
  })
  .superRefine((evidence, context) => {
    const pairedFields = [
      ["session_log_ref", "session_log_sha256"],
      ["candidate_archive_ref", "candidate_archive_sha256"],
    ] as const;

    for (const [refField, digestField] of pairedFields) {
      if ((evidence[refField] === undefined) !== (evidence[digestField] === undefined)) {
        context.addIssue({
          code: "custom",
          path: [refField],
          message: `${refField} and ${digestField} must be present together`,
        });
      }
    }
  });

export const episodeRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  episode_id: idSchema,
  campaign_id: idSchema,
  arm: z.enum(["control", "treatment"]),
  variant_digest: sha256Schema,
  workspace_base_digest: sha256Schema,
  session_id: idSchema.optional(),
  process: z
    .strictObject({
      started_at: dateTimeSchema,
      ended_at: dateTimeSchema,
      exit_code: z.number().finite().int().nullable(),
      signal: z.string().nullable(),
      timed_out: z.boolean(),
    })
    .refine(
      (process) => Date.parse(process.started_at) <= Date.parse(process.ended_at),
      "process ended_at must not precede started_at",
    ),
  evidence: evidenceSchema,
  infrastructure_errors: z.array(diagnosticSchema),
});

export const evaluationResultSchema = z.strictObject({
  schema_version: z.literal(1),
  measurement_validity: measurementValiditySchema,
  outcome: z.strictObject({
    externally_verified_completion: z.boolean().nullable(),
    behavior_vector: z.record(z.string(), z.enum(["pass", "fail", "error"])),
    completion_claim: z.enum(["complete", "blocked", "absent"]),
    false_completion_claim: z.boolean().nullable(),
  }),
  mechanism: z.strictObject({
    goal_created: z.boolean().nullable(),
    goal_rounds_started: nullableCountSchema,
    goal_terminal_phase: z.enum(["complete", "blocked", "paused", "active", "none"]).nullable(),
    tool_calls: z.record(z.string(), finiteCountSchema),
    turns: nullableCountSchema,
    steps: nullableCountSchema,
  }),
  cost: z.strictObject({
    elapsed_ms: nullableCountSchema,
    input_tokens: nullableCountSchema,
    cached_input_tokens: nullableCountSchema,
    output_tokens: nullableCountSchema,
    failed_tool_calls: nullableCountSchema,
  }),
  hard_gates: z.record(z.string(), z.enum(["pass", "fail", "unknown"])),
  claim_strength: z.literal("diagnostic"),
  effect_claim_eligible: z.literal(false),
});

const artifactPointerSchema = z.strictObject({
  ref: artifactRefSchema,
  sha256: sha256Schema,
});

export const pairedImpactReportSchema = z.strictObject({
  schema_version: z.literal(1),
  campaign_id: idSchema,
  experiment_digest: sha256Schema,
  measurement_validity: measurementValiditySchema,
  arms: z.strictObject({
    control: evaluationResultSchema,
    treatment: evaluationResultSchema,
  }),
  cost_delta: z.strictObject({
    elapsed_ms: z.number().finite().int().nullable(),
    input_tokens: z.number().finite().int().nullable(),
    cached_input_tokens: z.number().finite().int().nullable(),
    output_tokens: z.number().finite().int().nullable(),
    failed_tool_calls: z.number().finite().int().nullable(),
  }),
  evidence: z.strictObject({
    experiment: artifactPointerSchema,
    control_episode: artifactPointerSchema,
    treatment_episode: artifactPointerSchema,
  }),
  known_blind_spots: z.array(diagnosticSchema),
  recommendation: z.strictObject({
    action: z.enum(["keep", "keep_baseline", "iterate", "revert", "run_more"]),
    rationale_codes: z
      .array(z.string().regex(DIAGNOSTIC_CODE_PATTERN))
      .min(1)
      .refine((values) => new Set(values).size === values.length, "rationale codes must be unique"),
  }),
  claim_strength: z.literal("diagnostic"),
  effect_claim_eligible: z.literal(false),
});

export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type MeasurementValidity = z.infer<typeof measurementValiditySchema>;
export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;
export type EpisodeRecord = z.infer<typeof episodeRecordSchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type PairedImpactReport = z.infer<typeof pairedImpactReportSchema>;

export function parseExperimentSpec(input: unknown): ExperimentSpec {
  return experimentSpecSchema.parse(input);
}

export function parseEpisodeRecord(input: unknown): EpisodeRecord {
  return episodeRecordSchema.parse(input);
}

export function parseEvaluationResult(input: unknown): EvaluationResult {
  return evaluationResultSchema.parse(input);
}

export function parsePairedImpactReport(input: unknown): PairedImpactReport {
  return pairedImpactReportSchema.parse(input);
}
