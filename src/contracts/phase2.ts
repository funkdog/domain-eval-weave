import { z } from "zod";

import { parseArtifactRef } from "./artifact-ref.js";
import { canonicalJsonDigest } from "./canonical-json.js";
import { parseSuiteArtifactRef } from "./suite-artifact-ref.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const idSchema = z.string().regex(ID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const dateTimeSchema = z.iso.datetime({ offset: true });
const nonnegativeCountSchema = z.number().finite().int().nonnegative();

const uniqueStrings = <T extends z.ZodType<string>>(item: T) =>
  z
    .array(item)
    .min(1)
    .refine((values) => new Set(values).size === values.length, "values must be unique");

export const packageRelativeRefSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "ref must be a normalized package-relative path",
  );

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

const artifactPointerSchema = z.strictObject({ ref: artifactRefSchema, sha256: sha256Schema });
const suiteArtifactRefSchema = z.string().transform((value, context) => {
  try {
    return parseSuiteArtifactRef(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "invalid Suite artifact ref",
    });
    return z.NEVER;
  }
});
const suiteArtifactPointerSchema = z.strictObject({
  ref: suiteArtifactRefSchema,
  sha256: sha256Schema,
});
const bucketSchema = z.enum(["trigger", "non-trigger", "holdout"]);
const goalOperationSchema = z.enum([
  "create",
  "edit",
  "pause",
  "resume",
  "complete",
  "block",
  "clear",
]);
const goalPhaseSchema = z.enum(["active", "paused", "complete", "blocked", "none"]);

const goalRowsSchema = z.tuple([
  z.literal("goal"),
  z.literal("goal-round-driver"),
  z.literal("command-goal"),
  z.literal("tool-goal"),
]);
const allowedConfigPathsSchema = z.tuple([
  z.literal("goal.disabled"),
  z.literal("goal-round-driver.disabled"),
  z.literal("command-goal.disabled"),
  z.literal("tool-goal.disabled"),
]);

export const harnessManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  harness_id: z.literal("dsh-goal-stack"),
  harness_version: z.string().min(1),
  intervention: z.strictObject({
    rows: goalRowsSchema,
    allowed_config_paths: allowedConfigPathsSchema,
  }),
  activation: z.strictObject({
    source_event_type: z.literal("goal/change"),
    contract_version: z.literal(1),
  }),
  eval_binding: z.strictObject({
    eval_pack_id: z.literal("open-coding-goal-v1"),
    registry_ref: packageRelativeRefSchema,
    registry_sha256: sha256Schema,
    expectations: z.strictObject({
      trigger: z.literal("activation-required"),
      non_trigger: z.literal("activation-forbidden"),
      holdout: z.literal("task-defined"),
    }),
    holdout_policy: z.literal("first-model-exposure-only"),
  }),
});

const registryPointerSchema = z.strictObject({
  id: idSchema,
  ref: packageRelativeRefSchema,
  sha256: sha256Schema,
});

export const registrySchema = z
  .strictObject({
    schema_version: z.literal(1),
    registry_id: idSchema,
    eval_packs: z.array(registryPointerSchema).min(1),
    tasks: z.array(registryPointerSchema).min(3),
  })
  .superRefine((registry, context) => {
    for (const [field, pointers] of [
      ["eval_packs", registry.eval_packs],
      ["tasks", registry.tasks],
    ] as const) {
      for (const key of ["id", "ref"] as const) {
        if (new Set(pointers.map((pointer) => pointer[key])).size !== pointers.length) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${field} ${key}s must be unique`,
          });
        }
      }
    }
  });

export const evalPackSchema = z
  .strictObject({
    schema_version: z.literal(1),
    eval_pack_id: z.literal("open-coding-goal-v1"),
    domain: z.literal("open-coding-delivery"),
    harness_id: z.literal("dsh-goal-stack"),
    task_ids: uniqueStrings(idSchema),
    buckets: z.strictObject({
      trigger: uniqueStrings(idSchema),
      non_trigger: uniqueStrings(idSchema),
      holdout: uniqueStrings(idSchema),
    }),
    claim_strength: z.literal("multi_task_diagnostic"),
    effect_claim_eligible: z.literal(false),
  })
  .superRefine((pack, context) => {
    const bucketIds = [
      ...pack.buckets.trigger,
      ...pack.buckets.non_trigger,
      ...pack.buckets.holdout,
    ];
    if (
      new Set(bucketIds).size !== bucketIds.length ||
      [...bucketIds].sort().join("\n") !== [...pack.task_ids].sort().join("\n")
    ) {
      context.addIssue({
        code: "custom",
        path: ["buckets"],
        message: "each task id must belong to exactly one bucket",
      });
    }
  });

const overlaySchema = z.strictObject({
  source_ref: packageRelativeRefSchema,
  target_ref: packageRelativeRefSchema,
});
const behaviorKeySchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const taskEntrySchema = z
  .strictObject({
    schema_version: z.literal(1),
    task_id: idSchema,
    bucket: bucketSchema,
    public_task_ref: packageRelativeRefSchema,
    public_task_sha256: sha256Schema,
    base_ref: packageRelativeRefSchema,
    overlays: z.array(overlaySchema),
    effective_base_sha256: sha256Schema,
    allowed_candidate_globs: z.tuple([z.literal("src/**")]),
    forbidden_entry_types: z.tuple([z.literal("symlink"), z.literal("submodule")]),
    oracle: z.strictObject({
      runner_ref: packageRelativeRefSchema,
      runner_sha256: sha256Schema,
      version: z.literal("ledger-oracle-v2"),
      behavior_keys: uniqueStrings(behaviorKeySchema),
    }),
    activation_expectation: z.enum(["required", "forbidden", "observed"]),
  })
  .superRefine((task, context) => {
    const expected =
      task.bucket === "trigger"
        ? "required"
        : task.bucket === "non-trigger"
          ? "forbidden"
          : "observed";
    if (task.activation_expectation !== expected) {
      context.addIssue({
        code: "custom",
        path: ["activation_expectation"],
        message: `${task.bucket} task must use ${expected} activation expectation`,
      });
    }
    const targets = task.overlays.map((overlay) => overlay.target_ref);
    if (new Set(targets).size !== targets.length) {
      context.addIssue({
        code: "custom",
        path: ["overlays"],
        message: "overlay targets must be unique",
      });
    }
  });

const activationEventSchema = z.strictObject({
  sequence: nonnegativeCountSchema,
  source_event_type: z.literal("goal/change"),
  operation: goalOperationSchema,
  activation_type: z.enum(["activated", "progressed", "terminal", "cleared"]),
  goal_id: idSchema,
  revision: z.number().finite().int().positive(),
  phase: goalPhaseSchema,
  timestamp: dateTimeSchema,
});

const operationActivationType = {
  create: "activated",
  edit: "progressed",
  pause: "progressed",
  resume: "progressed",
  complete: "terminal",
  block: "terminal",
  clear: "cleared",
} as const;

export const activationArtifactSchema = z
  .strictObject({
    schema_version: z.literal(1),
    harness_id: z.literal("dsh-goal-stack"),
    session_id: idSchema,
    events: z.array(activationEventSchema),
    summary: z.strictObject({
      activated: z.boolean(),
      event_count: nonnegativeCountSchema,
      continuation_rounds: nonnegativeCountSchema,
      terminal_phase: goalPhaseSchema,
    }),
  })
  .superRefine((artifact, context) => {
    for (let index = 0; index < artifact.events.length; index += 1) {
      const event = artifact.events[index];
      if (event === undefined) continue;
      if (event.activation_type !== operationActivationType[event.operation]) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "activation_type"],
          message: "operation and activation type disagree",
        });
      }
    }
    if (
      artifact.summary.activated !== artifact.events.some((event) => event.operation === "create")
    ) {
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "activation summary does not match create events",
      });
    }
  });

export function assertActivationArtifactSemantics(artifact: ActivationArtifact): void {
  for (let index = 0; index < artifact.events.length; index += 1) {
    if (artifact.events[index]?.sequence !== index) {
      throw new Error("activation event sequences must be consecutive");
    }
  }
  const last = artifact.events.at(-1);
  if (
    artifact.summary.event_count !== artifact.events.length ||
    artifact.summary.terminal_phase !== (last?.phase ?? "none")
  ) {
    throw new Error("activation summary does not match ordered events");
  }
}

export const exposureRecordSchema = z
  .strictObject({
    schema_version: z.literal(1),
    exposure_id: idSchema,
    suite_id: idSchema,
    campaign_id: idSchema,
    episode_id: idSchema,
    session_id: idSchema,
    task_id: idSchema,
    bucket: bucketSchema,
    arm: z.enum(["control", "treatment"]),
    variant_digest: sha256Schema,
    public_task_sha256: sha256Schema,
    effective_base_sha256: sha256Schema,
    candidate_archive: artifactPointerSchema,
    registry_digest: sha256Schema,
    binding_digest: sha256Schema,
    started_at: dateTimeSchema,
    ended_at: dateTimeSchema,
  })
  .refine(
    (record) => Date.parse(record.started_at) <= Date.parse(record.ended_at),
    "exposure ended_at must not precede started_at",
  );

const suiteTaskSchema = z.strictObject({
  task_id: idSchema,
  bucket: bucketSchema,
  campaign_id: idSchema,
});

export const suiteManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    suite_id: idSchema,
    created_at: dateTimeSchema,
    instance_id: z.literal("clowder-ai"),
    harness_binding_digest: sha256Schema,
    registry_digest: sha256Schema,
    eval_pack_digest: sha256Schema,
    deployment_digest: sha256Schema,
    task_order: uniqueStrings(idSchema),
    tasks: z.array(suiteTaskSchema).length(3),
    timeout_ms_per_arm: z.number().finite().int().min(1).max(5_400_000),
    claim_strength: z.literal("multi_task_diagnostic"),
    effect_claim_eligible: z.literal(false),
  })
  .superRefine((suite, context) => {
    const buckets = suite.tasks.map((task) => task.bucket);
    if (new Set(buckets).size !== 3) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "Suite needs exactly one Task per bucket",
      });
    }
  });

export function assertSuiteManifestSemantics(suite: SuiteManifest): void {
  const taskIds = suite.tasks.map((task) => task.task_id);
  const campaignIds = suite.tasks.map((task) => task.campaign_id);
  if (
    new Set(taskIds).size !== taskIds.length ||
    new Set(campaignIds).size !== campaignIds.length ||
    taskIds.join("\n") !== suite.task_order.join("\n")
  ) {
    throw new Error("Suite tasks, order, and campaigns must be one-to-one");
  }
}

export const registrySnapshotSchema = z
  .strictObject({
    schema_version: z.literal(1),
    registry: registrySchema,
    eval_pack: evalPackSchema,
    tasks: z.array(taskEntrySchema).length(3),
    digests: z.strictObject({
      registry: sha256Schema,
      eval_pack: sha256Schema,
      tasks: z.record(idSchema, sha256Schema),
    }),
  })
  .superRefine((snapshot, context) => {
    if (canonicalJsonDigest(snapshot.registry) !== snapshot.digests.registry) {
      context.addIssue({
        code: "custom",
        path: ["digests", "registry"],
        message: "digest mismatch",
      });
    }
    if (canonicalJsonDigest(snapshot.eval_pack) !== snapshot.digests.eval_pack) {
      context.addIssue({
        code: "custom",
        path: ["digests", "eval_pack"],
        message: "digest mismatch",
      });
    }
    const tasks = new Map(snapshot.tasks.map((task) => [task.task_id, task]));
    const expectedIds = [...snapshot.eval_pack.task_ids].sort();
    const actualIds = [...tasks.keys()].sort();
    if (expectedIds.join("\n") !== actualIds.join("\n")) {
      context.addIssue({ code: "custom", path: ["tasks"], message: "Task set mismatch" });
    }
    if (Object.keys(snapshot.digests.tasks).sort().join("\n") !== actualIds.join("\n")) {
      context.addIssue({
        code: "custom",
        path: ["digests", "tasks"],
        message: "Task digest set mismatch",
      });
    }
    for (const task of snapshot.tasks) {
      if (canonicalJsonDigest(task) !== snapshot.digests.tasks[task.task_id]) {
        context.addIssue({
          code: "custom",
          path: ["digests", "tasks", task.task_id],
          message: "digest mismatch",
        });
      }
    }
    const registryEvalPack = snapshot.registry.eval_packs.find(
      (pointer) => pointer.id === snapshot.eval_pack.eval_pack_id,
    );
    if (registryEvalPack?.sha256 !== snapshot.digests.eval_pack) {
      context.addIssue({
        code: "custom",
        path: ["registry", "eval_packs"],
        message: "binding mismatch",
      });
    }
    for (const task of snapshot.tasks) {
      const pointer = snapshot.registry.tasks.find((candidate) => candidate.id === task.task_id);
      if (pointer?.sha256 !== snapshot.digests.tasks[task.task_id]) {
        context.addIssue({
          code: "custom",
          path: ["registry", "tasks"],
          message: "binding mismatch",
        });
      }
    }
  });

export const campaignPointerArtifactSchema = z.strictObject({
  schema_version: z.literal(1),
  suite_id: idSchema,
  task_id: idSchema,
  bucket: bucketSchema,
  campaign_id: idSchema,
  campaign_report: artifactPointerSchema,
  activation: z.strictObject({
    control: artifactPointerSchema,
    treatment: artifactPointerSchema,
  }),
  exposure: z.strictObject({
    control: artifactPointerSchema,
    treatment: artifactPointerSchema,
  }),
});

const suiteCostSchema = z.strictObject({
  elapsed_ms: nonnegativeCountSchema.nullable(),
  input_tokens: nonnegativeCountSchema.nullable(),
  cached_input_tokens: nonnegativeCountSchema.nullable(),
  output_tokens: nonnegativeCountSchema.nullable(),
  failed_tool_calls: nonnegativeCountSchema.nullable(),
});
const suiteCostDeltaSchema = z.strictObject({
  elapsed_ms: z.number().finite().int().nullable(),
  input_tokens: z.number().finite().int().nullable(),
  cached_input_tokens: z.number().finite().int().nullable(),
  output_tokens: z.number().finite().int().nullable(),
  failed_tool_calls: z.number().finite().int().nullable(),
});
const suiteArmSummarySchema = z.strictObject({
  externally_verified_completion: z.boolean().nullable(),
  completion_claim: z.enum(["complete", "blocked", "absent"]),
  goal_activated: z.boolean().nullable(),
  goal_rounds_started: nonnegativeCountSchema.nullable(),
  goal_terminal_phase: goalPhaseSchema.nullable(),
  cost: suiteCostSchema,
});
const activationAssessmentSchema = z.strictObject({
  status: z.enum(["pass", "fail", "insufficient", "invalid"]),
  code: z.enum([
    "ACTIVATION_EXPECTED_OBSERVED",
    "TRIGGER_ACTIVATION_MISSING",
    "NON_TRIGGER_ACTIVATION_ABSENT",
    "NON_TRIGGER_OVER_ACTIVATION",
    "HOLDOUT_ACTIVATION_OBSERVED",
    "HOLDOUT_ACTIVATION_ABSENT",
    "CONTROL_CONTAMINATION",
    "CAMPAIGN_INVALID",
  ]),
  treatment_activated: z.boolean(),
});
const suiteTaskEvaluationSchema = z.strictObject({
  task_id: idSchema,
  bucket: bucketSchema,
  campaign_id: idSchema,
  campaign_pointer: suiteArtifactPointerSchema,
  campaign_report: artifactPointerSchema,
  paired_overall: z.enum(["valid", "invalid", "insufficient"]),
  suite_overall: z.enum(["valid", "invalid", "insufficient"]),
  activation_assessment: activationAssessmentSchema,
  arms: z.strictObject({
    control: suiteArmSummarySchema,
    treatment: suiteArmSummarySchema,
  }),
  cost_delta: suiteCostDeltaSchema,
});
const suiteSummarySchema = z.strictObject({
  valid_task_count: nonnegativeCountSchema,
  invalid_task_count: nonnegativeCountSchema,
  insufficient_task_count: nonnegativeCountSchema,
  trigger_activation: z.boolean().nullable(),
  non_trigger_guardrail: z.enum(["pass", "fail"]).nullable(),
  holdout_activation_observed: z.boolean().nullable(),
});
const suiteValiditySchema = z.enum(["valid", "invalid", "insufficient"]);
const suiteReasonsSchema = z
  .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/))
  .refine((values) => new Set(values).size === values.length, "reason codes must be unique");

function validateSuiteEvaluationShape(
  suite: {
    readonly tasks: readonly {
      readonly task_id: string;
      readonly bucket: string;
      readonly suite_overall: string;
    }[];
    readonly summary: {
      readonly valid_task_count: number;
      readonly invalid_task_count: number;
      readonly insufficient_task_count: number;
    };
  },
  context: z.RefinementCtx,
): void {
  const taskIds = suite.tasks.map((task) => task.task_id);
  const buckets = suite.tasks.map((task) => task.bucket);
  const count = (status: string) =>
    suite.tasks.filter((task) => task.suite_overall === status).length;
  if (new Set(taskIds).size !== 3 || new Set(buckets).size !== 3) {
    context.addIssue({
      code: "custom",
      path: ["tasks"],
      message: "Suite needs one unique Task per bucket",
    });
  }
  if (
    suite.summary.valid_task_count !== count("valid") ||
    suite.summary.invalid_task_count !== count("invalid") ||
    suite.summary.insufficient_task_count !== count("insufficient")
  ) {
    context.addIssue({
      code: "custom",
      path: ["summary"],
      message: "Suite summary counts disagree",
    });
  }
}

export const suiteEvaluationArtifactSchema = z
  .strictObject({
    schema_version: z.literal(1),
    suite_id: idSchema,
    measurement_validity: suiteValiditySchema,
    reasons: suiteReasonsSchema,
    tasks: z.array(suiteTaskEvaluationSchema).length(3),
    summary: suiteSummarySchema,
    claim_strength: z.literal("multi_task_diagnostic"),
    effect_claim_eligible: z.literal(false),
  })
  .superRefine(validateSuiteEvaluationShape);

export const suiteReportSchema = z
  .strictObject({
    schema_version: z.literal(1),
    suite_id: idSchema,
    measurement_validity: suiteValiditySchema,
    reasons: suiteReasonsSchema,
    tasks: z.array(suiteTaskEvaluationSchema).length(3),
    summary: suiteSummarySchema,
    evidence: z.strictObject({
      manifest: suiteArtifactPointerSchema,
      binding: suiteArtifactPointerSchema,
      registry_snapshot: suiteArtifactPointerSchema,
      qualification: suiteArtifactPointerSchema,
      evaluation: suiteArtifactPointerSchema,
    }),
    recommendation: z.strictObject({
      action: z.enum(["keep", "iterate_binding", "keep_baseline", "run_more"]),
      rationale_codes: suiteReasonsSchema.min(1),
    }),
    claim_strength: z.literal("multi_task_diagnostic"),
    effect_claim_eligible: z.literal(false),
  })
  .superRefine(validateSuiteEvaluationShape);

const suiteInvalidEnvelopeBase = {
  schema_version: z.literal(1),
  suite_id: idSchema,
  measurement_validity: z.literal("invalid"),
  claim_strength: z.literal("multi_task_diagnostic"),
  effect_claim_eligible: z.literal(false),
} as const;

export const suiteInvalidEnvelopeSchema = z.discriminatedUnion("reason", [
  z.strictObject({
    ...suiteInvalidEnvelopeBase,
    reason: z.literal("ARTIFACT_INTEGRITY_FAILURE"),
    message: z.literal("Frozen Suite evidence failed integrity or semantic replay."),
  }),
  z.strictObject({
    ...suiteInvalidEnvelopeBase,
    reason: z.literal("TASK_INFRASTRUCTURE_FAILURE"),
    message: z.literal("Suite task measurement failed before a valid report could be produced."),
  }),
]);

export type HarnessManifest = z.infer<typeof harnessManifestSchema>;
export type Registry = z.infer<typeof registrySchema>;
export type EvalPack = z.infer<typeof evalPackSchema>;
export type TaskEntry = z.infer<typeof taskEntrySchema>;
export type ActivationArtifact = z.infer<typeof activationArtifactSchema>;
export type ExposureRecord = z.infer<typeof exposureRecordSchema>;
export type SuiteManifest = z.infer<typeof suiteManifestSchema>;
export type RegistrySnapshot = z.infer<typeof registrySnapshotSchema>;
export type CampaignPointerArtifact = z.infer<typeof campaignPointerArtifactSchema>;
export type SuiteTaskEvaluation = z.infer<typeof suiteTaskEvaluationSchema>;
export type SuiteEvaluationArtifact = z.infer<typeof suiteEvaluationArtifactSchema>;
export type SuiteReport = z.infer<typeof suiteReportSchema>;
export type SuiteInvalidEnvelope = z.infer<typeof suiteInvalidEnvelopeSchema>;

export const parseHarnessManifest = (input: unknown): HarnessManifest =>
  harnessManifestSchema.parse(input);
export const parseRegistry = (input: unknown): Registry => registrySchema.parse(input);
export const parseEvalPack = (input: unknown): EvalPack => evalPackSchema.parse(input);
export const parseTaskEntry = (input: unknown): TaskEntry => taskEntrySchema.parse(input);
export const parseActivationArtifact = (input: unknown): ActivationArtifact =>
  activationArtifactSchema.parse(input);
export const parseExposureRecord = (input: unknown): ExposureRecord =>
  exposureRecordSchema.parse(input);
export const parseSuiteManifest = (input: unknown): SuiteManifest =>
  suiteManifestSchema.parse(input);
export const parseRegistrySnapshot = (input: unknown): RegistrySnapshot =>
  registrySnapshotSchema.parse(input);
export const parseCampaignPointerArtifact = (input: unknown): CampaignPointerArtifact =>
  campaignPointerArtifactSchema.parse(input);
export const parseSuiteEvaluationArtifact = (input: unknown): SuiteEvaluationArtifact =>
  suiteEvaluationArtifactSchema.parse(input);
export const parseSuiteReport = (input: unknown): SuiteReport => suiteReportSchema.parse(input);
export const parseSuiteInvalidEnvelope = (input: unknown): SuiteInvalidEnvelope =>
  suiteInvalidEnvelopeSchema.parse(input);
