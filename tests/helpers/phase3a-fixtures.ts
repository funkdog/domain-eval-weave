import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";

const digest = (character: string): string => character.repeat(64);

export const validOwnerSource = {
  source_id: "owner-refund-policy",
  kind: "owner_statement",
  artifact_ref: "interviews/commerce-onboard-v1.json",
  digest: digest("a"),
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

export const validEvidenceCard = {
  schema_version: 1,
  card_id: "card-refund-cash-limit",
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
  confirmed_by: "domain-owner-commerce",
  confirmed_at: "2026-08-19T00:00:00.000Z",
} as const;

export const validInterviewSession = {
  schema_version: 1,
  interview_id: "commerce-onboard-v1",
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
      answer_ref_id: "owner-refund-policy",
      status: "answered",
    },
  ],
  evidence_card_refs: [
    {
      ref: "evidence-cards/card-refund-cash-limit.json",
      sha256: canonicalJsonDigest(validEvidenceCard),
    },
  ],
  decision_packet: [],
  status: "completed",
  started_at: "2026-08-19T00:00:00.000Z",
  ended_at: "2026-08-19T00:05:00.000Z",
} as const;

export const validProductDomainContract = {
  schema_version: 1,
  contract_id: "synthetic-commerce-contract",
  product_id: "synthetic-commerce",
  version: 1,
  issued_by: "domain-owner-commerce",
  issued_at: "2026-08-19T00:10:00.000Z",
  source_snapshot_digest: canonicalJsonDigest(validInterviewSession.source_snapshot),
  claims: [
    {
      claim_id: "refund-cash-limit",
      domain_id: "payments",
      statement: validEvidenceCard.statement,
      applicability: validEvidenceCard.applicability,
      evidence_card: {
        ref: "evidence-cards/card-refund-cash-limit.json",
        sha256: canonicalJsonDigest(validEvidenceCard),
      },
      authority_refs: [validOwnerSource, validProductDocSource],
      observation_refs: [validObservationSource],
      false_accept_risk: "critical",
      false_reject_risk: "high",
      dependencies: [],
      lifecycle: "active",
    },
  ],
} as const;

export const validRequirementChangeSet = {
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
    ref: "product-domain-contract.json",
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
  decision_question_ids: [],
  status: "owner_confirmed",
  confirmed_by: "domain-owner-commerce",
  confirmed_at: "2026-08-19T00:15:00.000Z",
} as const;

export const validClaimDependencyGraph = {
  schema_version: 1,
  product_id: "synthetic-commerce",
  contract: {
    ref: "product-domain-contract.json",
    sha256: canonicalJsonDigest(validProductDomainContract),
  },
  requirements: [
    {
      ref: "requirements/order-cancellation-v1.json",
      sha256: canonicalJsonDigest(validRequirementChangeSet),
    },
  ],
  nodes: [
    {
      node_id: "claim:refund-cash-limit",
      kind: "contract_claim",
      object_id: "refund-cash-limit",
      domain_id: "payments",
    },
    {
      node_id: "requirement:order-cancellation-v1",
      kind: "requirement",
      object_id: "order-cancellation-v1",
    },
  ],
  edges: [
    {
      from: "requirement:order-cancellation-v1",
      to: "claim:refund-cash-limit",
      kind: "uses",
    },
  ],
  reverse_index: {
    "claim:refund-cash-limit": ["requirement:order-cancellation-v1"],
  },
} as const;

const passDimension = { status: "pass", reasons: [] } as const;

export const validDomainTruthReadiness = {
  schema_version: 1,
  product_id: "synthetic-commerce",
  contract: {
    ref: "product-domain-contract.json",
    sha256: canonicalJsonDigest(validProductDomainContract),
  },
  requirements: [
    {
      ref: "requirements/order-cancellation-v1.json",
      sha256: canonicalJsonDigest(validRequirementChangeSet),
    },
  ],
  graph: {
    ref: "claim-graph.json",
    sha256: canonicalJsonDigest(validClaimDependencyGraph),
  },
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
