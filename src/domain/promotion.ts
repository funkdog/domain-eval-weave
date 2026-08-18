import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type DomainEvidenceCard,
  domainPackPointerSchema,
  type ProductDomainContract,
  parseDomainEvidenceCard,
  parseProductDomainContract,
} from "./contracts.js";

interface EvidenceCardInput {
  readonly ref: string;
  readonly card: unknown;
}

interface PredecessorInput {
  readonly ref: string;
  readonly contract: unknown;
}

export interface PromoteEvidenceCardsInput {
  readonly contractId: string;
  readonly productId: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly sourceSnapshotDigest: string;
  readonly evidenceCards: readonly EvidenceCardInput[];
  readonly predecessor?: PredecessorInput;
}

function selectedSources(card: DomainEvidenceCard, ids: readonly string[]) {
  const byId = new Map(card.source_refs.map((source) => [source.source_id, source]));
  return ids.map((id) => {
    const source = byId.get(id);
    if (source === undefined)
      throw new Error(`Evidence Card ${card.card_id} is missing source ${id}`);
    return source;
  });
}

export function promoteEvidenceCards(input: PromoteEvidenceCardsInput): ProductDomainContract {
  const predecessor =
    input.predecessor === undefined
      ? undefined
      : parseProductDomainContract(input.predecessor.contract);
  if (
    predecessor !== undefined &&
    (predecessor.contract_id !== input.contractId || predecessor.product_id !== input.productId)
  ) {
    throw new Error("predecessor Contract identity does not match promotion target");
  }

  const claims = new Map(
    (predecessor?.claims ?? []).map((claim) => [claim.claim_id, structuredClone(claim)]),
  );
  const selectedClaimIds = new Set<string>();

  for (const artifact of input.evidenceCards) {
    const card = parseDomainEvidenceCard(artifact.card);
    if (card.status !== "confirmed") {
      throw new Error(`Evidence Card ${card.card_id} is not confirmed`);
    }
    if (card.product_id !== input.productId) {
      throw new Error(`Evidence Card ${card.card_id} belongs to another product`);
    }
    if (selectedClaimIds.has(card.claim_id)) {
      throw new Error(`promotion selects Claim ${card.claim_id} more than once`);
    }
    selectedClaimIds.add(card.claim_id);

    const existing = claims.get(card.claim_id);
    if (existing !== undefined && existing.domain_id !== card.domain_id) {
      throw new Error(`Claim ${card.claim_id} cannot change domain identity`);
    }

    const evidenceCard = domainPackPointerSchema.parse({
      ref: artifact.ref,
      sha256: canonicalJsonDigest(card),
    });
    claims.set(card.claim_id, {
      claim_id: card.claim_id,
      domain_id: card.domain_id,
      statement: card.statement,
      applicability: card.applicability,
      evidence_card: evidenceCard,
      authority_refs: selectedSources(card, card.authority_ref_ids),
      observation_refs: selectedSources(card, card.observation_ref_ids),
      false_accept_risk: card.false_accept_risk,
      false_reject_risk: card.false_reject_risk,
      dependencies: existing?.dependencies ?? [],
      lifecycle: existing?.lifecycle ?? "active",
    });
  }

  if (claims.size === 0) throw new Error("promotion requires at least one confirmed Claim");

  const contract = {
    schema_version: 1,
    contract_id: input.contractId,
    product_id: input.productId,
    version: predecessor === undefined ? 1 : predecessor.version + 1,
    ...(predecessor === undefined
      ? {}
      : {
          predecessor: domainPackPointerSchema.parse({
            ref: input.predecessor?.ref,
            sha256: canonicalJsonDigest(predecessor),
          }),
        }),
    issued_by: input.issuedBy,
    issued_at: input.issuedAt,
    source_snapshot_digest: input.sourceSnapshotDigest,
    claims: [...claims.values()].sort((left, right) => left.claim_id.localeCompare(right.claim_id)),
  };
  return parseProductDomainContract(contract);
}
