import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  type ProductDomainContract,
  parseProductDomainContract,
  parseRequirementChangeSet,
  type RequirementChangeSet,
} from "../../src/domain/contracts.js";
import {
  assertClaimDependencyGraphSemantics,
  buildClaimDependencyGraph,
  impactedByClaim,
} from "../../src/domain/graph.js";
import {
  validProductDomainContract,
  validRequirementChangeSet,
} from "../helpers/phase3a-fixtures.js";

function contractWithCommerceClaims(): ProductDomainContract {
  const template = validProductDomainContract.claims[0];
  assert.ok(template);
  return parseProductDomainContract({
    ...validProductDomainContract,
    claims: [
      template,
      {
        ...template,
        claim_id: "inventory-release-on-cancel",
        domain_id: "inventory",
        statement: "Successful cancellation releases its inventory reservation exactly once.",
        evidence_card: {
          ref: "evidence-cards/card-inventory-release.json",
          sha256: "1".repeat(64),
        },
      },
      {
        ...template,
        claim_id: "shipment-state-preserved",
        domain_id: "orders",
        statement: "Shipped orders remain non-cancellable.",
        evidence_card: {
          ref: "evidence-cards/card-shipment-state.json",
          sha256: "2".repeat(64),
        },
      },
    ],
  });
}

function requirementFor(
  contract: ReturnType<typeof contractWithCommerceClaims>,
  requirementId: string,
  effects: RequirementChangeSet["effects"] = requirementEffects(),
): RequirementChangeSet {
  return parseRequirementChangeSet({
    ...structuredClone(validRequirementChangeSet),
    requirement_id: requirementId,
    base_contract: {
      ref: "product-domain-contract.json",
      sha256: canonicalJsonDigest(contract),
    },
    effects,
  });
}

function requirementEffects(
  overrides: Partial<RequirementChangeSet["effects"]> = {},
): RequirementChangeSet["effects"] {
  return {
    uses: [...validRequirementChangeSet.effects.uses],
    preserves: [...validRequirementChangeSet.effects.preserves],
    introduces: [...validRequirementChangeSet.effects.introduces],
    modifies: [...validRequirementChangeSet.effects.modifies],
    deprecates: [...validRequirementChangeSet.effects.deprecates],
    conflicts_with: [...validRequirementChangeSet.effects.conflicts_with],
    ...overrides,
  };
}

test("graph reuses one Claim across Requirements and preserves cross-domain edges", () => {
  const contract = contractWithCommerceClaims();
  const cancellation = requirementFor(
    contract,
    "order-cancellation-v1",
    requirementEffects({
      uses: [{ claim_id: "refund-cash-limit", contract_version: 1 }],
      preserves: [
        { claim_id: "inventory-release-on-cancel", contract_version: 1 },
        { claim_id: "shipment-state-preserved", contract_version: 1 },
      ],
    }),
  );
  const partialRefund = requirementFor(contract, "partial-refund-v1");

  const graph = buildClaimDependencyGraph({
    contract: { ref: "product-domain-contract.json", contract },
    requirements: [
      { ref: "requirements/order-cancellation-v1.json", requirement: cancellation },
      { ref: "requirements/partial-refund-v1.json", requirement: partialRefund },
    ],
  });
  assertClaimDependencyGraphSemantics(graph);

  const shared = graph.reverse_index["claim:1:refund-cash-limit"];
  assert.deepEqual(shared, [
    "requirement:1:order-cancellation-v1",
    "requirement:1:partial-refund-v1",
  ]);
  const cancellationDomains = new Set(
    graph.edges
      .filter((edge) => edge.from === "requirement:1:order-cancellation-v1")
      .map((edge) => graph.nodes.find((node) => node.node_id === edge.to)?.domain_id),
  );
  assert.deepEqual([...cancellationDomains].sort(), ["inventory", "orders", "payments"]);
});

test("graph represents all six Requirement effect kinds without mutating the Contract", () => {
  const contract = contractWithCommerceClaims();
  const before = canonicalJsonDigest(contract);
  const requirement = requirementFor(contract, "early-shipment-cancel-v1", {
    uses: [{ claim_id: "refund-cash-limit", contract_version: 1 }],
    preserves: [{ claim_id: "inventory-release-on-cancel", contract_version: 1 }],
    introduces: [
      {
        claim_id: "cancel-event-once",
        domain_id: "orders",
        statement: "Successful cancellation emits one durable event.",
        applicability: "Successful cancellations.",
        source_ref_ids: ["order-cancellation-requirement"],
      },
    ],
    modifies: [
      {
        claim: { claim_id: "shipment-state-preserved", contract_version: 1 },
        proposed: {
          claim_id: "shipment-state-preserved-v2",
          domain_id: "orders",
          statement: "Label-created orders remain cancellable until carrier pickup.",
          applicability: "Orders with a label but no pickup receipt.",
          source_ref_ids: ["order-cancellation-requirement"],
        },
        reason: "The new requirement proposes a bounded cancellation window.",
      },
    ],
    deprecates: [{ claim_id: "shipment-state-preserved", contract_version: 1 }],
    conflicts_with: [
      {
        claim: { claim_id: "shipment-state-preserved", contract_version: 1 },
        reason: "The requirement conflicts with the current shipped-order rule.",
        source_ref_ids: ["order-cancellation-requirement"],
      },
    ],
  });

  const graph = buildClaimDependencyGraph({
    contract: { ref: "product-domain-contract.json", contract },
    requirements: [{ ref: "requirements/early-shipment-cancel-v1.json", requirement }],
  });

  assert.equal(canonicalJsonDigest(contract), before);
  assert.deepEqual([...new Set(graph.edges.map((edge) => edge.kind))].sort(), [
    "conflicts_with",
    "depends_on",
    "deprecates",
    "introduces",
    "modifies",
    "preserves",
    "uses",
  ]);
});

test("impact query follows reverse dependencies to every affected Requirement", () => {
  const contract = contractWithCommerceClaims();
  const cancellation = requirementFor(contract, "order-cancellation-v1");
  const partialRefund = requirementFor(contract, "partial-refund-v1");
  const modification = requirementFor(
    contract,
    "refund-policy-v2",
    requirementEffects({
      uses: [],
      modifies: [
        {
          claim: { claim_id: "refund-cash-limit", contract_version: 1 },
          proposed: {
            claim_id: "refund-cash-limit-v2",
            domain_id: "payments",
            statement: "Cash refunds exclude non-cash promotional value.",
            applicability: "Orders paid with cash and promotions.",
            source_ref_ids: ["order-cancellation-requirement"],
          },
          reason: "Clarify mixed-tender refund accounting.",
        },
      ],
    }),
  );
  const graph = buildClaimDependencyGraph({
    contract: { ref: "product-domain-contract.json", contract },
    requirements: [
      { ref: "requirements/order-cancellation-v1.json", requirement: cancellation },
      { ref: "requirements/partial-refund-v1.json", requirement: partialRefund },
      { ref: "requirements/refund-policy-v2.json", requirement: modification },
    ],
  });

  assert.deepEqual(impactedByClaim(graph, "refund-cash-limit"), {
    dependent_claim_ids: [],
    proposed_claim_ids: ["refund-cash-limit-v2"],
    requirement_ids: ["order-cancellation-v1", "partial-refund-v1", "refund-policy-v2"],
  });
});

test("graph construction rejects missing Claims, version drift, duplicate Requirements, and cycles", () => {
  const contract = contractWithCommerceClaims();
  const missing = requirementFor(
    contract,
    "missing-claim-v1",
    requirementEffects({
      uses: [{ claim_id: "unknown-claim", contract_version: 1 }],
    }),
  );
  assert.throws(() =>
    buildClaimDependencyGraph({
      contract: { ref: "product-domain-contract.json", contract },
      requirements: [{ ref: "requirements/missing.json", requirement: missing }],
    }),
  );

  const drift = requirementFor(
    contract,
    "version-drift-v1",
    requirementEffects({
      uses: [{ claim_id: "refund-cash-limit", contract_version: 2 }],
    }),
  );
  assert.throws(() =>
    buildClaimDependencyGraph({
      contract: { ref: "product-domain-contract.json", contract },
      requirements: [{ ref: "requirements/drift.json", requirement: drift }],
    }),
  );

  const duplicate = requirementFor(contract, "duplicate-v1");
  assert.throws(() =>
    buildClaimDependencyGraph({
      contract: { ref: "product-domain-contract.json", contract },
      requirements: [
        { ref: "requirements/duplicate-a.json", requirement: duplicate },
        { ref: "requirements/duplicate-b.json", requirement: duplicate },
      ],
    }),
  );

  const cycleBase = contractWithCommerceClaims();
  const cyclic = parseProductDomainContract({
    ...cycleBase,
    claims: cycleBase.claims.map((claim) => ({
      ...claim,
      dependencies:
        claim.claim_id === "refund-cash-limit"
          ? [{ claim_id: "inventory-release-on-cancel", contract_version: 1 }]
          : claim.claim_id === "inventory-release-on-cancel"
            ? [{ claim_id: "refund-cash-limit", contract_version: 1 }]
            : claim.dependencies,
    })),
  });
  assert.throws(() =>
    buildClaimDependencyGraph({
      contract: { ref: "product-domain-contract.json", contract: cyclic },
      requirements: [],
    }),
  );
});

test("Claim retirement creates an explicit historical node and retires edge", () => {
  const base = contractWithCommerceClaims();
  const retired = parseProductDomainContract({
    ...base,
    version: 2,
    predecessor: {
      ref: "history/product-domain-contract-v1.json",
      sha256: canonicalJsonDigest(base),
    },
    claims: base.claims.map((claim) =>
      claim.claim_id === "refund-cash-limit"
        ? {
            ...claim,
            lifecycle: "retired",
            transition: {
              kind: "retires",
              predecessor: { claim_id: claim.claim_id, contract_version: 1 },
            },
          }
        : claim,
    ),
  });
  const graph = buildClaimDependencyGraph({
    contract: { ref: "product-domain-contract.json", contract: retired },
    requirements: [],
  });
  assert.ok(
    graph.nodes.some(
      (node) => node.node_id === "claim:1:refund-cash-limit" && node.kind === "historical_claim",
    ),
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.from === "claim:2:refund-cash-limit" &&
        edge.to === "claim:1:refund-cash-limit" &&
        edge.kind === "retires",
    ),
  );
});

test("Requirement and Proposal node identity keeps semantic versions distinct", () => {
  const contract = contractWithCommerceClaims();
  const v1 = requirementFor(contract, "versioned-requirement");
  const v2 = parseRequirementChangeSet({
    ...v1,
    version: 2,
    predecessor: {
      ref: "requirements/versioned-requirement/v1.json",
      sha256: canonicalJsonDigest(v1),
    },
  });
  const graph = buildClaimDependencyGraph({
    contract: { ref: "product-domain-contract.json", contract },
    requirements: [
      { ref: "requirements/versioned-requirement/v1.json", requirement: v1 },
      { ref: "requirements/versioned-requirement/v2.json", requirement: v2 },
    ],
  });
  assert.ok(graph.nodes.some((node) => node.node_id === "requirement:1:versioned-requirement"));
  assert.ok(graph.nodes.some((node) => node.node_id === "requirement:2:versioned-requirement"));
});
