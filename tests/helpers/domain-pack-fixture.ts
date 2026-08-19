import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../src/contracts/canonical-json.js";
import { confirmationProjectionDigest } from "../../src/domain/confirmation.js";
import { OwnerConfirmationLedger } from "../../src/domain/confirmation-ledger.js";
import { buildClaimDependencyGraph } from "../../src/domain/graph.js";
import {
  draftProductDomainContract,
  issueProductDomainContract,
} from "../../src/domain/promotion.js";
import { buildDomainTruthReadiness } from "../../src/domain/readiness.js";
import {
  validEvidenceCard,
  validInterviewSession,
  validOwnerAnswer,
  validOwnerConfirmation,
  validReadinessRequest,
  validRequirementChangeSet,
} from "./phase3a-fixtures.js";

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
}

export async function writeSyntheticDomainPack(projectRoot: string): Promise<{
  readonly packRoot: string;
  readonly claimId: string;
  readonly manifestRef: string;
  readonly confirmationLedger: OwnerConfirmationLedger;
}> {
  const packRoot = `${projectRoot}/domain-eval`;
  const confirmationLedger = new OwnerConfirmationLedger(
    `${projectRoot}/test-runtime/domain-confirmations`,
  );
  await Promise.all(
    ["interviews", "evidence-cards", "decision-questions", "requirements", "sources"].map((name) =>
      mkdir(`${packRoot}/${name}`, { recursive: true, mode: 0o700 }),
    ),
  );

  const productDoc = "# Cash limit\nCash refunds never exceed captured cash payment.\n";
  const observation = `${canonicalJson({ field: "cash_refunds", authoritative: true })}\n`;
  const cancellationRequirement =
    "# Order cancellation\nCancellation preserves the refund cash limit.\n";
  const partialRefundRequirement =
    "# Partial refund\nPartial refunds preserve the refund cash limit.\n";
  await Promise.all([
    write(`${packRoot}/sources/refund-policy.md`, productDoc),
    write(`${packRoot}/sources/payment-ledger-observer.json`, observation),
    write(`${packRoot}/sources/order-cancellation.md`, cancellationRequirement),
    write(`${packRoot}/sources/partial-refund.md`, partialRefundRequirement),
  ]);

  const ownerSource = {
    source_id: "owner-refund-policy",
    kind: "owner_statement",
    artifact_ref: "interviews/commerce-onboard-v1/r1.json",
    digest: canonicalJsonDigest(validOwnerAnswer),
    locator: "/turns/0/answer",
  } as const;
  const productDocSource = {
    source_id: "refund-policy-doc",
    kind: "product_doc",
    artifact_ref: "sources/refund-policy.md",
    digest: sha256Hex(productDoc),
    locator: "#cash-limit",
  } as const;
  const observationSource = {
    source_id: "payment-ledger-observer",
    kind: "runtime_observation",
    artifact_ref: "sources/payment-ledger-observer.json",
    digest: sha256Hex(observation),
  } as const;
  const cardBase = {
    ...validEvidenceCard,
    source_refs: [ownerSource, productDocSource, observationSource],
  };
  const cardEvent = {
    ...validOwnerConfirmation,
    target: {
      kind: "evidence_card" as const,
      object_id: cardBase.card_id,
      object_version: cardBase.revision,
      projection_sha256: confirmationProjectionDigest("evidence_card", cardBase),
    },
    supporting_source_ref: ownerSource,
  };
  const cardConfirmation = await confirmationLedger.write(cardEvent);
  const evidenceCard = {
    ...cardBase,
    confirmation: cardConfirmation,
  } as const;
  const cardRef = "evidence-cards/card-refund-cash-limit/r1.json";
  const interview = {
    ...validInterviewSession,
    source_snapshot: [ownerSource, productDocSource, observationSource],
    evidence_card_refs: [{ ref: cardRef, sha256: canonicalJsonDigest(evidenceCard) }],
  } as const;
  await Promise.all([
    write(`${packRoot}/${cardRef}`, `${canonicalJson(evidenceCard)}\n`),
    write(`${packRoot}/interviews/commerce-onboard-v1/r1.json`, `${canonicalJson(interview)}\n`),
  ]);

  const contractDraft = draftProductDomainContract({
    contractId: "synthetic-commerce-contract",
    productId: "synthetic-commerce",
    sourceInterview: {
      ref: "interviews/commerce-onboard-v1/r1.json",
      interview,
    },
    evidenceCards: [
      {
        ref: cardRef,
        card: evidenceCard,
        confirmation: { event: cardEvent },
      },
    ],
  });
  const contractEvent = {
    ...validOwnerConfirmation,
    confirmation_id: "confirm-contract-synthetic-commerce-v1-r1",
    target: {
      kind: "product_domain_contract" as const,
      object_id: contractDraft.contract_id,
      object_version: contractDraft.version,
      projection_sha256: confirmationProjectionDigest("product_domain_contract", contractDraft),
    },
    supporting_source_ref: ownerSource,
    occurred_at: "2026-08-19T00:10:00.000Z",
  };
  const contractConfirmation = await confirmationLedger.write(contractEvent);
  const contract = issueProductDomainContract(contractDraft, {
    event: contractEvent,
  });
  if (canonicalJson(contract.confirmation) !== canonicalJson(contractConfirmation)) {
    throw new Error("issued Contract did not retain its confirmation ledger receipt");
  }
  const contractRef = "contracts/synthetic-commerce-contract/v1.json";
  const contractPointer = { ref: contractRef, sha256: canonicalJsonDigest(contract) } as const;

  const requirementArtifacts = await Promise.all(
    [
      {
        ref: "requirements/order-cancellation-v1/v1.json",
        requirementId: "order-cancellation-v1",
        sourceId: "order-cancellation-requirement",
        sourceRef: "sources/order-cancellation.md",
        sourceBytes: cancellationRequirement,
      },
      {
        ref: "requirements/partial-refund-v1/v1.json",
        requirementId: "partial-refund-v1",
        sourceId: "partial-refund-requirement",
        sourceRef: "sources/partial-refund.md",
        sourceBytes: partialRefundRequirement,
      },
    ].map(async (entry) => {
      const requirementBase = {
        ...validRequirementChangeSet,
        requirement_id: entry.requirementId,
        requirement_refs: [
          {
            source_id: entry.sourceId,
            kind: "requirement" as const,
            artifact_ref: entry.sourceRef,
            digest: sha256Hex(entry.sourceBytes),
          },
        ],
        base_contract: contractPointer,
      };
      const event = {
        ...validOwnerConfirmation,
        confirmation_id: `confirm-requirement-${entry.requirementId}-r1`,
        target: {
          kind: "requirement_change_set" as const,
          object_id: entry.requirementId,
          object_version: 1,
          projection_sha256: confirmationProjectionDigest(
            "requirement_change_set",
            requirementBase,
          ),
        },
        supporting_source_ref: ownerSource,
        occurred_at: "2026-08-19T00:15:00.000Z",
      };
      const confirmation = await confirmationLedger.write(event);
      return {
        ref: entry.ref,
        requirement: {
          ...requirementBase,
          confirmation,
        },
        confirmation,
        event,
      };
    }),
  );
  for (const artifact of requirementArtifacts) {
    await write(`${packRoot}/${artifact.ref}`, `${canonicalJson(artifact.requirement)}\n`);
  }

  const graph = buildClaimDependencyGraph({
    contract: { ref: contractRef, contract },
    requirements: requirementArtifacts.map((artifact) => ({
      ref: artifact.ref,
      requirement: artifact.requirement,
    })),
  });
  const request = {
    ...validReadinessRequest,
    requirements: requirementArtifacts.map((artifact) => ({
      ref: artifact.ref,
      sha256: canonicalJsonDigest(artifact.requirement),
    })),
    source_ref: ownerSource,
  } as const;
  const graphRef = `graphs/${graph.graph_id}.json`;
  const requestRef = `readiness/requests/${request.request_id}.json`;
  const readiness = buildDomainTruthReadiness({
    contract: contractPointer,
    requirements: requirementArtifacts.map((artifact) => ({
      ref: artifact.ref,
      requirement: artifact.requirement,
    })),
    graph: { ref: graphRef, graph },
    evidenceCards: [{ ref: cardRef, card: evidenceCard }],
    decisionQuestions: [],
    request: { ref: requestRef, request },
    generatedAt: "2026-08-19T00:20:00.000Z",
  });
  const reportRef = `readiness/reports/${readiness.report_id}.json`;
  const manifestRef = "manifests/snapshot-synthetic-commerce-v1.json";
  const manifest = {
    schema_version: 1,
    snapshot_id: "snapshot-synthetic-commerce-v1",
    product_id: "synthetic-commerce",
    contract: { ref: contractRef, sha256: canonicalJsonDigest(contract) },
    interviews: [
      {
        ref: "interviews/commerce-onboard-v1/r1.json",
        sha256: canonicalJsonDigest(interview),
      },
    ],
    evidence_cards: [{ ref: cardRef, sha256: canonicalJsonDigest(evidenceCard) }],
    confirmations: [
      cardConfirmation,
      contractConfirmation,
      ...requirementArtifacts.map((artifact) => artifact.confirmation),
    ],
    decision_questions: [],
    requirements: requirementArtifacts.map((artifact) => ({
      ref: artifact.ref,
      sha256: canonicalJsonDigest(artifact.requirement),
    })),
    graph: { ref: graphRef, sha256: canonicalJsonDigest(graph) },
    readiness_request: { ref: requestRef, sha256: canonicalJsonDigest(request) },
    readiness_report: { ref: reportRef, sha256: canonicalJsonDigest(readiness) },
  } as const;
  await Promise.all([
    write(`${packRoot}/${contractRef}`, `${canonicalJson(contract)}\n`),
    write(`${packRoot}/${graphRef}`, `${canonicalJson(graph)}\n`),
    write(`${packRoot}/${requestRef}`, `${canonicalJson(request)}\n`),
    write(`${packRoot}/${reportRef}`, `${canonicalJson(readiness)}\n`),
    write(`${packRoot}/${manifestRef}`, `${canonicalJson(manifest)}\n`),
  ]);
  return { packRoot, claimId: "refund-cash-limit", manifestRef, confirmationLedger };
}
