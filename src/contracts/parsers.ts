import { z } from "zod";

import { parseArtifactRef } from "./artifact-ref.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_TREE_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const VERIFIED_BEHAVIOR_KEYS = [
  "basic_reservation",
  "idempotent_replay",
  "conflicting_replay_rejected",
  "no_oversubscription_concurrent",
  "terminal_transition_idempotency",
  "restart_recovery",
  "corrupt_state_fail_closed",
  "deterministic_snapshot",
] as const;

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
const artifactPointerSchema = z.strictObject({
  ref: artifactRefSchema,
  sha256: sha256Schema,
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

const behaviorStatusSchema = z.enum(["pass", "fail", "error"]);

export const qualificationEvidenceSchema = z.strictObject({
  schema_version: z.literal(1),
  ready: z.literal(true),
  deployment_digest: sha256Schema,
  session_id: idSchema,
  common_tool_schema_sha256: sha256Schema,
});

const qualificationProjectionSchema = z.strictObject({
  source_deployment_digest: sha256Schema,
  projected_deployment_digest: sha256Schema,
  source_qualification_sha256: sha256Schema,
});

export const calibrationEvidenceSchema = z.strictObject({
  schema_version: z.literal(1),
  ready: z.literal(true),
  task_pack_digest: sha256Schema,
  calibration_digest: sha256Schema,
  eval_package_sha256: sha256Schema,
  candidates: z.strictObject({
    red: z.array(behaviorStatusSchema).length(VERIFIED_BEHAVIOR_KEYS.length),
    gold: z.array(behaviorStatusSchema).length(VERIFIED_BEHAVIOR_KEYS.length),
    no_lock_failures: z.tuple([z.literal("no_oversubscription_concurrent")]),
    no_persistence_failures: z.tuple([z.literal("restart_recovery")]),
    corrupt_resets_failures: z.tuple([z.literal("corrupt_state_fail_closed")]),
  }),
  repeatable: z.literal(true),
  seed_stable: z.literal(true),
});

export const experimentSpecSchema = z.strictObject({
  schema_version: z.literal(1),
  campaign_id: idSchema,
  created_at: dateTimeSchema,
  domain: z.literal("open-coding-delivery"),
  eval_pack_id: z.literal("open-coding-delivery-v1"),
  task_pack_digest: sha256Schema,
  control_variant_digest: sha256Schema,
  treatment_variant_digest: sha256Schema,
  deployment: z.strictObject({
    digest: sha256Schema,
    eval_package_sha256: sha256Schema,
    qualification: qualificationEvidenceSchema,
    qualification_projection: qualificationProjectionSchema.optional(),
    calibration: calibrationEvidenceSchema,
  }),
  intervention: z.strictObject({
    id: z.literal("dsh-goal-stack"),
    allowed_config_paths: allowedConfigPathsSchema,
  }),
  arm_order: armOrderSchema,
  timeout_ms_per_arm: finiteCountSchema.min(1).max(5_400_000),
  claim_strength: z.literal("diagnostic"),
  effect_claim_eligible: z.literal(false),
});

export const variantSpecSchema = z
  .strictObject({
    schema_version: z.literal(1),
    variant_id: z.enum(["goal-off", "goal-on"]),
    common_patch_sha256: sha256Schema,
    arm_patch_sha256: sha256Schema,
    expected_goal_rows: z.strictObject({
      goal: z.boolean(),
      goal_round_driver: z.boolean(),
      command_goal: z.boolean(),
      tool_goal: z.boolean(),
    }),
    dsh_package_tree_sha256: sha256Schema,
    codex_connect_package_sha256: sha256Schema,
    eval_package_sha256: sha256Schema,
    model_route: z.strictObject({
      provider: z.literal("openai-codex"),
      model: z.literal("gpt-5.6-sol"),
      reasoning_effort: z.literal("xhigh"),
    }),
    resolved_config_sha256: sha256Schema,
    tool_schema_sha256: sha256Schema,
    tools_mode: z.literal("native"),
    permission_mode: z.literal("workspace-write"),
  })
  .refine(
    (variant) =>
      Object.values(variant.expected_goal_rows).every(
        (enabled) => enabled === (variant.variant_id === "goal-on"),
      ),
    "VariantSpec Goal rows must all match its frozen variant id",
  );

const evidenceSchema = z.strictObject({
  session_log_ref: artifactRefSchema,
  session_log_sha256: sha256Schema,
  candidate_tree: z.string().regex(GIT_TREE_PATTERN),
  candidate_tree_ref: artifactRefSchema,
  candidate_tree_sha256: sha256Schema,
  candidate_patch_ref: artifactRefSchema,
  candidate_patch_sha256: sha256Schema,
  candidate_archive_ref: artifactRefSchema,
  candidate_archive_sha256: sha256Schema,
  stdout_ref: artifactRefSchema,
  stdout_sha256: sha256Schema,
  stderr_ref: artifactRefSchema,
  stderr_sha256: sha256Schema,
});

const candidatePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "candidate paths must be normalized repository-relative paths",
  );

const candidatePathsSchema = z
  .array(candidatePathSchema)
  .refine(
    (values) => new Set(values).size === values.length,
    "candidate path evidence must be unique",
  );

const episodeMeasurementSchema = z.strictObject({
  candidate_changed_paths: candidatePathsSchema,
  candidate_unauthorized_paths: candidatePathsSchema,
  candidate_forbidden_entries: candidatePathsSchema,
  candidate_frozen_before_oracle: z.literal(true),
  candidate_tree_after_oracle: z.string().regex(GIT_TREE_PATTERN),
  elapsed_ms: finiteCountSchema,
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
  measurement: episodeMeasurementSchema,
  infrastructure_errors: z.array(diagnosticSchema),
});

export const evaluationResultSchema = z
  .strictObject({
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
  })
  .superRefine((result, context) => {
    if (result.outcome.externally_verified_completion !== true) return;

    if (result.measurement_validity.dimensions.outcome !== "valid") {
      context.addIssue({
        code: "custom",
        path: ["measurement_validity", "dimensions", "outcome"],
        message: "verified completion requires valid outcome measurement",
      });
    }

    const behaviorKeys = Object.keys(result.outcome.behavior_vector).sort();
    const requiredKeys = [...VERIFIED_BEHAVIOR_KEYS].sort();
    if (
      behaviorKeys.length !== requiredKeys.length ||
      behaviorKeys.some((key, index) => key !== requiredKeys[index]) ||
      requiredKeys.some((key) => result.outcome.behavior_vector[key] !== "pass")
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome", "behavior_vector"],
        message: "verified completion requires exactly the eight frozen passing behaviors",
      });
    }

    for (const gate of [
      "unauthorized_path_change",
      "oracle_hidden_from_candidate",
      "candidate_frozen_before_oracle",
      "candidate_unchanged_after_oracle",
      "deployment_fingerprint_match",
      "carrier_process_healthy",
    ]) {
      if (result.hard_gates[gate] !== "pass") {
        context.addIssue({
          code: "custom",
          path: ["hard_gates", gate],
          message: `verified completion requires ${gate} to pass`,
        });
      }
    }
  });

const costDeltaSchema = z.strictObject({
  elapsed_ms: z.number().finite().int().nullable(),
  input_tokens: z.number().finite().int().nullable(),
  cached_input_tokens: z.number().finite().int().nullable(),
  output_tokens: z.number().finite().int().nullable(),
  failed_tool_calls: z.number().finite().int().nullable(),
});

const evaluatedArmSchema = z.strictObject({
  episode: artifactPointerSchema,
  oracle: artifactPointerSchema,
  candidate: z.strictObject({
    tree: z.string().regex(GIT_TREE_PATTERN),
    archive: artifactPointerSchema,
  }),
  result: evaluationResultSchema,
});

export const pairedEvaluationArtifactSchema = z.strictObject({
  schema_version: z.literal(1),
  campaign_id: idSchema,
  oracle_seed: artifactPointerSchema,
  measurement_validity: measurementValiditySchema,
  arms: z.strictObject({
    control: evaluatedArmSchema,
    treatment: evaluatedArmSchema,
  }),
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
  cost_delta: costDeltaSchema,
  evidence: z.strictObject({
    experiment: artifactPointerSchema,
    control_episode: artifactPointerSchema,
    treatment_episode: artifactPointerSchema,
    evaluation: artifactPointerSchema,
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
export type QualificationEvidence = z.infer<typeof qualificationEvidenceSchema>;
export type CalibrationEvidence = z.infer<typeof calibrationEvidenceSchema>;
export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;
export type VariantSpec = z.infer<typeof variantSpecSchema>;
export type EpisodeRecord = z.infer<typeof episodeRecordSchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
export type PairedEvaluationArtifact = z.infer<typeof pairedEvaluationArtifactSchema>;
export type PairedImpactReport = z.infer<typeof pairedImpactReportSchema>;

export function parseExperimentSpec(input: unknown): ExperimentSpec {
  return experimentSpecSchema.parse(input);
}

export function parseQualificationEvidence(input: unknown): QualificationEvidence {
  return qualificationEvidenceSchema.parse(input);
}

export function parseCalibrationEvidence(input: unknown): CalibrationEvidence {
  return calibrationEvidenceSchema.parse(input);
}

export function parseVariantSpec(input: unknown): VariantSpec {
  return variantSpecSchema.parse(input);
}

export function parseEpisodeRecord(input: unknown): EpisodeRecord {
  return episodeRecordSchema.parse(input);
}

export function parseEvaluationResult(input: unknown): EvaluationResult {
  return evaluationResultSchema.parse(input);
}

export function parsePairedEvaluationArtifact(input: unknown): PairedEvaluationArtifact {
  return pairedEvaluationArtifactSchema.parse(input);
}

export function parsePairedImpactReport(input: unknown): PairedImpactReport {
  return pairedImpactReportSchema.parse(input);
}
