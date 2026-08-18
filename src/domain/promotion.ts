import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import { assertOwnerConfirmation } from "./confirmation.js";
import {
  type DomainEvidenceCard,
  domainPackPointerSchema,
  ownerConfirmationPointerSchema,
  type ProductDomainContract,
  parseDomainEvidenceCard,
  parseOwnerConfirmationEvent,
  parseProductDomainContract,
} from "./contracts.js";

interface ConfirmationArtifactInput {
  readonly event: unknown;
}

interface EvidenceCardInput {
  readonly ref: string;
  readonly card: unknown;
  readonly confirmation: ConfirmationArtifactInput;
}

interface PredecessorInput {
  readonly ref: string;
  readonly contract: unknown;
}

export interface DraftProductDomainContractInput {
  readonly contractId: string;
  readonly productId: string;
  readonly sourceSnapshotDigest: string;
  readonly evidenceCards: readonly EvidenceCardInput[];
  readonly predecessor?: PredecessorInput;
}

export interface PromoteEvidenceCardsInput extends DraftProductDomainContractInput {
  readonly contractConfirmation: ConfirmationArtifactInput;
}

export interface ProductDomainContractDraft {
  readonly schema_version: 1;
  readonly contract_id: string;
  readonly product_id: string;
  readonly version: number;
  readonly predecessor?: { readonly ref: string; readonly sha256: string };
  readonly source_snapshot_digest: string;
  readonly claims: ProductDomainContract["claims"];
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

function assertConfirmationPointer(
  pointer: { readonly confirmation_id: string; readonly sha256: string } | undefined,
  artifact: ConfirmationArtifactInput,
): void {
  const event = parseOwnerConfirmationEvent(artifact.event);
  if (
    pointer === undefined ||
    pointer.confirmation_id !== event.confirmation_id ||
    pointer.sha256 !== canonicalJsonDigest(event)
  ) {
    throw new Error("confirmation pointer does not bind the supplied OwnerConfirmationEvent");
  }
}

export function draftProductDomainContract(
  input: DraftProductDomainContractInput,
): ProductDomainContractDraft {
  const predecessor =
    input.predecessor === undefined
      ? undefined
      : parseProductDomainContract(input.predecessor.contract);
  if (
    predecessor !== undefined &&
    (predecessor.state !== "issued" ||
      predecessor.contract_id !== input.contractId ||
      predecessor.product_id !== input.productId)
  ) {
    throw new Error("predecessor must be an issued Contract with the promotion identity");
  }

  const claims = new Map(
    (predecessor?.claims ?? []).map((claim) => [claim.claim_id, structuredClone(claim)]),
  );
  const selectedClaimIds = new Set<string>();
  for (const artifact of input.evidenceCards) {
    const card = parseDomainEvidenceCard(artifact.card);
    if (card.status !== "confirmed")
      throw new Error(`Evidence Card ${card.card_id} is not confirmed`);
    if (card.product_id !== input.productId) {
      throw new Error(`Evidence Card ${card.card_id} belongs to another product`);
    }
    if (selectedClaimIds.has(card.claim_id)) {
      throw new Error(`promotion selects Claim ${card.claim_id} more than once`);
    }
    selectedClaimIds.add(card.claim_id);
    if (claims.has(card.claim_id)) {
      throw new Error(`existing Claim ${card.claim_id} requires an explicit transition`);
    }

    assertConfirmationPointer(card.confirmation, artifact.confirmation);
    assertOwnerConfirmation(artifact.confirmation.event, "evidence_card", card, "confirm");
    claims.set(card.claim_id, {
      claim_id: card.claim_id,
      domain_id: card.domain_id,
      statement: card.statement,
      applicability: card.applicability,
      evidence_card: domainPackPointerSchema.parse({
        ref: artifact.ref,
        sha256: canonicalJsonDigest(card),
      }),
      authority_refs: selectedSources(card, card.authority_ref_ids),
      observation_refs: selectedSources(card, card.observation_ref_ids),
      false_accept_risk: card.false_accept_risk,
      false_reject_risk: card.false_reject_risk,
      dependencies: [],
      lifecycle: "active",
    });
  }
  if (claims.size === 0) throw new Error("Contract draft requires at least one confirmed Claim");

  return {
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
    source_snapshot_digest: input.sourceSnapshotDigest,
    claims: [...claims.values()].sort((left, right) => left.claim_id.localeCompare(right.claim_id)),
  };
}

export function issueProductDomainContract(
  draftValue: unknown,
  confirmation: ConfirmationArtifactInput,
): ProductDomainContract {
  const draft = draftValue as ProductDomainContractDraft;
  if (
    draft.schema_version !== 1 ||
    typeof draft.contract_id !== "string" ||
    typeof draft.product_id !== "string" ||
    !Number.isInteger(draft.version) ||
    !Array.isArray(draft.claims)
  ) {
    throw new Error("Contract draft is invalid");
  }
  const event = assertOwnerConfirmation(
    confirmation.event,
    "product_domain_contract",
    draft,
    "confirm",
  );
  return parseProductDomainContract({
    ...draft,
    state: "issued",
    confirmation: ownerConfirmationPointerSchema.parse({
      confirmation_id: event.confirmation_id,
      sha256: canonicalJsonDigest(event),
    }),
    decided_by: event.actor_id,
    decided_at: event.occurred_at,
  });
}

export function promoteEvidenceCards(input: PromoteEvidenceCardsInput): ProductDomainContract {
  return issueProductDomainContract(draftProductDomainContract(input), input.contractConfirmation);
}
