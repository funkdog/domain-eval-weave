import { z } from "zod";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const idSchema = z.string().regex(ID_PATTERN);
const versionSchema = z.string().regex(VERSION_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const riskSchema = z.enum(["low", "medium", "high", "critical"]);
const relativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("://") &&
      !value.split("/").some((part) => part === "" || part === "." || part === ".."),
    "path must be normalized, relative, and contained",
  );

function uniqueStrings(minimum = 0) {
  return z
    .array(idSchema)
    .min(minimum)
    .refine((values) => new Set(values).size === values.length, "ids must be unique");
}

function uniqueBy<T extends z.ZodType>(schema: T, key: (value: z.infer<T>) => string) {
  return z
    .array(schema)
    .refine((values) => new Set(values.map(key)).size === values.length, "entries must be unique");
}

export const capsuleSourceSchema = z.strictObject({
  source_id: idSchema,
  kind: z.enum([
    "owner_statement",
    "requirement",
    "product_doc",
    "external_contract",
    "code",
    "test",
    "runtime_observation",
    "domain_knowledge",
  ]),
  path: relativePathSchema,
  description: z.string().min(1).max(512).optional(),
  license: z.string().min(1).max(128).optional(),
});

export const capsuleCandidateSchema = z.strictObject({
  candidate_id: idSchema,
  path: relativePathSchema,
  command: z.array(z.string().min(1).max(512)).min(1).max(32),
  timeout_ms: z.number().finite().int().positive().max(120_000).default(10_000),
  max_output_bytes: z
    .number()
    .finite()
    .int()
    .positive()
    .max(4 * 1024 * 1024)
    .default(256 * 1024),
});

export const capsuleManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    capsule_id: idSchema,
    version: versionSchema,
    title: z.string().min(1).max(256),
    domain: relativePathSchema,
    sources: uniqueBy(capsuleSourceSchema, (value) => value.source_id),
    requirements: z.array(relativePathSchema),
    evaluators: z.array(relativePathSchema),
    candidates: uniqueBy(capsuleCandidateSchema, (value) => value.candidate_id),
    cases: z.array(relativePathSchema),
  })
  .superRefine((manifest, context) => {
    for (const [field, values] of [
      ["requirements", manifest.requirements],
      ["evaluators", manifest.evaluators],
      ["cases", manifest.cases],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path: [field], message: `${field} must be unique` });
      }
    }
    const paths = [
      manifest.domain,
      ...manifest.sources.map((source) => source.path),
      ...manifest.requirements,
      ...manifest.evaluators,
      ...manifest.candidates.map((candidate) => candidate.path),
      ...manifest.cases,
    ];
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: "custom", path: [], message: "manifest paths must be unique" });
    }
  });

const confirmationSchema = z.strictObject({
  owner_id: idSchema,
  projection_sha256: sha256Schema,
});

const claimSchema = z
  .strictObject({
    claim_id: idSchema,
    statement: z.string().min(1),
    applicability: z.string().min(1),
    status: z.enum(["confirmed", "proposed", "unresolved", "conflicted", "observability_gap"]),
    source_ids: uniqueStrings(1),
    false_accept_risk: riskSchema,
    false_reject_risk: riskSchema,
    confirmation: confirmationSchema.optional(),
    conflict_source_ids: uniqueStrings(2).optional(),
  })
  .superRefine((claim, context) => {
    if (claim.status === "confirmed") {
      if (claim.confirmation === undefined) {
        context.addIssue({
          code: "custom",
          path: ["confirmation"],
          message: "confirmed claims require explicit owner confirmation",
        });
      }
    } else if (claim.confirmation !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "non-confirmed claims cannot carry confirmation",
      });
    }
    if (claim.status === "conflicted") {
      if (claim.conflict_source_ids === undefined) {
        context.addIssue({
          code: "custom",
          path: ["conflict_source_ids"],
          message: "conflicted claims require at least two conflict sources",
        });
      }
    } else if (claim.conflict_source_ids !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["conflict_source_ids"],
        message: "only conflicted claims can carry conflict sources",
      });
    }
  });

export const capsuleDomainSchema = z
  .strictObject({
    schema_version: z.literal(1),
    domain_id: idSchema,
    version: versionSchema,
    owners: uniqueBy(
      z.strictObject({ owner_id: idSchema, display_name: z.string().min(1).max(256) }),
      (value) => value.owner_id,
    ).min(1),
    claims: uniqueBy(claimSchema, (value) => value.claim_id),
  })
  .superRefine((domain, context) => {
    const owners = new Set(domain.owners.map((owner) => owner.owner_id));
    for (const [index, claim] of domain.claims.entries()) {
      if (claim.confirmation !== undefined && !owners.has(claim.confirmation.owner_id)) {
        context.addIssue({
          code: "custom",
          path: ["claims", index, "confirmation", "owner_id"],
          message: "confirmation owner must be declared by the domain",
        });
      }
      for (const conflictSource of claim.conflict_source_ids ?? []) {
        if (!claim.source_ids.includes(conflictSource)) {
          context.addIssue({
            code: "custom",
            path: ["claims", index, "conflict_source_ids"],
            message: "conflict sources must also appear in source_ids",
          });
        }
      }
    }
  });

const requirementEdgeSchema = z.strictObject({
  claim_id: idSchema,
  relation: z.enum(["uses", "preserves", "introduces", "modifies", "deprecates", "conflicts_with"]),
  required: z.boolean(),
});

export const requirementDeltaSchema = z.strictObject({
  schema_version: z.literal(1),
  requirement_id: idSchema,
  version: versionSchema,
  title: z.string().min(1).max(256),
  source_ids: uniqueStrings(1),
  edges: uniqueBy(requirementEdgeSchema, (value) => `${value.claim_id}:${value.relation}`).min(1),
});

const exitCodeCheckSchema = z.strictObject({
  check_id: idSchema,
  claim_id: idSchema,
  kind: z.literal("exit_code_equals"),
  expected: z.number().finite().int(),
});

const jsonPathCheckSchema = z.strictObject({
  check_id: idSchema,
  claim_id: idSchema,
  kind: z.literal("json_path_equals"),
  path: z
    .array(z.union([z.string().min(1).max(128), z.number().finite().int().nonnegative()]))
    .min(1),
  expected: z.json(),
});

const arrayCountCheckSchema = z.strictObject({
  check_id: idSchema,
  claim_id: idSchema,
  kind: z.literal("json_array_count_equals"),
  path: z
    .array(z.union([z.string().min(1).max(128), z.number().finite().int().nonnegative()]))
    .min(1),
  where: z.record(
    z.string().min(1).max(128),
    z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
  ),
  expected_count: z.number().finite().int().nonnegative(),
});

export const evaluatorCheckSchema = z.discriminatedUnion("kind", [
  exitCodeCheckSchema,
  jsonPathCheckSchema,
  arrayCountCheckSchema,
]);

export const evaluatorPackageSchema = z.strictObject({
  schema_version: z.literal(1),
  evaluator_id: idSchema,
  version: versionSchema,
  requirement_id: idSchema,
  description: z.string().min(1).max(512).optional(),
  checks: uniqueBy(evaluatorCheckSchema, (value) => value.check_id).min(1),
});

const expectedClaimSchema = z.strictObject({
  claim_id: idSchema,
  status: z.enum(["pass", "fail", "inconclusive", "measurement_error"]),
});

export const calibrationCaseSchema = z
  .strictObject({
    schema_version: z.literal(1),
    case_id: idSchema,
    kind: z.enum(["gold", "equivalent", "mutant"]),
    candidate_id: idSchema,
    target_claim_ids: uniqueStrings(1).optional(),
    expected_claims: uniqueBy(expectedClaimSchema, (value) => value.claim_id).min(1),
  })
  .superRefine((calibrationCase, context) => {
    if (calibrationCase.kind === "mutant") {
      if (calibrationCase.target_claim_ids === undefined) {
        context.addIssue({
          code: "custom",
          path: ["target_claim_ids"],
          message: "mutants require target Claim ids",
        });
      }
    } else if (calibrationCase.target_claim_ids !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["target_claim_ids"],
        message: "only mutants carry target Claim ids",
      });
    }
  });

const diagnosticSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1),
  locator: z.string().min(1).optional(),
});

const claimResultSchema = z.strictObject({
  claim_id: idSchema,
  axis: z.enum(["requirement_delta", "domain_preservation"]),
  status: z.enum(["pass", "fail", "inconclusive", "measurement_error"]),
  check_ids: uniqueStrings(),
  diagnostics: z.array(diagnosticSchema),
});

export const evaluationRunSchema = z.strictObject({
  schema_version: z.literal(1),
  run_id: idSchema,
  capsule_release_sha256: sha256Schema,
  requirement_id: idSchema,
  evaluator: z.strictObject({ evaluator_id: idSchema, version: versionSchema }),
  candidate_id: idSchema,
  candidate_sha256: sha256Schema,
  measurement_validity: z.enum(["valid", "insufficient", "invalid"]),
  verdict: z.enum(["accept", "reject", "inconclusive"]),
  claims: uniqueBy(claimResultSchema, (value) => value.claim_id),
  execution: z.strictObject({
    exit_code: z.number().finite().int().nullable(),
    signal: z.string().min(1).nullable(),
    stdout_sha256: sha256Schema,
    stderr_sha256: sha256Schema,
    timed_out: z.boolean(),
    output_limit_exceeded: z.boolean(),
  }),
  diagnostics: z.array(diagnosticSchema),
});

const releaseEntrySchema = z.strictObject({
  path: relativePathSchema,
  sha256: sha256Schema,
  size: z.number().finite().int().nonnegative(),
});

export const capsuleReleaseSchema = z.strictObject({
  schema_version: z.literal(1),
  capsule_id: idSchema,
  capsule_version: versionSchema,
  entries: z.array(releaseEntrySchema).min(1),
  derived: z.strictObject({
    claims: uniqueStrings(),
    requirement_edges: z.array(
      z.strictObject({
        requirement_id: idSchema,
        claim_id: idSchema,
        relation: requirementEdgeSchema.shape.relation,
        required: z.boolean(),
      }),
    ),
  }),
});

export type CapsuleManifest = z.infer<typeof capsuleManifestSchema>;
export type CapsuleDomain = z.infer<typeof capsuleDomainSchema>;
export type RequirementDelta = z.infer<typeof requirementDeltaSchema>;
export type EvaluatorPackage = z.infer<typeof evaluatorPackageSchema>;
export type EvaluatorCheck = z.infer<typeof evaluatorCheckSchema>;
export type CalibrationCase = z.infer<typeof calibrationCaseSchema>;
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;
export type CapsuleRelease = z.infer<typeof capsuleReleaseSchema>;

export const parseCapsuleManifest = (input: unknown): CapsuleManifest =>
  capsuleManifestSchema.parse(input);
export const parseCapsuleDomain = (input: unknown): CapsuleDomain =>
  capsuleDomainSchema.parse(input);
export const parseRequirementDelta = (input: unknown): RequirementDelta =>
  requirementDeltaSchema.parse(input);
export const parseEvaluatorPackage = (input: unknown): EvaluatorPackage =>
  evaluatorPackageSchema.parse(input);
export const parseCalibrationCase = (input: unknown): CalibrationCase =>
  calibrationCaseSchema.parse(input);
export const parseEvaluationRun = (input: unknown): EvaluationRun =>
  evaluationRunSchema.parse(input);
export const parseCapsuleRelease = (input: unknown): CapsuleRelease =>
  capsuleReleaseSchema.parse(input);

export function claimConfirmationProjection(claim: CapsuleDomain["claims"][number]): unknown {
  return {
    claim_id: claim.claim_id,
    statement: claim.statement,
    applicability: claim.applicability,
    source_ids: claim.source_ids,
    false_accept_risk: claim.false_accept_risk,
    false_reject_risk: claim.false_reject_risk,
  };
}
