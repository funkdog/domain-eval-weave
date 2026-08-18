import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { confirmationProjectionDigest } from "../../src/domain/confirmation.js";

const digest = (character: string): string => character.repeat(64);

export const validOwnerAnswer = "Cash refunds are capped by captured cash payment.";

export const validOwnerSource = {
  source_id: "owner-refund-policy",
  kind: "owner_statement",
  artifact_ref: "interviews/commerce-onboard-v1/r1.json",
  digest: canonicalJsonDigest(validOwnerAnswer),
  locator: "/turns/0/answer",
} as const;

export const validProductDocSource = {
  source_id: "refund-policy-doc",
  kind: "product_doc",
  artifact_ref: "sources/refund-policy.md",
  digest: digest("b"),
  locator: "#cash-limit",
} as const;

export const validObservationSource = {
  source_id: "payment-ledger-observer",
  kind: "runtime_observation",
  artifact_ref: "sources/payment-ledger-observer.json",
  digest: digest("c"),
  locator: "/cash_refunds",
} as const;

const evidenceCardWithoutConfirmation = {
  schema_version: 1,
  card_id: "card-refund-cash-limit",
  revision: 1,
  product_id: "synthetic-commerce",
  domain_id: "payments",
  claim_id: "refund-cash-limit",
  statement: "Cumulative cash refunds never exceed captured cash payment.",
  applicability: "Orders with a captured cash payment.",
  status: "confirmed",
  source_refs: [validOwnerSource, validProductDocSource, validObservationSource],
  authority_ref_ids: ["owner-refund-policy", "refund-policy-doc"],
  observation_ref_ids: ["payment-ledger-observer"],
  false_accept_risk: "critical",
  false_reject_risk: "high",
} as const;

export const validOwnerConfirmation = {
  schema_version: 1,
  confirmation_id: "confirm-card-refund-cash-limit-r1",
  actor_id: "domain-owner-commerce",
  authority_scope: {
    product_id: "synthetic-commerce",
    domain_ids: ["orders", "payments", "inventory"],
  },
  target: {
    kind: "evidence_card",
    object_id: "card-refund-cash-limit",
    object_version: 1,
    projection_sha256: confirmationProjectionDigest(
      "evidence_card",
      evidenceCardWithoutConfirmation,
    ),
  },
  decision: "confirm",
  origin: {
    kind: "management_cli_operator_invocation",
    profile: "eval-clowder",
    command: "confirm",
    invocation_sha256: digest("e"),
  },
  supporting_source_ref: validOwnerSource,
  occurred_at: "2026-08-19T00:00:00.000Z",
} as const;

export const validEvidenceCard = {
  ...evidenceCardWithoutConfirmation,
  confirmation: {
    confirmation_id: "confirm-card-refund-cash-limit-r1",
    sha256: canonicalJsonDigest(validOwnerConfirmation),
  },
} as const;

export const validInterviewSession = {
  schema_version: 1,
  interview_id: "commerce-onboard-v1",
  revision: 1,
  mode: "onboard",
  product_id: "synthetic-commerce",
  domain_ids: ["orders", "payments", "inventory"],
  source_snapshot: [validOwnerSource, validProductDocSource, validObservationSource],
  turns: [
    {
      turn_id: "turn-1",
      question_id: "question-refund-limit",
      question: "Can cash refunds exceed captured cash payment?",
      reason: "The answer defines the money-conservation boundary.",
      source_ref_ids: ["refund-policy-doc"],
      blocked_claim_ids: ["refund-cash-limit"],
      answer: validOwnerAnswer,
      answer_ref_id: "owner-refund-policy",
      status: "answered",
    },
  ],
  evidence_card_refs: [
    {
      ref: "evidence-cards/card-refund-cash-limit/r1.json",
      sha256: canonicalJsonDigest(validEvidenceCard),
    },
  ],
  decision_question_refs: [],
  status: "completed",
  started_at: "2026-08-19T00:00:00.000Z",
  ended_at: "2026-08-19T00:05:00.000Z",
} as const;

const contractClaims = [
  {
    claim_id: "refund-cash-limit",
    domain_id: "payments",
    statement: validEvidenceCard.statement,
    applicability: validEvidenceCard.applicability,
    evidence_card: {
      ref: "evidence-cards/card-refund-cash-limit/r1.json",
      sha256: canonicalJsonDigest(validEvidenceCard),
    },
    authority_refs: [validOwnerSource, validProductDocSource],
    observation_refs: [validObservationSource],
    false_accept_risk: "critical",
    false_reject_risk: "high",
    dependencies: [],
    lifecycle: "active",
  },
] as const;

const contractDraftProjection = {
  schema_version: 1,
  contract_id: "synthetic-commerce-contract",
  product_id: "synthetic-commerce",
  version: 1,
  source_snapshot_digest: canonicalJsonDigest(validInterviewSession.source_snapshot),
  claims: contractClaims,
} as const;

export const validContractConfirmation = {
  schema_version: 1,
  confirmation_id: "confirm-contract-synthetic-commerce-v1-r1",
  actor_id: "domain-owner-commerce",
  authority_scope: {
    product_id: "synthetic-commerce",
    domain_ids: ["orders", "payments", "inventory"],
  },
  target: {
    kind: "product_domain_contract",
    object_id: "synthetic-commerce-contract",
    object_version: 1,
    projection_sha256: confirmationProjectionDigest(
      "product_domain_contract",
      contractDraftProjection,
    ),
  },
  decision: "confirm",
  origin: {
    kind: "management_cli_operator_invocation",
    profile: "eval-clowder",
    command: "confirm",
    invocation_sha256: digest("f"),
  },
  supporting_source_ref: validOwnerSource,
  occurred_at: "2026-08-19T00:10:00.000Z",
} as const;

export const validProductDomainContract = {
  ...contractDraftProjection,
  state: "issued",
  confirmation: {
    confirmation_id: "confirm-contract-synthetic-commerce-v1-r1",
    sha256: canonicalJsonDigest(validContractConfirmation),
  },
  decided_by: "domain-owner-commerce",
  decided_at: "2026-08-19T00:10:00.000Z",
} as const;

const requirementWithoutConfirmation = {
  schema_version: 1,
  requirement_id: "order-cancellation-v1",
  version: 1,
  product_id: "synthetic-commerce",
  requirement_refs: [
    {
      source_id: "order-cancellation-requirement",
      kind: "requirement",
      artifact_ref: "sources/order-cancellation.md",
      digest: digest("d"),
      locator: "#refund",
    },
  ],
  base_contract: {
    ref: "contracts/synthetic-commerce-contract/v1.json",
    sha256: canonicalJsonDigest(validProductDomainContract),
  },
  effects: {
    uses: [{ claim_id: "refund-cash-limit", contract_version: 1 }],
    preserves: [],
    introduces: [],
    modifies: [],
    deprecates: [],
    conflicts_with: [],
  },
  decision_question_refs: [],
  status: "owner_confirmed",
} as const;

export const validRequirementConfirmation = {
  schema_version: 1,
  confirmation_id: "confirm-requirement-order-cancellation-v1-r1",
  actor_id: "domain-owner-commerce",
  authority_scope: {
    product_id: "synthetic-commerce",
    domain_ids: ["orders", "payments", "inventory"],
  },
  target: {
    kind: "requirement_change_set",
    object_id: "order-cancellation-v1",
    object_version: 1,
    projection_sha256: confirmationProjectionDigest(
      "requirement_change_set",
      requirementWithoutConfirmation,
    ),
  },
  decision: "confirm",
  origin: {
    kind: "management_cli_operator_invocation",
    profile: "eval-clowder",
    command: "confirm",
    invocation_sha256: digest("1"),
  },
  supporting_source_ref: validOwnerSource,
  occurred_at: "2026-08-19T00:15:00.000Z",
} as const;

export const validRequirementChangeSet = {
  ...requirementWithoutConfirmation,
  confirmation: {
    confirmation_id: "confirm-requirement-order-cancellation-v1-r1",
    sha256: canonicalJsonDigest(validRequirementConfirmation),
  },
} as const;

export const validDecisionQuestion = {
  schema_version: 1,
  question_id: "coupon-restoration-policy",
  revision: 1,
  product_id: "synthetic-commerce",
  requirement_id: "order-cancellation-v1",
  question: "Should cancellation restore a consumed coupon?",
  reason: "No authorized product source defines coupon restoration.",
  blocked_claim_ids: ["coupon-restoration"],
  risk: "medium",
  blocking: false,
  status: "open",
} as const;

export const validClaimDependencyGraph = {
  schema_version: 1,
  graph_id: "graph-synthetic-commerce-v1",
  product_id: "synthetic-commerce",
  contract: {
    ref: "contracts/synthetic-commerce-contract/v1.json",
    sha256: canonicalJsonDigest(validProductDomainContract),
  },
  requirements: [
    {
      ref: "requirements/order-cancellation-v1/v1.json",
      sha256: canonicalJsonDigest(validRequirementChangeSet),
    },
  ],
  nodes: [
    {
      node_id: "claim:1:refund-cash-limit",
      kind: "contract_claim",
      object_id: "refund-cash-limit",
      object_version: 1,
      domain_id: "payments",
    },
    {
      node_id: "requirement:1:order-cancellation-v1",
      kind: "requirement",
      object_id: "order-cancellation-v1",
      object_version: 1,
    },
  ],
  edges: [
    {
      from: "requirement:1:order-cancellation-v1",
      to: "claim:1:refund-cash-limit",
      kind: "uses",
    },
  ],
  reverse_index: {
    "claim:1:refund-cash-limit": ["requirement:1:order-cancellation-v1"],
  },
} as const;

export const validReadinessRequest = {
  schema_version: 1,
  request_id: "readiness-order-cancellation-v1",
  product_id: "synthetic-commerce",
  requirements: [
    {
      ref: "requirements/order-cancellation-v1/v1.json",
      sha256: canonicalJsonDigest(validRequirementChangeSet),
    },
  ],
  requested_by: "domain-owner-commerce",
  requested_at: "2026-08-19T00:19:00.000Z",
  source_ref: validOwnerSource,
} as const;

const passDimension = { status: "pass", reasons: [] } as const;

export const validDomainTruthReadiness = {
  schema_version: 1,
  report_id: "report-readiness-order-cancellation-v1",
  product_id: "synthetic-commerce",
  contract: {
    ref: "contracts/synthetic-commerce-contract/v1.json",
    sha256: canonicalJsonDigest(validProductDomainContract),
  },
  requirements: [
    {
      ref: "requirements/order-cancellation-v1/v1.json",
      sha256: canonicalJsonDigest(validRequirementChangeSet),
    },
  ],
  graph: {
    ref: "graphs/graph-synthetic-commerce-v1.json",
    sha256: canonicalJsonDigest(validClaimDependencyGraph),
  },
  request: {
    ref: "readiness/requests/readiness-order-cancellation-v1.json",
    sha256: canonicalJsonDigest(validReadinessRequest),
  },
  requested_closure_node_ids: ["claim:1:refund-cash-limit", "requirement:1:order-cancellation-v1"],
  dimensions: {
    source_integrity: passDimension,
    owner_confirmation: passDimension,
    conflict_state: passDimension,
    observability: passDimension,
    requirement_binding: passDimension,
    impact_closure: passDimension,
    artifact_replay: passDimension,
  },
  overall: "green",
  claim_strength: "domain_truth_ready",
  generated_at: "2026-08-19T00:20:00.000Z",
} as const;

export const validDomainPackManifest = {
  schema_version: 1,
  snapshot_id: "snapshot-synthetic-commerce-v1",
  product_id: "synthetic-commerce",
  contract: {
    ref: "contracts/synthetic-commerce-contract/v1.json",
    sha256: canonicalJsonDigest(validProductDomainContract),
  },
  interviews: [
    {
      ref: "interviews/commerce-onboard-v1/r1.json",
      sha256: canonicalJsonDigest(validInterviewSession),
    },
  ],
  evidence_cards: [
    {
      ref: "evidence-cards/card-refund-cash-limit/r1.json",
      sha256: canonicalJsonDigest(validEvidenceCard),
    },
  ],
  confirmations: [
    {
      confirmation_id: "confirm-card-refund-cash-limit-r1",
      sha256: canonicalJsonDigest(validOwnerConfirmation),
    },
    {
      confirmation_id: "confirm-contract-synthetic-commerce-v1-r1",
      sha256: canonicalJsonDigest(validContractConfirmation),
    },
    {
      confirmation_id: "confirm-requirement-order-cancellation-v1-r1",
      sha256: canonicalJsonDigest(validRequirementConfirmation),
    },
  ],
  decision_questions: [],
  requirements: [
    {
      ref: "requirements/order-cancellation-v1/v1.json",
      sha256: canonicalJsonDigest(validRequirementChangeSet),
    },
  ],
  graph: {
    ref: "graphs/graph-synthetic-commerce-v1.json",
    sha256: canonicalJsonDigest(validClaimDependencyGraph),
  },
  readiness_request: {
    ref: "readiness/requests/readiness-order-cancellation-v1.json",
    sha256: canonicalJsonDigest(validReadinessRequest),
  },
  readiness_report: {
    ref: "readiness/reports/report-readiness-order-cancellation-v1.json",
    sha256: canonicalJsonDigest(validDomainTruthReadiness),
  },
} as const;
