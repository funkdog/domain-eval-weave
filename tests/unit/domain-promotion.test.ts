import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { confirmationProjectionDigest } from "../../src/domain/confirmation.js";
import {
  draftProductDomainContract,
  issueProductDomainContract,
} from "../../src/domain/promotion.js";
import {
  validContractConfirmation,
  validEvidenceCard,
  validOwnerConfirmation,
  validOwnerSource,
  validProductDocSource,
  validProductDomainContract,
} from "../helpers/phase3a-fixtures.js";

function cardArtifact(card: unknown = validEvidenceCard, event: unknown = validOwnerConfirmation) {
  const cardIdentity = card as { readonly card_id: string };
  return {
    ref: `evidence-cards/${cardIdentity.card_id}.json`,
    card,
    confirmation: { event },
  };
}

function issueDraft(draft: unknown, suffix: string) {
  const parsed = draft as { contract_id: string; product_id: string; version: number };
  const event = {
    ...validContractConfirmation,
    confirmation_id: `confirm-contract-${suffix}`,
    target: {
      kind: "product_domain_contract" as const,
      object_id: parsed.contract_id,
      object_version: parsed.version,
      projection_sha256: confirmationProjectionDigest("product_domain_contract", draft),
    },
  };
  return issueProductDomainContract(draft, {
    event,
  });
}

const draftInput = {
  contractId: "synthetic-commerce-contract",
  productId: "synthetic-commerce",
  sourceSnapshotDigest: "f".repeat(64),
  evidenceCards: [cardArtifact()],
} as const;

test("promotion creates and issues a Contract only through digest-bound owner events", () => {
  const draft = draftProductDomainContract(draftInput);
  assert.equal("state" in draft, false);
  assert.equal("confirmation" in draft, false);

  const contract = issueDraft(draft, "v1");
  assert.equal(contract.state, "issued");
  assert.equal(contract.version, 1);
  assert.equal(contract.decided_by, "domain-owner-commerce");
  assert.deepEqual(contract.claims[0]?.authority_refs, [validOwnerSource, validProductDocSource]);
  assert.equal(contract.claims[0]?.evidence_card.sha256, canonicalJsonDigest(validEvidenceCard));
});

test("promotion rejects every non-confirmed truth state", () => {
  for (const status of ["proposed", "unresolved", "conflicted", "observability_gap"] as const) {
    const card = structuredClone(validEvidenceCard) as Record<string, unknown>;
    card.status = status;
    delete card.confirmation;
    if (status === "conflicted") {
      card.conflict = {
        source_ref_ids: ["owner-refund-policy", "refund-policy-doc"],
        reason: "Owner statement and product document disagree.",
      };
    }
    if (status === "observability_gap") card.observation_ref_ids = [];
    assert.throws(() =>
      draftProductDomainContract({
        ...draftInput,
        evidenceCards: [
          {
            ref: "evidence-cards/candidate.json",
            card,
            confirmation: cardArtifact().confirmation,
          },
        ],
      }),
    );
  }
});

test("successor draft preserves unmentioned Claims and binds the exact predecessor", () => {
  const cardBase = {
    ...validEvidenceCard,
    card_id: "card-cancel-idempotency",
    domain_id: "orders",
    claim_id: "cancel-idempotency",
    statement: "A cancellation idempotency key produces at most one state transition.",
  } as const;
  const cardEvent = {
    ...validOwnerConfirmation,
    confirmation_id: "confirm-card-cancel-idempotency",
    target: {
      kind: "evidence_card" as const,
      object_id: cardBase.card_id,
      object_version: cardBase.revision,
      projection_sha256: confirmationProjectionDigest("evidence_card", cardBase),
    },
  };
  const card = {
    ...cardBase,
    confirmation: {
      confirmation_id: "confirm-card-cancel-idempotency",
      sha256: canonicalJsonDigest(cardEvent),
    },
  } as const;
  const draft = draftProductDomainContract({
    ...draftInput,
    predecessor: {
      ref: "history/product-domain-contract-v1.json",
      contract: validProductDomainContract,
    },
    evidenceCards: [cardArtifact(card, cardEvent)],
  });
  const successor = issueDraft(draft, "v2");

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

test("promotion rejects identity drift and confirmation projection drift", () => {
  const predecessor = structuredClone(validProductDomainContract) as Record<string, unknown>;
  predecessor.product_id = "different-product";
  assert.throws(() =>
    draftProductDomainContract({
      ...draftInput,
      predecessor: { ref: "history/product-domain-contract-v1.json", contract: predecessor },
    }),
  );

  const changedCard = { ...validEvidenceCard, statement: "A mutated product truth." };
  assert.throws(() =>
    draftProductDomainContract({
      ...draftInput,
      evidenceCards: [cardArtifact(changedCard, validOwnerConfirmation)],
    }),
  );
});
