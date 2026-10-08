import { z } from "zod";

import {
  diagnosticSchema,
  episodeRecordSchema,
  measurementValiditySchema,
  qualificationEvidenceSchema,
} from "../contracts/parsers.js";
import { COMMERCE_BEHAVIORS } from "../oracle/commerce-order.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_REF_PATTERN =
  /^artifact:\/\/campaign\/(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))(?!.*\/\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const idSchema = z.string().regex(ID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const dateTimeSchema = z.string().regex(DATE_TIME_PATTERN);
const artifactPointerSchema = z.strictObject({
  ref: z.string().regex(ARTIFACT_REF_PATTERN),
  sha256: sha256Schema,
});
const nullableCountSchema = z.number().finite().int().nonnegative().nullable();
const finiteCountSchema = z.number().finite().int().nonnegative();

export const commerceVariantSchema = z
  .strictObject({
    schema_version: z.literal(2),
    template_id: z.literal("commerce-order-cancellation-v1"),
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
    "Commerce Variant Goal rows must all match its frozen variant id",
  );

export const commerceExperimentSchema = z.strictObject({
  schema_version: z.literal(2),
  template_id: z.literal("commerce-order-cancellation-v1"),
  campaign_id: idSchema,
  created_at: dateTimeSchema,
  domain: z.literal("open-coding-commerce-delivery"),
  eval_pack_id: z.literal("open-coding-commerce-delivery-v1"),
  task_pack_digest: sha256Schema,
  control_variant_digest: sha256Schema,
  treatment_variant_digest: sha256Schema,
  deployment: z.strictObject({
    digest: sha256Schema,
    eval_package_sha256: sha256Schema,
    qualification: qualificationEvidenceSchema,
    qualification_projection: z
      .strictObject({
        source_deployment_digest: sha256Schema,
        projected_deployment_digest: sha256Schema,
        source_qualification_sha256: sha256Schema,
      })
      .optional(),
    grader_admission_sha256: sha256Schema,
  }),
  intervention: z.strictObject({
    id: z.literal("dsh-goal-stack"),
    allowed_config_paths: z.tuple([
      z.literal("goal.disabled"),
      z.literal("goal-round-driver.disabled"),
      z.literal("command-goal.disabled"),
      z.literal("tool-goal.disabled"),
    ]),
  }),
  arm_order: z.union([
    z.tuple([z.literal("control"), z.literal("treatment")]),
    z.tuple([z.literal("treatment"), z.literal("control")]),
  ]),
  timeout_ms_per_arm: z.number().finite().int().min(1).max(5_400_000),
  claim_strength: z.literal("diagnostic"),
  effect_claim_eligible: z.literal(false),
});

const commerceBehaviorVectorSchema = z.strictObject(
  Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [behavior, z.enum(["pass", "fail", "error"])]),
  ) as {
    [K in (typeof COMMERCE_BEHAVIORS)[number]]: z.ZodEnum<{
      pass: "pass";
      fail: "fail";
      error: "error";
    }>;
  },
);

export const commerceEvaluationResultSchema = z
  .strictObject({
    schema_version: z.literal(2),
    template_id: z.literal("commerce-order-cancellation-v1"),
    measurement_validity: measurementValiditySchema,
    outcome: z.strictObject({
      externally_verified_completion: z.boolean().nullable(),
      behavior_vector: commerceBehaviorVectorSchema,
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
    if (
      result.measurement_validity.dimensions.outcome !== "valid" ||
      COMMERCE_BEHAVIORS.some((behavior) => result.outcome.behavior_vector[behavior] !== "pass")
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "verified commerce completion requires every valid behavior to pass",
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
          message: `verified commerce completion requires ${gate}`,
        });
      }
    }
  });

const evaluatedArmSchema = z.strictObject({
  episode: artifactPointerSchema,
  oracle: artifactPointerSchema,
  candidate: z.strictObject({
    tree: z.string().regex(/^[0-9a-f]{40}$/),
    archive: artifactPointerSchema,
  }),
  result: commerceEvaluationResultSchema,
});

export const commercePairedEvaluationSchema = z.strictObject({
  schema_version: z.literal(2),
  template_id: z.literal("commerce-order-cancellation-v1"),
  campaign_id: idSchema,
  oracle_seed: artifactPointerSchema,
  measurement_validity: measurementValiditySchema,
  arms: z.strictObject({ control: evaluatedArmSchema, treatment: evaluatedArmSchema }),
});

const costDeltaSchema = z.strictObject({
  elapsed_ms: z.number().finite().int().nullable(),
  input_tokens: z.number().finite().int().nullable(),
  cached_input_tokens: z.number().finite().int().nullable(),
  output_tokens: z.number().finite().int().nullable(),
  failed_tool_calls: z.number().finite().int().nullable(),
});

export const commercePairedImpactReportSchema = z.strictObject({
  schema_version: z.literal(2),
  template_id: z.literal("commerce-order-cancellation-v1"),
  campaign_id: idSchema,
  experiment_digest: sha256Schema,
  measurement_validity: measurementValiditySchema,
  arms: z.strictObject({
    control: commerceEvaluationResultSchema,
    treatment: commerceEvaluationResultSchema,
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
    rationale_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(1),
  }),
  claim_strength: z.literal("diagnostic"),
  effect_claim_eligible: z.literal(false),
});

export type CommerceExperiment = z.infer<typeof commerceExperimentSchema>;
export type CommerceVariant = z.infer<typeof commerceVariantSchema>;
export type CommerceEpisode = z.infer<typeof episodeRecordSchema>;
export type CommerceEvaluationResult = z.infer<typeof commerceEvaluationResultSchema>;
export type CommercePairedEvaluation = z.infer<typeof commercePairedEvaluationSchema>;
export type CommercePairedImpactReport = z.infer<typeof commercePairedImpactReportSchema>;

export function parseCommerceExperiment(input: unknown): CommerceExperiment {
  return commerceExperimentSchema.parse(input);
}

export function parseCommerceVariant(input: unknown): CommerceVariant {
  return commerceVariantSchema.parse(input);
}

export function parseCommerceEpisode(input: unknown): CommerceEpisode {
  return episodeRecordSchema.parse(input);
}

export function parseCommerceEvaluationResult(input: unknown): CommerceEvaluationResult {
  return commerceEvaluationResultSchema.parse(input);
}

export function parseCommercePairedEvaluation(input: unknown): CommercePairedEvaluation {
  return commercePairedEvaluationSchema.parse(input);
}

export function parseCommercePairedImpactReport(input: unknown): CommercePairedImpactReport {
  return commercePairedImpactReportSchema.parse(input);
}

export { artifactPointerSchema, commerceBehaviorVectorSchema };
