import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { promoteEvidenceCards } from "../../src/domain/promotion.js";
import {
  validEvidenceCard,
  validOwnerSource,
  validProductDocSource,
  validProductDomainContract,
} from "../helpers/phase3a-fixtures.js";

const promotionInput = {
  contractId: "synthetic-commerce-contract",
  productId: "synthetic-commerce",
  issuedBy: "domain-owner-commerce",
  issuedAt: "2026-08-19T01:00:00.000Z",
  sourceSnapshotDigest: "f".repeat(64),
  evidenceCards: [
    {
      ref: "evidence-cards/card-refund-cash-limit.json",
      card: validEvidenceCard,
    },
  ],
} as const;

test("promotion creates a versioned Contract only from confirmed Evidence Cards", () => {
  const contract = promoteEvidenceCards(promotionInput);

  assert.equal(contract.version, 1);
  assert.equal(contract.predecessor, undefined);
  assert.deepEqual(
    contract.claims.map((claim) => claim.claim_id),
    ["refund-cash-limit"],
  );
  assert.deepEqual(contract.claims[0]?.authority_refs, [validOwnerSource, validProductDocSource]);
  assert.equal(contract.claims[0]?.evidence_card.sha256, canonicalJsonDigest(validEvidenceCard));
});

test("promotion rejects every non-confirmed truth state", () => {
  for (const status of ["proposed", "unresolved", "conflicted", "observability_gap"] as const) {
    const card = structuredClone(validEvidenceCard) as Record<string, unknown>;
    card.status = status;
    delete card.confirmed_by;
    delete card.confirmed_at;
    if (status === "conflicted") {
      card.conflict = {
        source_ref_ids: ["owner-refund-policy", "refund-policy-doc"],
        reason: "Owner statement and product document disagree.",
      };
    }
    if (status === "observability_gap") card.observation_ref_ids = [];

    assert.throws(() =>
      promoteEvidenceCards({
        ...promotionInput,
        evidenceCards: [{ ref: "evidence-cards/candidate.json", card }],
      }),
    );
  }
});

test("successor promotion preserves unmentioned Claims and binds the exact predecessor", () => {
  const newCard = {
    ...validEvidenceCard,
    card_id: "card-cancel-idempotency",
    domain_id: "orders",
    claim_id: "cancel-idempotency",
    statement: "A cancellation idempotency key produces at most one state transition.",
  } as const;
  const successor = promoteEvidenceCards({
    ...promotionInput,
    issuedAt: "2026-08-19T02:00:00.000Z",
    predecessor: {
      ref: "history/product-domain-contract-v1.json",
      contract: validProductDomainContract,
    },
    evidenceCards: [{ ref: "evidence-cards/card-cancel-idempotency.json", card: newCard }],
  });

  assert.equal(successor.version, 2);
  assert.deepEqual(successor.predecessor, {
    ref: "history/product-domain-contract-v1.json",
    sha256: canonicalJsonDigest(validProductDomainContract),
  });
  assert.deepEqual(
    successor.claims.map((claim) => claim.claim_id),
    ["cancel-idempotency", "refund-cash-limit"],
  );
});

test("successor promotion rejects identity drift", () => {
  const predecessor = structuredClone(validProductDomainContract) as Record<string, unknown>;
  predecessor.product_id = "different-product";
  assert.throws(() =>
    promoteEvidenceCards({
      ...promotionInput,
      predecessor: { ref: "history/product-domain-contract-v1.json", contract: predecessor },
    }),
  );

  const changedDomain = {
    ...validEvidenceCard,
    domain_id: "orders",
  } as const;
  assert.throws(() =>
    promoteEvidenceCards({
      ...promotionInput,
      predecessor: {
        ref: "history/product-domain-contract-v1.json",
        contract: validProductDomainContract,
      },
      evidenceCards: [{ ref: "evidence-cards/card-refund-cash-limit.json", card: changedDomain }],
    }),
  );
});
