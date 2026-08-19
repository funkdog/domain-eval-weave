import { z } from "zod";

import { packageRelativeRefSchema } from "../contracts/phase2.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NODE_ID_PATTERN = /^(?:claim|proposal|requirement):[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DIAGNOSTIC_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const idSchema = z.string().regex(ID_PATTERN);
const nodeIdSchema = z.string().regex(NODE_ID_PATTERN);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const dateTimeSchema = z.iso.datetime({ offset: true });
const riskSchema = z.enum(["low", "medium", "high", "critical"]);

const unique = <T extends z.ZodType>(item: T, minimum = 0) =>
  z
    .array(item)
    .min(minimum)
    .refine(
      (values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length,
      "values must be unique",
    );

const uniqueIds = (minimum = 0) =>
  z
    .array(idSchema)
    .min(minimum)
    .refine((values) => new Set(values).size === values.length, {
      message: "ids must be unique",
    });

export const domainPackPointerSchema = z.strictObject({
  ref: packageRelativeRefSchema,
  sha256: sha256Schema,
});

export const ownerConfirmationPointerSchema = z.strictObject({
  confirmation_id: idSchema,
  sha256: sha256Schema,
});

export const domainSourceRefSchema = z.strictObject({
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
  artifact_ref: packageRelativeRefSchema,
  digest: sha256Schema,
  locator: z
    .string()
    .min(1)
    .max(512)
    .refine((value) => !value.includes("\\") && !value.includes("://"), {
      message: "locator must be a portable anchor, JSON pointer, or symbol",
    })
    .optional(),
});

export const ownerConfirmationEventSchema = z
  .strictObject({
    schema_version: z.literal(1),
    confirmation_id: idSchema,
    actor_id: idSchema,
    authority_scope: z.strictObject({
      product_id: idSchema,
      domain_ids: uniqueIds(),
    }),
    target: z.strictObject({
      kind: z.enum([
        "evidence_card",
        "product_domain_contract",
        "requirement_change_set",
        "decision_question",
      ]),
      object_id: idSchema,
      object_version: z.number().finite().int().positive().optional(),
      projection_sha256: sha256Schema,
    }),
    decision: z.literal("confirm"),
    origin: z.strictObject({
      kind: z.literal("management_cli_operator_invocation"),
      profile: z.literal("eval-clowder"),
      command: z.literal("confirm"),
      invocation_sha256: sha256Schema,
    }),
    supporting_source_ref: domainSourceRefSchema.optional(),
    occurred_at: dateTimeSchema,
  })
  .superRefine((event, context) => {
    if (event.origin.command !== event.decision) {
      context.addIssue({
        code: "custom",
        path: ["origin", "command"],
        message: "management command must match the recorded decision",
      });
    }
  });

const evidenceStatusSchema = z.enum([
  "confirmed",
  "proposed",
  "unresolved",
  "conflicted",
  "observability_gap",
]);

export const domainEvidenceCardSchema = z
  .strictObject({
    schema_version: z.literal(1),
    card_id: idSchema,
    revision: z.number().finite().int().positive(),
    predecessor: domainPackPointerSchema.optional(),
    product_id: idSchema,
    domain_id: idSchema,
    claim_id: idSchema,
    statement: z.string().min(1),
    applicability: z.string().min(1),
    status: evidenceStatusSchema,
    source_refs: z.array(domainSourceRefSchema).min(1),
    authority_ref_ids: uniqueIds(),
    observation_ref_ids: uniqueIds(),
    false_accept_risk: riskSchema,
    false_reject_risk: riskSchema,
    confirmation: ownerConfirmationPointerSchema.optional(),
    conflict: z
      .strictObject({
        source_ref_ids: uniqueIds(2),
        reason: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((card, context) => {
    if ((card.revision === 1) === (card.predecessor !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["predecessor"],
        message: "only later Evidence Card revisions require a predecessor",
      });
    }
    const sources = new Map(card.source_refs.map((source) => [source.source_id, source]));
    if (sources.size !== card.source_refs.length) {
      context.addIssue({
        code: "custom",
        path: ["source_refs"],
        message: "source ids must be unique",
      });
    }
    for (const [field, ids] of [
      ["authority_ref_ids", card.authority_ref_ids],
      ["observation_ref_ids", card.observation_ref_ids],
    ] as const) {
      for (const id of ids) {
        if (!sources.has(id)) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${field} must reference source_refs`,
          });
        }
      }
    }

    if (card.status === "confirmed") {
      if (card.confirmation === undefined) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "confirmed cards require an OwnerConfirmationEvent pointer",
        });
      }
      if (card.authority_ref_ids.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["authority_ref_ids"],
          message: "confirmed cards require authority",
        });
      }
      if (
        card.authority_ref_ids.length > 0 &&
        card.authority_ref_ids.every((id) => sources.get(id)?.kind === "domain_knowledge")
      ) {
        context.addIssue({
          code: "custom",
          path: ["authority_ref_ids"],
          message: "domain knowledge alone cannot confirm product truth",
        });
      }
    } else if (card.confirmation !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "non-confirmed cards cannot carry a confirmation pointer",
      });
    }

    if (card.status === "conflicted") {
      if (card.conflict === undefined) {
        context.addIssue({
          code: "custom",
          path: ["conflict"],
          message: "conflicted cards require conflict evidence",
        });
      } else {
        for (const id of card.conflict.source_ref_ids) {
          if (!sources.has(id)) {
            context.addIssue({
              code: "custom",
              path: ["conflict"],
              message: "conflict sources must exist",
            });
          }
        }
      }
    } else if (card.conflict !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["conflict"],
        message: "only conflicted cards may carry conflict evidence",
      });
    }

    if (card.status === "observability_gap" && card.observation_ref_ids.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["observation_ref_ids"],
        message: "observability gaps cannot name an authoritative observation",
      });
    }
  });

const interviewTurnSchema = z.strictObject({
  turn_id: idSchema,
  question_id: idSchema,
  question: z.string().min(1),
  reason: z.string().min(1),
  source_ref_ids: uniqueIds(),
  blocked_claim_ids: uniqueIds(),
  answer: z.string().min(1).optional(),
  answer_ref_id: idSchema.optional(),
  status: z.enum(["asked", "answered", "skipped"]),
});

export const domainDecisionQuestionSchema = z
  .strictObject({
    schema_version: z.literal(1),
    question_id: idSchema,
    revision: z.number().finite().int().positive(),
    predecessor: domainPackPointerSchema.optional(),
    product_id: idSchema,
    requirement_id: idSchema.optional(),
    question: z.string().min(1),
    reason: z.string().min(1),
    blocked_claim_ids: uniqueIds(1),
    risk: riskSchema,
    blocking: z.boolean(),
    status: z.enum(["open", "resolved"]),
    resolution_confirmation: ownerConfirmationPointerSchema.optional(),
  })
  .superRefine((question, context) => {
    if ((question.revision === 1) === (question.predecessor !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["predecessor"],
        message: "only later DecisionQuestion revisions require a predecessor",
      });
    }
    if ((question.status === "open") === (question.resolution_confirmation !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["resolution_confirmation"],
        message: "resolved questions require confirmation; open questions forbid it",
      });
    }
  });

export const domainInterviewSessionSchema = z
  .strictObject({
    schema_version: z.literal(1),
    interview_id: idSchema,
    revision: z.number().finite().int().positive(),
    predecessor: domainPackPointerSchema.optional(),
    mode: z.enum(["onboard", "delta", "audit"]),
    product_id: idSchema,
    domain_ids: uniqueIds(1),
    base_contract: domainPackPointerSchema.optional(),
    requirement_ref: domainSourceRefSchema.optional(),
    source_snapshot: z.array(domainSourceRefSchema).min(1),
    turns: z.array(interviewTurnSchema),
    evidence_card_refs: unique(domainPackPointerSchema),
    decision_question_refs: unique(domainPackPointerSchema),
    status: z.enum(["draft", "awaiting_owner", "completed", "aborted"]),
    started_at: dateTimeSchema,
    ended_at: dateTimeSchema.optional(),
  })
  .superRefine((session, context) => {
    if ((session.revision === 1) === (session.predecessor !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["predecessor"],
        message: "only later InterviewSession revisions require a predecessor",
      });
    }
    const sourceIds = new Set(session.source_snapshot.map((source) => source.source_id));
    if (sourceIds.size !== session.source_snapshot.length) {
      context.addIssue({
        code: "custom",
        path: ["source_snapshot"],
        message: "source ids must be unique",
      });
    }
    for (const [index, turn] of session.turns.entries()) {
      for (const sourceId of turn.source_ref_ids) {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            path: ["turns", index],
            message: "turn source must exist",
          });
        }
      }
      if (turn.status === "answered") {
        if (
          turn.answer === undefined ||
          turn.answer_ref_id === undefined ||
          !sourceIds.has(turn.answer_ref_id)
        ) {
          context.addIssue({
            code: "custom",
            path: ["turns", index],
            message: "answered turn requires persisted answer text and an answer source",
          });
        }
      } else if (turn.answer !== undefined || turn.answer_ref_id !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["turns", index],
          message: "unanswered turn cannot carry an answer or answer source",
        });
      }
    }
    for (const [field, values] of [
      ["turn_id", session.turns.map((turn) => turn.turn_id)],
      ["question_id", session.turns.map((turn) => turn.question_id)],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path: ["turns"], message: `${field}s must be unique` });
      }
    }
    const requiresEnd = session.status === "completed" || session.status === "aborted";
    if (requiresEnd !== (session.ended_at !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["ended_at"],
        message: "terminal interview status must match ended_at",
      });
    }
    if (
      session.ended_at !== undefined &&
      Date.parse(session.started_at) > Date.parse(session.ended_at)
    ) {
      context.addIssue({
        code: "custom",
        path: ["ended_at"],
        message: "interview ended_at precedes started_at",
      });
    }
    if (session.mode === "onboard" && session.base_contract !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["base_contract"],
        message: "onboard cannot pin an existing contract",
      });
    }
    if (session.mode !== "onboard" && session.base_contract === undefined) {
      context.addIssue({
        code: "custom",
        path: ["base_contract"],
        message: "delta/audit require a base contract",
      });
    }
  });

const contractClaimRefSchema = z.strictObject({
  claim_id: idSchema,
  contract_version: z.number().finite().int().positive(),
});

const claimTransitionSchema = z.strictObject({
  kind: z.enum(["supersedes", "retires"]),
  predecessor: contractClaimRefSchema,
});

const productDomainClaimSchema = z.strictObject({
  claim_id: idSchema,
  domain_id: idSchema,
  statement: z.string().min(1),
  applicability: z.string().min(1),
  evidence_card: domainPackPointerSchema,
  authority_refs: z.array(domainSourceRefSchema).min(1),
  observation_refs: z.array(domainSourceRefSchema),
  false_accept_risk: riskSchema,
  false_reject_risk: riskSchema,
  dependencies: unique(contractClaimRefSchema),
  lifecycle: z.enum(["active", "retired"]),
  transition: claimTransitionSchema.optional(),
});

const productDomainContractCandidateCoreSchema = z.strictObject({
  schema_version: z.literal(1),
  contract_id: idSchema,
  product_id: idSchema,
  version: z.number().finite().int().positive(),
  predecessor: domainPackPointerSchema.optional(),
  source_snapshot_digest: sha256Schema,
  claims: z.array(productDomainClaimSchema).min(1),
});

function validateContractCandidate(
  contract: z.infer<typeof productDomainContractCandidateCoreSchema>,
  context: z.RefinementCtx,
): void {
  const claimIds = new Set(contract.claims.map((claim) => claim.claim_id));
  if (claimIds.size !== contract.claims.length) {
    context.addIssue({ code: "custom", path: ["claims"], message: "claim ids must be unique" });
  }
  for (const [index, claim] of contract.claims.entries()) {
    if (claim.dependencies.some((dependency) => dependency.claim_id === claim.claim_id)) {
      context.addIssue({
        code: "custom",
        path: ["claims", index],
        message: "claim cannot depend on itself",
      });
    }
    for (const dependency of claim.dependencies) {
      if (!claimIds.has(dependency.claim_id) || dependency.contract_version !== contract.version) {
        context.addIssue({
          code: "custom",
          path: ["claims", index],
          message: "claim dependency must exist",
        });
      }
    }
    const authorityKinds = claim.authority_refs.map((source) => source.kind);
    if (authorityKinds.every((kind) => kind === "domain_knowledge")) {
      context.addIssue({
        code: "custom",
        path: ["claims", index],
        message: "contract truth cannot rely only on domain knowledge",
      });
    }
    if (claim.transition === undefined) {
      if (contract.version > 1 && claim.lifecycle === "retired") {
        context.addIssue({
          code: "custom",
          path: ["claims", index, "transition"],
          message: "retired Claims require an explicit transition",
        });
      }
    } else if (
      contract.version === 1 ||
      claim.transition.predecessor.claim_id !== claim.claim_id ||
      claim.transition.predecessor.contract_version >= contract.version ||
      (claim.transition.kind === "retires") !== (claim.lifecycle === "retired")
    ) {
      context.addIssue({
        code: "custom",
        path: ["claims", index, "transition"],
        message: "Claim transition does not match version/lifecycle",
      });
    }
  }
  if (contract.version === 1 && contract.predecessor !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["predecessor"],
      message: "version 1 cannot have a predecessor",
    });
  }
  if (contract.version > 1 && contract.predecessor === undefined) {
    context.addIssue({
      code: "custom",
      path: ["predecessor"],
      message: "later versions require a predecessor",
    });
  }
}

export const productDomainContractCandidateSchema =
  productDomainContractCandidateCoreSchema.superRefine(validateContractCandidate);

export const productDomainContractSchema = productDomainContractCandidateCoreSchema
  .safeExtend({
    state: z.literal("issued"),
    confirmation: ownerConfirmationPointerSchema,
    decided_by: idSchema,
    decided_at: dateTimeSchema,
  })
  .superRefine(validateContractCandidate);

const claimRefSchema = contractClaimRefSchema;

const proposedClaimSchema = z.strictObject({
  claim_id: idSchema,
  domain_id: idSchema,
  statement: z.string().min(1),
  applicability: z.string().min(1),
  source_ref_ids: uniqueIds(1),
});

const claimModificationSchema = z.strictObject({
  claim: claimRefSchema,
  proposed: proposedClaimSchema,
  reason: z.string().min(1),
});

const claimConflictSchema = z.strictObject({
  claim: claimRefSchema,
  reason: z.string().min(1),
  source_ref_ids: uniqueIds(1),
});

export const requirementChangeSetSchema = z
  .strictObject({
    schema_version: z.literal(1),
    requirement_id: idSchema,
    version: z.number().finite().int().positive(),
    predecessor: domainPackPointerSchema.optional(),
    product_id: idSchema,
    requirement_refs: z.array(domainSourceRefSchema).min(1),
    base_contract: domainPackPointerSchema,
    effects: z.strictObject({
      uses: unique(claimRefSchema),
      preserves: unique(claimRefSchema),
      introduces: unique(proposedClaimSchema),
      modifies: unique(claimModificationSchema),
      deprecates: unique(claimRefSchema),
      conflicts_with: unique(claimConflictSchema),
    }),
    decision_question_refs: unique(domainPackPointerSchema),
    status: z.enum(["draft", "owner_confirmed"]),
    confirmation: ownerConfirmationPointerSchema.optional(),
  })
  .superRefine((requirement, context) => {
    if ((requirement.version === 1) === (requirement.predecessor !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["predecessor"],
        message: "only later Requirement versions require a predecessor",
      });
    }
    const sourceIds = new Set(requirement.requirement_refs.map((source) => source.source_id));
    if (sourceIds.size !== requirement.requirement_refs.length) {
      context.addIssue({
        code: "custom",
        path: ["requirement_refs"],
        message: "source ids must be unique",
      });
    }
    for (const proposed of [
      ...requirement.effects.introduces,
      ...requirement.effects.modifies.map((modification) => modification.proposed),
    ]) {
      for (const sourceId of proposed.source_ref_ids) {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            path: ["effects"],
            message: "proposed claim source must exist",
          });
        }
      }
    }
    for (const conflict of requirement.effects.conflicts_with) {
      for (const sourceId of conflict.source_ref_ids) {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: "custom",
            path: ["effects", "conflicts_with"],
            message: "conflict source must exist",
          });
        }
      }
    }
    if (requirement.status === "owner_confirmed") {
      if (requirement.confirmation === undefined) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message: "owner-confirmed requirements need a confirmation event",
        });
      }
    } else if (requirement.confirmation !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "draft requirements cannot carry confirmation",
      });
    }
  });

const graphNodeSchema = z.strictObject({
  node_id: nodeIdSchema,
  kind: z.enum(["contract_claim", "historical_claim", "proposed_claim", "requirement"]),
  object_id: idSchema,
  object_version: z.number().finite().int().positive(),
  domain_id: idSchema.optional(),
});

const graphEdgeSchema = z.strictObject({
  from: nodeIdSchema,
  to: nodeIdSchema,
  kind: z.enum([
    "depends_on",
    "uses",
    "preserves",
    "introduces",
    "modifies",
    "deprecates",
    "conflicts_with",
    "supersedes",
    "retires",
  ]),
});

export const claimDependencyGraphSchema = z
  .strictObject({
    schema_version: z.literal(1),
    graph_id: idSchema,
    product_id: idSchema,
    contract: domainPackPointerSchema,
    requirements: unique(domainPackPointerSchema),
    nodes: z.array(graphNodeSchema).min(1),
    edges: unique(graphEdgeSchema),
    reverse_index: z.record(nodeIdSchema, z.array(nodeIdSchema).min(1)),
  })
  .superRefine((graph, context) => {
    const nodeIds = new Set(graph.nodes.map((node) => node.node_id));
    if (nodeIds.size !== graph.nodes.length) {
      context.addIssue({ code: "custom", path: ["nodes"], message: "node ids must be unique" });
    }
    for (const [index, edge] of graph.edges.entries()) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "edge endpoints must exist",
        });
      }
    }
    for (const [target, sources] of Object.entries(graph.reverse_index)) {
      if (!nodeIds.has(target) || sources.some((source) => !nodeIds.has(source))) {
        context.addIssue({
          code: "custom",
          path: ["reverse_index"],
          message: "reverse index nodes must exist",
        });
      }
      if (new Set(sources).size !== sources.length) {
        context.addIssue({
          code: "custom",
          path: ["reverse_index", target],
          message: "reverse index sources must be unique",
        });
      }
    }
  });

const readinessReasonSchema = z.strictObject({
  code: z.string().regex(DIAGNOSTIC_CODE_PATTERN),
  message: z.string().min(1),
  artifact_refs: z.array(packageRelativeRefSchema),
});

const readinessDimensionSchema = z
  .strictObject({
    status: z.enum(["pass", "warning", "fail"]),
    reasons: z.array(readinessReasonSchema),
  })
  .superRefine((dimension, context) => {
    if ((dimension.status === "pass") !== (dimension.reasons.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["reasons"],
        message: "pass dimensions have no reasons; non-pass dimensions require reasons",
      });
    }
  });

export const domainReadinessRequestSchema = z.strictObject({
  schema_version: z.literal(1),
  request_id: idSchema,
  product_id: idSchema,
  requirements: unique(domainPackPointerSchema, 1),
  requested_by: idSchema,
  requested_at: dateTimeSchema,
  source_ref: domainSourceRefSchema,
});

export const domainTruthReadinessSchema = z
  .strictObject({
    schema_version: z.literal(1),
    report_id: idSchema,
    product_id: idSchema,
    contract: domainPackPointerSchema,
    requirements: unique(domainPackPointerSchema),
    graph: domainPackPointerSchema,
    request: domainPackPointerSchema,
    requested_closure_node_ids: z
      .array(nodeIdSchema)
      .min(1)
      .refine(
        (values) => new Set(values).size === values.length,
        "requested closure node ids must be unique",
      ),
    dimensions: z.strictObject({
      source_integrity: readinessDimensionSchema,
      owner_confirmation: readinessDimensionSchema,
      conflict_state: readinessDimensionSchema,
      observability: readinessDimensionSchema,
      requirement_binding: readinessDimensionSchema,
      impact_closure: readinessDimensionSchema,
      artifact_replay: readinessDimensionSchema,
    }),
    overall: z.enum(["green", "yellow", "red"]),
    claim_strength: z.literal("domain_truth_ready"),
    generated_at: dateTimeSchema,
  })
  .superRefine((report, context) => {
    const statuses = Object.values(report.dimensions).map((dimension) => dimension.status);
    const expected = statuses.includes("fail")
      ? "red"
      : statuses.includes("warning")
        ? "yellow"
        : "green";
    if (report.overall !== expected) {
      context.addIssue({
        code: "custom",
        path: ["overall"],
        message: `overall must be ${expected}`,
      });
    }
  });

export const domainPackManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  snapshot_id: idSchema,
  product_id: idSchema,
  contract: domainPackPointerSchema,
  interviews: unique(domainPackPointerSchema),
  evidence_cards: unique(domainPackPointerSchema),
  confirmations: unique(ownerConfirmationPointerSchema),
  decision_questions: unique(domainPackPointerSchema),
  requirements: unique(domainPackPointerSchema, 1),
  graph: domainPackPointerSchema,
  readiness_request: domainPackPointerSchema,
  readiness_report: domainPackPointerSchema,
});

export type DomainSourceRef = z.infer<typeof domainSourceRefSchema>;
export type OwnerConfirmationEvent = z.infer<typeof ownerConfirmationEventSchema>;
export type OwnerConfirmationPointer = z.infer<typeof ownerConfirmationPointerSchema>;
export type DomainEvidenceCard = z.infer<typeof domainEvidenceCardSchema>;
export type DomainInterviewSession = z.infer<typeof domainInterviewSessionSchema>;
export type DomainDecisionQuestion = z.infer<typeof domainDecisionQuestionSchema>;
export type ProductDomainContract = z.infer<typeof productDomainContractSchema>;
export type ProductDomainContractCandidate = z.infer<typeof productDomainContractCandidateSchema>;
export type RequirementChangeSet = z.infer<typeof requirementChangeSetSchema>;
export type ClaimDependencyGraph = z.infer<typeof claimDependencyGraphSchema>;
export type DomainReadinessRequest = z.infer<typeof domainReadinessRequestSchema>;
export type DomainTruthReadiness = z.infer<typeof domainTruthReadinessSchema>;
export type DomainPackManifest = z.infer<typeof domainPackManifestSchema>;

export const parseOwnerConfirmationEvent = (value: unknown): OwnerConfirmationEvent =>
  ownerConfirmationEventSchema.parse(value);
export const parseDomainEvidenceCard = (value: unknown): DomainEvidenceCard =>
  domainEvidenceCardSchema.parse(value);
export const parseDomainInterviewSession = (value: unknown): DomainInterviewSession =>
  domainInterviewSessionSchema.parse(value);
export const parseDomainDecisionQuestion = (value: unknown): DomainDecisionQuestion =>
  domainDecisionQuestionSchema.parse(value);
export const parseProductDomainContract = (value: unknown): ProductDomainContract =>
  productDomainContractSchema.parse(value);
export const parseProductDomainContractCandidate = (
  value: unknown,
): ProductDomainContractCandidate => productDomainContractCandidateSchema.parse(value);
export const parseRequirementChangeSet = (value: unknown): RequirementChangeSet =>
  requirementChangeSetSchema.parse(value);
export const parseClaimDependencyGraph = (value: unknown): ClaimDependencyGraph =>
  claimDependencyGraphSchema.parse(value);
export const parseDomainReadinessRequest = (value: unknown): DomainReadinessRequest =>
  domainReadinessRequestSchema.parse(value);
export const parseDomainTruthReadiness = (value: unknown): DomainTruthReadiness =>
  domainTruthReadinessSchema.parse(value);
export const parseDomainPackManifest = (value: unknown): DomainPackManifest =>
  domainPackManifestSchema.parse(value);
