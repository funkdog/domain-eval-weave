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
import { validObservationCatalog } from "./phase3b-fixtures.js";

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
}

const catalogRef = "sources/claim-observation-catalog.json";

function observationSource(index: number) {
  const entry = validObservationCatalog.behaviors[index];
  if (entry === undefined) throw new Error(`missing synthetic catalog entry ${index}`);
  return {
    source_id: `ledger-observation-${entry.behavior_id}`,
    kind: "test" as const,
    artifact_ref: catalogRef,
    digest: canonicalJsonDigest(entry),
    locator: `/behaviors/${index}`,
  };
}

export async function writeSyntheticReservationDomainPack(projectRoot: string): Promise<{
  readonly manifestRef: string;
  readonly confirmationLedger: OwnerConfirmationLedger;
}> {
  const packRoot = `${projectRoot}/domain-eval`;
  const confirmationLedger = new OwnerConfirmationLedger(
    `${projectRoot}/test-runtime/domain-confirmations`,
  );
  const interviewRef = "interviews/reservation-onboard-v1/r1.json";
  const commandAnswer = "Reservation commands obey idempotent create and terminal replay rules.";
  const stateAnswer = "Reservation state remains bounded, durable, fail-closed, and deterministic.";
  const commandOwner = {
    source_id: "owner-reservation-command-contract",
    kind: "owner_statement" as const,
    artifact_ref: interviewRef,
    digest: canonicalJsonDigest(commandAnswer),
    locator: "/turns/0/answer",
  };
  const stateOwner = {
    source_id: "owner-reservation-state-integrity",
    kind: "owner_statement" as const,
    artifact_ref: interviewRef,
    digest: canonicalJsonDigest(stateAnswer),
    locator: "/turns/1/answer",
  };
  const commandObservations = [0, 1, 2, 4].map(observationSource);
  const stateObservations = [3, 5, 6, 7].map(observationSource);
  await write(`${packRoot}/${catalogRef}`, `${canonicalJson(validObservationCatalog)}\n`);
  const requirementText = [
    "# Implement Reservation Ledger",
    "Implement the confirmed command contract while preserving state integrity.",
    "",
  ].join("\n");
  await write(`${packRoot}/sources/implement-reservation-ledger.md`, requirementText);

  const cardBases = [
    {
      schema_version: 1 as const,
      card_id: "card-reservation-command-contract",
      revision: 1,
      product_id: "synthetic-reservations",
      domain_id: "reservations",
      claim_id: "reservation-command-contract",
      statement: "Commands reserve and replay with a stable idempotency contract.",
      applicability: "Every reservation command.",
      status: "confirmed" as const,
      source_refs: [commandOwner, ...commandObservations],
      authority_ref_ids: [commandOwner.source_id],
      observation_ref_ids: commandObservations.map((source) => source.source_id),
      false_accept_risk: "high" as const,
      false_reject_risk: "medium" as const,
    },
    {
      schema_version: 1 as const,
      card_id: "card-reservation-state-integrity",
      revision: 1,
      product_id: "synthetic-reservations",
      domain_id: "reliability",
      claim_id: "reservation-state-integrity",
      statement: "State remains bounded, durable, fail-closed, and deterministic.",
      applicability: "Every persisted reservation ledger.",
      status: "confirmed" as const,
      source_refs: [stateOwner, ...stateObservations],
      authority_ref_ids: [stateOwner.source_id],
      observation_ref_ids: stateObservations.map((source) => source.source_id),
      false_accept_risk: "critical" as const,
      false_reject_risk: "high" as const,
    },
  ];
  const cardArtifacts = [];
  for (const [index, base] of cardBases.entries()) {
    const owner = index === 0 ? commandOwner : stateOwner;
    const event = {
      schema_version: 1 as const,
      confirmation_id: `confirm-${base.card_id}-r1`,
      actor_id: "domain-owner-reservations",
      authority_scope: {
        product_id: "synthetic-reservations",
        domain_ids: [base.domain_id],
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
        invocation_sha256: index === 0 ? "1".repeat(64) : "2".repeat(64),
      },
      supporting_source_ref: owner,
      occurred_at: `2026-08-21T00:0${index}:00.000Z`,
    };
    const confirmation = await confirmationLedger.write(event);
    const card = { ...base, confirmation };
    const ref = `evidence-cards/${base.card_id}/r1.json`;
    cardArtifacts.push({ ref, card, event, confirmation });
  }
  const interview = {
    schema_version: 1 as const,
    interview_id: "reservation-onboard-v1",
    revision: 1,
    mode: "onboard" as const,
    product_id: "synthetic-reservations",
    domain_ids: ["reservations", "reliability"],
    source_snapshot: [commandOwner, stateOwner, ...commandObservations, ...stateObservations],
    turns: [
      {
        turn_id: "turn-command-contract",
        question_id: "question-command-contract",
        question: "What command replay behavior is product truth?",
        reason: "Command semantics define requirement delivery.",
        source_ref_ids: commandObservations.map((source) => source.source_id),
        blocked_claim_ids: ["reservation-command-contract"],
        answer: commandAnswer,
        answer_ref_id: commandOwner.source_id,
        status: "answered" as const,
      },
      {
        turn_id: "turn-state-integrity",
        question_id: "question-state-integrity",
        question: "Which state integrity rules must every change preserve?",
        reason: "Persistence and bounds are shared product truth.",
        source_ref_ids: stateObservations.map((source) => source.source_id),
        blocked_claim_ids: ["reservation-state-integrity"],
        answer: stateAnswer,
        answer_ref_id: stateOwner.source_id,
        status: "answered" as const,
      },
    ],
    evidence_card_refs: cardArtifacts.map((artifact) => ({
      ref: artifact.ref,
      sha256: canonicalJsonDigest(artifact.card),
    })),
    decision_question_refs: [],
    status: "completed" as const,
    started_at: "2026-08-21T00:00:00.000Z",
    ended_at: "2026-08-21T00:05:00.000Z",
  };
  await write(`${packRoot}/${interviewRef}`, `${canonicalJson(interview)}\n`);
  for (const artifact of cardArtifacts) {
    await write(`${packRoot}/${artifact.ref}`, `${canonicalJson(artifact.card)}\n`);
  }

  const contractDraft = draftProductDomainContract({
    contractId: "reservation-ledger-contract",
    productId: "synthetic-reservations",
    sourceInterview: { ref: interviewRef, interview },
    evidenceCards: cardArtifacts.map((artifact) => ({
      ref: artifact.ref,
      card: artifact.card,
      confirmation: { event: artifact.event },
    })),
  });
  const contractEvent = {
    schema_version: 1 as const,
    confirmation_id: "confirm-reservation-ledger-contract-v1",
    actor_id: "domain-owner-reservations",
    authority_scope: {
      product_id: "synthetic-reservations",
      domain_ids: ["reservations", "reliability"],
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
      invocation_sha256: "3".repeat(64),
    },
    supporting_source_ref: commandOwner,
    occurred_at: "2026-08-21T00:10:00.000Z",
  };
  const contractConfirmation = await confirmationLedger.write(contractEvent);
  const contract = issueProductDomainContract(contractDraft, { event: contractEvent });
  const contractRef = "contracts/reservation-ledger-contract/v1.json";
  const contractPointer = { ref: contractRef, sha256: canonicalJsonDigest(contract) };
  const requirementRef = "requirements/implement-reservation-ledger/v1.json";
  const requirementSource = {
    source_id: "requirement-implement-reservation-ledger",
    kind: "requirement" as const,
    artifact_ref: "sources/implement-reservation-ledger.md",
    digest: sha256Hex(requirementText),
  };
  const requirementBase = {
    schema_version: 1 as const,
    requirement_id: "implement-reservation-ledger",
    version: 1,
    product_id: "synthetic-reservations",
    requirement_refs: [requirementSource],
    base_contract: contractPointer,
    effects: {
      uses: [{ claim_id: "reservation-command-contract", contract_version: 1 }],
      preserves: [{ claim_id: "reservation-state-integrity", contract_version: 1 }],
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
    confirmation_id: "confirm-implement-reservation-ledger-v1",
    actor_id: "domain-owner-reservations",
    authority_scope: {
      product_id: "synthetic-reservations",
      domain_ids: ["reservations", "reliability"],
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
      invocation_sha256: "4".repeat(64),
    },
    supporting_source_ref: commandOwner,
    occurred_at: "2026-08-21T00:15:00.000Z",
  };
  const requirementConfirmation = await confirmationLedger.write(requirementEvent);
  const requirement = { ...requirementBase, confirmation: requirementConfirmation };
  const graph = buildClaimDependencyGraph({
    contract: { ref: contractRef, contract },
    requirements: [{ ref: requirementRef, requirement }],
  });
  const graphRef = `graphs/${graph.graph_id}.json`;
  const request = {
    schema_version: 1 as const,
    request_id: "readiness-implement-reservation-ledger-v1",
    product_id: "synthetic-reservations",
    requirements: [{ ref: requirementRef, sha256: canonicalJsonDigest(requirement) }],
    requested_by: "domain-owner-reservations",
    requested_at: "2026-08-21T00:19:00.000Z",
    source_ref: commandOwner,
  };
  const requestRef = `readiness/requests/${request.request_id}.json`;
  const readiness = buildDomainTruthReadiness({
    contract: contractPointer,
    requirements: [{ ref: requirementRef, requirement }],
    graph: { ref: graphRef, graph },
    evidenceCards: cardArtifacts.map((artifact) => ({
      ref: artifact.ref,
      card: artifact.card,
    })),
    decisionQuestions: [],
    request: { ref: requestRef, request },
    generatedAt: "2026-08-21T00:20:00.000Z",
  });
  const readinessRef = `readiness/reports/${readiness.report_id}.json`;
  const manifestRef = "manifests/reservation-ledger-domain-v1.json";
  const manifest = {
    schema_version: 1 as const,
    snapshot_id: "reservation-ledger-domain-v1",
    product_id: "synthetic-reservations",
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
    write(`${packRoot}/${contractRef}`, `${canonicalJson(contract)}\n`),
    write(`${packRoot}/${requirementRef}`, `${canonicalJson(requirement)}\n`),
    write(`${packRoot}/${graphRef}`, `${canonicalJson(graph)}\n`),
    write(`${packRoot}/${requestRef}`, `${canonicalJson(request)}\n`),
    write(`${packRoot}/${readinessRef}`, `${canonicalJson(readiness)}\n`),
    write(`${packRoot}/${manifestRef}`, `${canonicalJson(manifest)}\n`),
  ]);
  return { manifestRef, confirmationLedger };
}
