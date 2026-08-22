import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCommerceObservationCatalog } from "../../src/commerce-withdrawal/catalog.js";
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

const taskPackRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v2", import.meta.url),
);

async function write(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
}

export async function writeSyntheticCommerceWithdrawalDomainPack(projectRoot: string): Promise<{
  readonly manifestRef: string;
  readonly confirmationLedger: OwnerConfirmationLedger;
}> {
  const packRoot = `${projectRoot}/domain-eval`;
  const ledger = new OwnerConfirmationLedger(`${projectRoot}/test-runtime/domain-confirmations`);
  const catalog = parseCommerceObservationCatalog(
    JSON.parse(await readFile(`${taskPackRoot}/claim-observation-catalog.json`, "utf8")),
  );
  const catalogRef = "sources/commerce-order-observation-catalog.json";
  const interviewRef = "interviews/commerce-order-onboard-v1/r1.json";
  const policyInputs = [
    {
      claimId: "CLM-COMMERCE-R01",
      statement: "Commerce facts remain independently authoritative and are projected together.",
      behaviors: [3, 4, 8, 9, 12, 13],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-R02",
      statement: "Cancellation and refund settlement remain separate facts.",
      behaviors: [3],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-R07",
      statement: "Cross-domain requests and their completion states remain separate.",
      behaviors: [3, 4, 5, 6, 7, 8, 9, 12],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-D01",
      statement: "Carrier handoff closes self-service cancellation eligibility.",
      behaviors: [0, 1, 2, 4],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-D02",
      statement: "Active fulfillment must resolve withdrawal before final cancellation.",
      behaviors: [4, 5, 6, 7],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-R03",
      statement: "Refunds bind paid amount, remaining balance, and currency.",
      behaviors: [1, 13],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-R04",
      statement: "Every amount has currency and minor-unit representation.",
      behaviors: [13],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-R05",
      statement: "Object-level authorization precedes every order operation.",
      behaviors: [10],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-R06",
      statement: "Replay never duplicates effects and conflicting input is rejected.",
      behaviors: [8, 11, 12, 14],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-R08",
      statement: "Authoritative decisions and handoffs have durable recovery evidence.",
      behaviors: [11, 12, 14, 15],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-D03",
      statement: "Inventory compensation follows the final cancellation path exactly once.",
      behaviors: [6, 7, 8],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-D04",
      statement: "Coupon restoration requires current eligibility.",
      behaviors: [9],
      falseAcceptRisk: "high" as const,
    },
    {
      claimId: "CLM-COMMERCE-D07",
      statement: "Idempotency scope and delayed replay remain safe beyond retention.",
      behaviors: [11, 14],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-D08",
      statement: "Local decisions commit atomically while handoffs converge durably.",
      behaviors: [4, 5, 6, 7, 12],
      falseAcceptRisk: "critical" as const,
    },
    {
      claimId: "CLM-COMMERCE-D09",
      statement: "Audit evidence and retention policy remain complete.",
      behaviors: [12, 15],
      falseAcceptRisk: "critical" as const,
    },
  ].map((input) => ({
    domainId: "commerce-order",
    applicability: "Synthetic whole-order self-service cancellation.",
    answer: input.statement,
    ...input,
  }));
  await write(`${packRoot}/${catalogRef}`, canonicalJson(catalog));
  const policyText = [
    "# Synthetic commerce policy sources",
    "",
    "Customer support says every pre-shipment order can be cancelled.",
    "Warehouse notes that shipped orders require after-sales handling.",
    "Payments states that refund completion is asynchronous and uses paid amount.",
    "Promotions states that expired coupons are not restored.",
    "",
  ].join("\n");
  const requirementText = [
    "# Self-service order cancellation",
    "",
    "Allow a customer to cancel an eligible order while preserving payment, inventory, coupon, ownership, idempotency, and audit rules.",
    "",
  ].join("\n");
  await Promise.all([
    write(`${packRoot}/sources/commerce-policy-sources.md`, policyText),
    write(`${packRoot}/sources/self-service-order-cancellation.md`, requirementText),
  ]);
  const ownerSources = policyInputs.map((input, index) => ({
    source_id: `owner-${input.claimId}`,
    kind: "owner_statement" as const,
    artifact_ref: interviewRef,
    digest: canonicalJsonDigest(input.answer),
    locator: `/turns/${index}/answer`,
  }));
  const observations = policyInputs.map((input) =>
    input.behaviors.map((index) => {
      const entry = catalog.behaviors[index];
      if (entry === undefined) throw new Error("missing commerce observation");
      return {
        source_id: `commerce-observation-${input.claimId}-${entry.behavior_id}`,
        kind: "test" as const,
        artifact_ref: catalogRef,
        digest: canonicalJsonDigest(entry),
        locator: `/behaviors/${index}`,
      };
    }),
  );
  const cardArtifacts = [];
  for (const [index, input] of policyInputs.entries()) {
    const owner = ownerSources[index];
    const claimObservations = observations[index];
    if (owner === undefined || claimObservations === undefined) throw new Error("bad policy input");
    const base = {
      schema_version: 1 as const,
      card_id: `card-${input.claimId}`,
      revision: 1,
      product_id: "synthetic-commerce-withdrawal",
      domain_id: input.domainId,
      claim_id: input.claimId,
      statement: input.statement,
      applicability: input.applicability,
      status: "confirmed" as const,
      source_refs: [owner, ...claimObservations],
      authority_ref_ids: [owner.source_id],
      observation_ref_ids: claimObservations.map((source) => source.source_id),
      false_accept_risk: input.falseAcceptRisk,
      false_reject_risk: "medium" as const,
    };
    const event = {
      schema_version: 1 as const,
      confirmation_id: `confirm-${base.card_id}-r1`,
      actor_id: "commerce-withdrawal-domain-owner",
      authority_scope: {
        product_id: "synthetic-commerce-withdrawal",
        domain_ids: [input.domainId],
      },
      target: {
        kind: "evidence_card" as const,
        object_id: base.card_id,
        object_version: 1,
        projection_sha256: confirmationProjectionDigest("evidence_card", base),
      },
      decision: "confirm" as const,
      origin: {
        kind: "management_cli_operator_invocation" as const,
        profile: "eval-clowder" as const,
        command: "confirm" as const,
        invocation_sha256: (index + 1).toString(16).padStart(2, "0").repeat(32),
      },
      supporting_source_ref: owner,
      occurred_at: `2026-08-21T00:${String(index).padStart(2, "0")}:00.000Z`,
    };
    const confirmation = await ledger.write(event);
    const card = { ...base, confirmation };
    const ref = `evidence-cards/${base.card_id}/r1.json`;
    cardArtifacts.push({ ref, card, event, confirmation });
  }
  const interview = {
    schema_version: 1 as const,
    interview_id: "commerce-order-onboard-v1",
    revision: 1,
    mode: "onboard" as const,
    product_id: "synthetic-commerce-withdrawal",
    domain_ids: [...new Set(policyInputs.map((input) => input.domainId))],
    source_snapshot: [...ownerSources, ...observations.flat()],
    turns: policyInputs.map((input, index) => ({
      turn_id: `turn-${input.claimId}`,
      question_id: `question-${input.claimId}`,
      question: `What is authoritative policy for ${input.claimId}?`,
      reason: "The policy controls deterministic delivery acceptance.",
      source_ref_ids: observations[index]?.map((source) => source.source_id) ?? [],
      blocked_claim_ids: [input.claimId],
      answer: input.answer,
      answer_ref_id: ownerSources[index]?.source_id,
      status: "answered" as const,
    })),
    evidence_card_refs: cardArtifacts.map((artifact) => ({
      ref: artifact.ref,
      sha256: canonicalJsonDigest(artifact.card),
    })),
    decision_question_refs: [],
    status: "completed" as const,
    started_at: "2026-08-21T00:00:00.000Z",
    ended_at: "2026-08-21T00:10:00.000Z",
  };
  await write(`${packRoot}/${interviewRef}`, canonicalJson(interview));
  await Promise.all(
    cardArtifacts.map((artifact) =>
      write(`${packRoot}/${artifact.ref}`, canonicalJson(artifact.card)),
    ),
  );
  const contractDraft = draftProductDomainContract({
    contractId: "commerce-order-contract",
    productId: "synthetic-commerce-withdrawal",
    sourceInterview: { ref: interviewRef, interview },
    evidenceCards: cardArtifacts.map((artifact) => ({
      ref: artifact.ref,
      card: artifact.card,
      confirmation: { event: artifact.event },
    })),
  });
  const contractEvent = {
    schema_version: 1 as const,
    confirmation_id: "confirm-commerce-order-contract-v1",
    actor_id: "commerce-withdrawal-domain-owner",
    authority_scope: {
      product_id: "synthetic-commerce-withdrawal",
      domain_ids: [...new Set(policyInputs.map((input) => input.domainId))],
    },
    target: {
      kind: "product_domain_contract" as const,
      object_id: contractDraft.contract_id,
      object_version: contractDraft.version,
      projection_sha256: confirmationProjectionDigest("product_domain_contract", contractDraft),
    },
    decision: "confirm" as const,
    origin: {
      kind: "management_cli_operator_invocation" as const,
      profile: "eval-clowder" as const,
      command: "confirm" as const,
      invocation_sha256: "7".repeat(64),
    },
    supporting_source_ref: ownerSources[0],
    occurred_at: "2026-08-21T00:11:00.000Z",
  };
  const contractConfirmation = await ledger.write(contractEvent);
  const contract = issueProductDomainContract(contractDraft, { event: contractEvent });
  const contractRef = "contracts/commerce-order-contract/v1.json";
  const contractPointer = { ref: contractRef, sha256: canonicalJsonDigest(contract) };
  const requirementRef = "requirements/self-service-order-cancellation/v1.json";
  const requirementSource = {
    source_id: "requirement-self-service-order-cancellation",
    kind: "requirement" as const,
    artifact_ref: "sources/self-service-order-cancellation.md",
    digest: sha256Hex(requirementText),
  };
  const requirementBase = {
    schema_version: 1 as const,
    requirement_id: "self-service-order-cancellation",
    version: 1,
    product_id: "synthetic-commerce-withdrawal",
    requirement_refs: [requirementSource],
    base_contract: contractPointer,
    effects: {
      uses: policyInputs.slice(0, 5).map((input) => ({
        claim_id: input.claimId,
        contract_version: 1,
      })),
      preserves: policyInputs.slice(5).map((input) => ({
        claim_id: input.claimId,
        contract_version: 1,
      })),
      introduces: [],
      modifies: [],
      deprecates: [],
      conflicts_with: [],
    },
    decision_question_refs: [],
    status: "owner_confirmed" as const,
  };
  const requirementEvent = {
    schema_version: 1 as const,
    confirmation_id: "confirm-self-service-order-cancellation-v1",
    actor_id: "commerce-withdrawal-domain-owner",
    authority_scope: {
      product_id: "synthetic-commerce-withdrawal",
      domain_ids: [...new Set(policyInputs.map((input) => input.domainId))],
    },
    target: {
      kind: "requirement_change_set" as const,
      object_id: requirementBase.requirement_id,
      object_version: 1,
      projection_sha256: confirmationProjectionDigest("requirement_change_set", requirementBase),
    },
    decision: "confirm" as const,
    origin: {
      kind: "management_cli_operator_invocation" as const,
      profile: "eval-clowder" as const,
      command: "confirm" as const,
      invocation_sha256: "8".repeat(64),
    },
    supporting_source_ref: ownerSources[0],
    occurred_at: "2026-08-21T00:12:00.000Z",
  };
  const requirementConfirmation = await ledger.write(requirementEvent);
  const requirement = { ...requirementBase, confirmation: requirementConfirmation };
  const graph = buildClaimDependencyGraph({
    contract: { ref: contractRef, contract },
    requirements: [{ ref: requirementRef, requirement }],
  });
  const graphRef = `graphs/${graph.graph_id}.json`;
  const request = {
    schema_version: 1 as const,
    request_id: "readiness-self-service-order-cancellation-v1",
    product_id: "synthetic-commerce-withdrawal",
    requirements: [{ ref: requirementRef, sha256: canonicalJsonDigest(requirement) }],
    requested_by: "commerce-withdrawal-domain-owner",
    requested_at: "2026-08-21T00:13:00.000Z",
    source_ref: ownerSources[0],
  };
  const requestRef = `readiness/requests/${request.request_id}.json`;
  const readiness = buildDomainTruthReadiness({
    contract: contractPointer,
    requirements: [{ ref: requirementRef, requirement }],
    graph: { ref: graphRef, graph },
    evidenceCards: cardArtifacts.map((artifact) => ({ ref: artifact.ref, card: artifact.card })),
    decisionQuestions: [],
    request: { ref: requestRef, request },
    generatedAt: "2026-08-21T00:14:00.000Z",
  });
  const readinessRef = `readiness/reports/${readiness.report_id}.json`;
  const manifestRef = "manifests/commerce-order-withdrawal-v2.json";
  const manifest = {
    schema_version: 1 as const,
    snapshot_id: "commerce-order-withdrawal-v2",
    product_id: "synthetic-commerce-withdrawal",
    contract: contractPointer,
    interviews: [{ ref: interviewRef, sha256: canonicalJsonDigest(interview) }],
    evidence_cards: cardArtifacts.map((artifact) => ({
      ref: artifact.ref,
      sha256: canonicalJsonDigest(artifact.card),
    })),
    confirmations: [
      ...cardArtifacts.map((artifact) => artifact.confirmation),
      contractConfirmation,
      requirementConfirmation,
    ],
    decision_questions: [],
    requirements: [{ ref: requirementRef, sha256: canonicalJsonDigest(requirement) }],
    graph: { ref: graphRef, sha256: canonicalJsonDigest(graph) },
    readiness_request: { ref: requestRef, sha256: canonicalJsonDigest(request) },
    readiness_report: { ref: readinessRef, sha256: canonicalJsonDigest(readiness) },
  };
  await Promise.all([
    write(`${packRoot}/${contractRef}`, canonicalJson(contract)),
    write(`${packRoot}/${requirementRef}`, canonicalJson(requirement)),
    write(`${packRoot}/${graphRef}`, canonicalJson(graph)),
    write(`${packRoot}/${requestRef}`, canonicalJson(request)),
    write(`${packRoot}/${readinessRef}`, canonicalJson(readiness)),
    write(`${packRoot}/${manifestRef}`, canonicalJson(manifest)),
  ]);
  return { manifestRef, confirmationLedger: ledger };
}
