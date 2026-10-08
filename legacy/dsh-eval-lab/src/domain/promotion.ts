import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { assertOwnerConfirmation } from "./confirmation.js";
import {
  type DomainEvidenceCard,
  domainPackPointerSchema,
  ownerConfirmationPointerSchema,
  type ProductDomainContract,
  type ProductDomainContractCandidate,
  parseDomainEvidenceCard,
  parseDomainInterviewSession,
  parseOwnerConfirmationEvent,
  parseProductDomainContract,
  parseProductDomainContractCandidate,
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
  readonly sourceInterview: { readonly ref: string; readonly interview: unknown };
  readonly evidenceCards: readonly EvidenceCardInput[];
  readonly predecessor?: PredecessorInput;
}

export interface PromoteEvidenceCardsInput extends DraftProductDomainContractInput {
  readonly contractConfirmation: ConfirmationArtifactInput;
}

export type ProductDomainContractDraft = ProductDomainContractCandidate;

function claimSemantics(claim: ProductDomainContract["claims"][number]) {
  return {
    domain_id: claim.domain_id,
    statement: claim.statement,
    applicability: claim.applicability,
    false_accept_risk: claim.false_accept_risk,
    false_reject_risk: claim.false_reject_risk,
    lifecycle: claim.lifecycle,
    dependency_claim_ids: claim.dependencies.map((dependency) => dependency.claim_id).sort(),
  };
}

export function assertProductDomainContractSuccessor(input: {
  readonly predecessorRef: string;
  readonly predecessor: unknown;
  readonly successor: unknown;
}): void {
  const predecessor = parseProductDomainContract(input.predecessor);
  let successor: ProductDomainContractCandidate;
  try {
    successor = parseProductDomainContractCandidate(input.successor);
  } catch {
    const issued = parseProductDomainContract(input.successor);
    const {
      state: _state,
      confirmation: _confirmation,
      decided_by: _decidedBy,
      decided_at: _decidedAt,
      ...candidate
    } = issued;
    successor = parseProductDomainContractCandidate(candidate);
  }
  if (
    successor.contract_id !== predecessor.contract_id ||
    successor.product_id !== predecessor.product_id ||
    successor.version !== predecessor.version + 1 ||
    successor.predecessor?.ref !== input.predecessorRef ||
    successor.predecessor.sha256 !== canonicalJsonDigest(predecessor)
  ) {
    throw new Error("successor Contract does not bind its exact previous version");
  }
  const previousClaims = new Map(predecessor.claims.map((claim) => [claim.claim_id, claim]));
  const successorClaims = new Map(successor.claims.map((claim) => [claim.claim_id, claim]));
  for (const previous of predecessor.claims) {
    const current = successorClaims.get(previous.claim_id);
    if (current === undefined) {
      throw new Error(`successor Contract silently deletes Claim ${previous.claim_id}`);
    }
    if (
      previous.lifecycle === "retired" &&
      (current.lifecycle !== "retired" ||
        current.transition !== undefined ||
        canonicalJson(claimSemantics(current)) !== canonicalJson(claimSemantics(previous)))
    ) {
      throw new Error(`retired Claim cannot be changed or reactivated: ${previous.claim_id}`);
    }
    const changed =
      canonicalJson(claimSemantics(current)) !== canonicalJson(claimSemantics(previous));
    if (changed && current.transition === undefined) {
      throw new Error(`successor Contract silently mutates Claim ${previous.claim_id}`);
    }
  }
  for (const current of successor.claims) {
    if (current.transition === undefined) continue;
    const previous = previousClaims.get(current.transition.predecessor.claim_id);
    if (
      previous === undefined ||
      current.transition.predecessor.claim_id !== current.claim_id ||
      current.transition.predecessor.contract_version !== predecessor.version
    ) {
      throw new Error(`Claim transition invents or skips history: ${current.claim_id}`);
    }
  }
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
  const sourceInterview = parseDomainInterviewSession(input.sourceInterview.interview);
  if (sourceInterview.product_id !== input.productId || sourceInterview.status !== "completed") {
    throw new Error("Contract source Interview must be completed and belong to the product");
  }
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
    source_interview: domainPackPointerSchema.parse({
      ref: input.sourceInterview.ref,
      sha256: canonicalJsonDigest(sourceInterview),
    }),
    source_snapshot_digest: canonicalJsonDigest(sourceInterview.source_snapshot),
    claims: [...claims.values()].sort((left, right) => left.claim_id.localeCompare(right.claim_id)),
  };
}

export function issueProductDomainContract(
  draftValue: unknown,
  confirmation: ConfirmationArtifactInput,
): ProductDomainContract {
  const draft = parseProductDomainContractCandidate(draftValue);
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
