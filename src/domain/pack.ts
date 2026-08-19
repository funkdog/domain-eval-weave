import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import { packageRelativeRefSchema } from "../contracts/phase2.js";
import { assertOwnerConfirmation } from "./confirmation.js";
import { OwnerConfirmationLedger } from "./confirmation-ledger.js";
import {
  type ClaimDependencyGraph,
  type DomainDecisionQuestion,
  type DomainEvidenceCard,
  type DomainInterviewSession,
  type DomainPackManifest,
  type DomainReadinessRequest,
  type DomainSourceRef,
  type DomainTruthReadiness,
  type OwnerConfirmationEvent,
  type ProductDomainContract,
  parseClaimDependencyGraph,
  parseDomainDecisionQuestion,
  parseDomainEvidenceCard,
  parseDomainInterviewSession,
  parseDomainPackManifest,
  parseDomainReadinessRequest,
  parseDomainTruthReadiness,
  parseProductDomainContract,
  parseRequirementChangeSet,
  type RequirementChangeSet,
} from "./contracts.js";
import { buildClaimDependencyGraph } from "./graph.js";
import { assertProductDomainContractSuccessor } from "./promotion.js";
import { buildDomainTruthReadiness } from "./readiness.js";

export class DomainPackError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainPackError";
    this.code = code;
  }
}

interface Artifact<T> {
  readonly ref: string;
  readonly value: T;
}

export interface ValidatedDomainPack {
  readonly root: string;
  readonly manifest: DomainPackManifest;
  readonly interviews: readonly Artifact<DomainInterviewSession>[];
  readonly evidenceCards: readonly Artifact<DomainEvidenceCard>[];
  readonly confirmations: readonly Artifact<OwnerConfirmationEvent>[];
  readonly decisionQuestions: readonly Artifact<DomainDecisionQuestion>[];
  readonly contract: ProductDomainContract;
  readonly requirements: readonly Artifact<RequirementChangeSet>[];
  readonly graph: ClaimDependencyGraph;
  readonly request: DomainReadinessRequest;
  readonly readiness: DomainTruthReadiness;
}

function contained(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

async function assertPhysicalDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory() || (await realpath(path)) !== path) {
    throw new DomainPackError(
      "DOMAIN_PACK_PATH_INVALID",
      "domain pack root must be a physical directory",
    );
  }
}

async function resolvePackRoot(projectRoot: string, packRef: string): Promise<string> {
  const root = resolve(projectRoot);
  await assertPhysicalDirectory(root);
  let normalized: string;
  try {
    normalized = packageRelativeRefSchema.parse(packRef);
  } catch {
    throw new DomainPackError(
      "DOMAIN_PACK_PATH_INVALID",
      "domain pack path must be project-relative",
    );
  }
  const packRoot = resolve(root, normalized);
  if (!contained(root, packRoot)) {
    throw new DomainPackError("DOMAIN_PACK_PATH_INVALID", "domain pack path escapes project root");
  }
  await assertPhysicalDirectory(packRoot);
  return packRoot;
}

async function resolvePhysicalFile(packRoot: string, ref: string): Promise<string> {
  let normalized: string;
  try {
    normalized = packageRelativeRefSchema.parse(ref);
  } catch {
    throw new DomainPackError("DOMAIN_PACK_REF_INVALID", `invalid domain pack ref: ${ref}`);
  }
  const target = resolve(packRoot, normalized);
  if (!contained(packRoot, target)) {
    throw new DomainPackError("DOMAIN_PACK_REF_INVALID", `domain pack ref escapes root: ${ref}`);
  }
  let current = packRoot;
  for (const segment of relative(packRoot, target).split("/")) {
    current = resolve(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) {
      throw new DomainPackError(
        "DOMAIN_PACK_REF_INVALID",
        `domain pack ref crosses a symlink: ${ref}`,
      );
    }
  }
  const entry = await lstat(target);
  if (!entry.isFile()) {
    throw new DomainPackError(
      "DOMAIN_PACK_REF_INVALID",
      `domain pack ref is not a regular file: ${ref}`,
    );
  }
  return target;
}

async function readCanonicalArtifact<T>(
  packRoot: string,
  ref: string,
  parser: (value: unknown) => T,
): Promise<T> {
  const path = await resolvePhysicalFile(packRoot, ref);
  const source = await readFile(path, "utf8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new DomainPackError("DOMAIN_PACK_JSON_INVALID", `domain pack JSON is invalid: ${ref}`);
  }
  let parsed: T;
  try {
    parsed = parser(decoded);
  } catch {
    throw new DomainPackError(
      "DOMAIN_PACK_SCHEMA_INVALID",
      `domain pack contract is invalid: ${ref}`,
    );
  }
  if (source !== canonicalJson(parsed) && source !== `${canonicalJson(parsed)}\n`) {
    throw new DomainPackError(
      "DOMAIN_PACK_JSON_INVALID",
      `domain pack JSON is not canonical: ${ref}`,
    );
  }
  return parsed;
}

function jsonPointerValue(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) throw new Error("not a JSON pointer");
  let current = document;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) throw new Error("invalid array pointer");
      current = current[Number(segment)];
    } else if (typeof current === "object" && current !== null) {
      if (!Object.hasOwn(current, segment)) throw new Error("missing object pointer");
      current = (current as Record<string, unknown>)[segment];
    } else {
      throw new Error("pointer crosses a scalar");
    }
    if (current === undefined) throw new Error("pointer is missing");
  }
  return current;
}

export async function verifyDomainSourceRef(
  packRoot: string,
  source: DomainSourceRef,
): Promise<void> {
  const path = await resolvePhysicalFile(packRoot, source.artifact_ref);
  const bytes = await readFile(path);
  let actual: string;
  if (source.locator?.startsWith("/")) {
    let document: unknown;
    try {
      document = JSON.parse(bytes.toString("utf8"));
      actual = canonicalJsonDigest(jsonPointerValue(document, source.locator));
    } catch {
      throw new DomainPackError(
        "DOMAIN_SOURCE_INVALID",
        `source JSON pointer cannot be resolved: ${source.source_id}`,
      );
    }
  } else {
    actual = sha256Hex(bytes);
  }
  if (actual !== source.digest) {
    throw new DomainPackError("DOMAIN_SOURCE_DRIFT", `source digest drifted: ${source.source_id}`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function validateDomainPackInner(
  projectRoot: string,
  packRef: string,
  manifestRef: string,
  confirmationLedger: OwnerConfirmationLedger,
): Promise<ValidatedDomainPack> {
  const packRoot = await resolvePackRoot(projectRoot, packRef);
  if (!/^manifests\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(manifestRef)) {
    throw new DomainPackError(
      "DOMAIN_PACK_MANIFEST_INVALID",
      "manifest ref must name an immutable manifest artifact",
    );
  }
  const manifest = await readCanonicalArtifact(packRoot, manifestRef, parseDomainPackManifest);
  const readPointer = async <T>(
    pointer: { readonly ref: string; readonly sha256: string },
    parser: (value: unknown) => T,
  ): Promise<Artifact<T>> => {
    const value = await readCanonicalArtifact(packRoot, pointer.ref, parser);
    if (canonicalJsonDigest(value) !== pointer.sha256) {
      throw new DomainPackError(
        "DOMAIN_PACK_POINTER_DRIFT",
        `manifest pointer digest drifted: ${pointer.ref}`,
      );
    }
    return { ref: pointer.ref, value };
  };
  const readPredecessorChain = async <
    T extends {
      readonly product_id: string;
      readonly predecessor?: { readonly ref: string; readonly sha256: string } | undefined;
    },
  >(
    current: Artifact<T>,
    parser: (value: unknown) => T,
    sequenceOf: (value: T) => number,
    identityOf: (value: T) => string,
    canonicalRefOf: (value: T) => string,
    allowCandidatePredecessor: boolean,
  ): Promise<readonly Artifact<T>[]> => {
    const history: Artifact<T>[] = [current];
    const seen = new Set([current.ref]);
    let cursor = current;
    while (cursor.value.predecessor !== undefined) {
      const pointer = cursor.value.predecessor;
      if (seen.has(pointer.ref)) {
        throw new DomainPackError(
          "DOMAIN_PREDECESSOR_INVALID",
          "predecessor chain contains a cycle",
        );
      }
      const predecessor = await readPointer(pointer, parser);
      const canonicalRef = canonicalRefOf(predecessor.value);
      if (
        sequenceOf(predecessor.value) !== sequenceOf(cursor.value) - 1 ||
        identityOf(predecessor.value) !== identityOf(cursor.value) ||
        predecessor.value.product_id !== cursor.value.product_id ||
        (predecessor.ref !== canonicalRef &&
          !(
            allowCandidatePredecessor &&
            /^candidates\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(predecessor.ref)
          ))
      ) {
        throw new DomainPackError(
          "DOMAIN_PREDECESSOR_INVALID",
          `predecessor chain is not contiguous for ${cursor.ref}`,
        );
      }
      seen.add(predecessor.ref);
      history.push(predecessor);
      cursor = predecessor;
    }
    return history;
  };
  const [
    interviews,
    evidenceCards,
    confirmations,
    decisionQuestions,
    requirements,
    contract,
    graph,
    request,
    readiness,
  ] = await Promise.all([
    Promise.all(
      manifest.interviews.map((pointer) => readPointer(pointer, parseDomainInterviewSession)),
    ),
    Promise.all(
      manifest.evidence_cards.map((pointer) => readPointer(pointer, parseDomainEvidenceCard)),
    ),
    Promise.all(
      manifest.confirmations.map(async (pointer) => ({
        ref: pointer.confirmation_id,
        value: await confirmationLedger.read(pointer),
      })),
    ),
    Promise.all(
      manifest.decision_questions.map((pointer) =>
        readPointer(pointer, parseDomainDecisionQuestion),
      ),
    ),
    Promise.all(
      manifest.requirements.map((pointer) => readPointer(pointer, parseRequirementChangeSet)),
    ),
    readPointer(manifest.contract, parseProductDomainContract).then((artifact) => artifact.value),
    readPointer(manifest.graph, parseClaimDependencyGraph).then((artifact) => artifact.value),
    readPointer(manifest.readiness_request, parseDomainReadinessRequest).then(
      (artifact) => artifact.value,
    ),
    readPointer(manifest.readiness_report, parseDomainTruthReadiness).then(
      (artifact) => artifact.value,
    ),
  ]);
  if (manifest.product_id !== contract.product_id) {
    throw new DomainPackError("DOMAIN_PACK_MANIFEST_INVALID", "manifest product identity drifted");
  }
  const immutablePathsValid =
    manifestRef === `manifests/${manifest.snapshot_id}.json` &&
    manifest.contract.ref === `contracts/${contract.contract_id}/v${contract.version}.json` &&
    interviews.every(
      (artifact) =>
        artifact.ref ===
        `interviews/${artifact.value.interview_id}/r${artifact.value.revision}.json`,
    ) &&
    evidenceCards.every(
      (artifact) =>
        artifact.ref ===
        `evidence-cards/${artifact.value.card_id}/r${artifact.value.revision}.json`,
    ) &&
    decisionQuestions.every(
      (artifact) =>
        artifact.ref ===
        `decision-questions/${artifact.value.question_id}/r${artifact.value.revision}.json`,
    ) &&
    requirements.every(
      (artifact) =>
        artifact.ref ===
        `requirements/${artifact.value.requirement_id}/v${artifact.value.version}.json`,
    ) &&
    manifest.graph.ref === `graphs/${graph.graph_id}.json` &&
    manifest.readiness_request.ref === `readiness/requests/${request.request_id}.json` &&
    manifest.readiness_report.ref === `readiness/reports/${readiness.report_id}.json`;
  if (!immutablePathsValid) {
    throw new DomainPackError(
      "DOMAIN_PACK_MANIFEST_INVALID",
      "manifest pointers do not follow immutable identity/version paths",
    );
  }

  const [interviewHistories, evidenceCardHistories, questionHistories, requirementHistories] =
    await Promise.all([
      Promise.all(
        interviews.map((artifact) =>
          readPredecessorChain(
            artifact,
            parseDomainInterviewSession,
            (value) => value.revision,
            (value) => value.interview_id,
            (value) => `interviews/${value.interview_id}/r${value.revision}.json`,
            false,
          ),
        ),
      ),
      Promise.all(
        evidenceCards.map((artifact) =>
          readPredecessorChain(
            artifact,
            parseDomainEvidenceCard,
            (value) => value.revision,
            (value) => value.card_id,
            (value) => `evidence-cards/${value.card_id}/r${value.revision}.json`,
            true,
          ),
        ),
      ),
      Promise.all(
        decisionQuestions.map((artifact) =>
          readPredecessorChain(
            artifact,
            parseDomainDecisionQuestion,
            (value) => value.revision,
            (value) => value.question_id,
            (value) => `decision-questions/${value.question_id}/r${value.revision}.json`,
            true,
          ),
        ),
      ),
      Promise.all(
        requirements.map((artifact) =>
          readPredecessorChain(
            artifact,
            parseRequirementChangeSet,
            (value) => value.version,
            (value) => value.requirement_id,
            (value) => `requirements/${value.requirement_id}/v${value.version}.json`,
            true,
          ),
        ),
      ),
    ]);
  const contractHistory = await readPredecessorChain(
    { ref: manifest.contract.ref, value: contract },
    parseProductDomainContract,
    (value) => value.version,
    (value) => value.contract_id,
    (value) => `contracts/${value.contract_id}/v${value.version}.json`,
    false,
  );
  const primaryProductIds = [
    manifest.product_id,
    request.product_id,
    readiness.product_id,
    graph.product_id,
    ...interviewHistories.flatMap((history) =>
      history.map((artifact) => artifact.value.product_id),
    ),
    ...evidenceCardHistories.flatMap((history) =>
      history.map((artifact) => artifact.value.product_id),
    ),
    ...questionHistories.flatMap((history) => history.map((artifact) => artifact.value.product_id)),
    ...requirementHistories.flatMap((history) =>
      history.map((artifact) => artifact.value.product_id),
    ),
    ...contractHistory.map((artifact) => artifact.value.product_id),
  ];
  if (primaryProductIds.some((productId) => productId !== manifest.product_id)) {
    throw new DomainPackError(
      "DOMAIN_PACK_MANIFEST_INVALID",
      "manifest primary artifact product identities drifted",
    );
  }

  const allSources = [
    ...interviewHistories.flatMap((history) =>
      history.flatMap((artifact) => artifact.value.source_snapshot),
    ),
    ...evidenceCardHistories.flatMap((history) =>
      history.flatMap((artifact) => artifact.value.source_refs),
    ),
    ...confirmations.flatMap((artifact) =>
      artifact.value.supporting_source_ref === undefined
        ? []
        : [artifact.value.supporting_source_ref],
    ),
    ...requirementHistories.flatMap((history) =>
      history.flatMap((artifact) => artifact.value.requirement_refs),
    ),
    ...contractHistory.flatMap((artifact) =>
      artifact.value.claims.flatMap((claim) => [
        ...claim.authority_refs,
        ...claim.observation_refs,
      ]),
    ),
    request.source_ref,
  ];
  const uniqueSources = new Map(
    allSources.map((source) => [`${source.source_id}\0${canonicalJson(source)}`, source]),
  );
  await Promise.all(
    [...uniqueSources.values()].map((source) => verifyDomainSourceRef(packRoot, source)),
  );

  const confirmationsByRef = new Map(
    confirmations.map((artifact) => [artifact.value.confirmation_id, artifact.value]),
  );

  const confirmationFor = (
    pointer: { readonly confirmation_id: string; readonly sha256: string } | undefined,
  ): OwnerConfirmationEvent => {
    const event =
      pointer === undefined ? undefined : confirmationsByRef.get(pointer.confirmation_id);
    if (event === undefined || canonicalJsonDigest(event) !== pointer?.sha256) {
      throw new DomainPackError(
        "DOMAIN_CONFIRMATION_INVALID",
        "authority pointer does not bind an OwnerConfirmationEvent",
      );
    }
    return event;
  };
  for (const artifact of contractHistory) {
    const sourceInterviewArtifact = await readPointer(
      artifact.value.source_interview,
      parseDomainInterviewSession,
    );
    const sourceInterview = sourceInterviewArtifact.value;
    if (
      sourceInterviewArtifact.ref !==
        `interviews/${sourceInterview.interview_id}/r${sourceInterview.revision}.json` ||
      sourceInterview.product_id !== artifact.value.product_id ||
      sourceInterview.status !== "completed" ||
      canonicalJsonDigest(sourceInterview.source_snapshot) !== artifact.value.source_snapshot_digest
    ) {
      throw new DomainPackError(
        "DOMAIN_CONTRACT_PROMOTION_INVALID",
        "Contract source Interview or snapshot digest drifted",
      );
    }
    await Promise.all(
      sourceInterview.source_snapshot.map((source) => verifyDomainSourceRef(packRoot, source)),
    );
  }
  for (const history of evidenceCardHistories) {
    for (const artifact of history) {
      if (artifact.value.status !== "confirmed") continue;
      if (
        artifact.ref !== `evidence-cards/${artifact.value.card_id}/r${artifact.value.revision}.json`
      ) {
        throw new DomainPackError(
          "DOMAIN_EVIDENCE_INVALID",
          "confirmed Evidence Card must use its canonical revision path",
        );
      }
      assertOwnerConfirmation(
        confirmationFor(artifact.value.confirmation),
        "evidence_card",
        artifact.value,
        "confirm",
      );
    }
  }

  const cardsByRef = new Map(evidenceCards.map((artifact) => [artifact.ref, artifact.value]));
  for (const contractArtifact of contractHistory) {
    for (const claim of contractArtifact.value.claims) {
      const cardArtifact = await readPointer(claim.evidence_card, parseDomainEvidenceCard);
      const card = cardArtifact.value;
      if (
        cardArtifact.ref !== `evidence-cards/${card.card_id}/r${card.revision}.json` ||
        card.status !== "confirmed" ||
        card.product_id !== contractArtifact.value.product_id ||
        card.claim_id !== claim.claim_id ||
        card.domain_id !== claim.domain_id ||
        card.statement !== claim.statement ||
        card.applicability !== claim.applicability ||
        card.false_accept_risk !== claim.false_accept_risk ||
        card.false_reject_risk !== claim.false_reject_risk
      ) {
        throw new DomainPackError(
          "DOMAIN_CONTRACT_PROMOTION_INVALID",
          `Contract Claim is not backed by its confirmed Evidence Card: ${claim.claim_id}`,
        );
      }
      assertOwnerConfirmation(confirmationFor(card.confirmation), "evidence_card", card, "confirm");
    }
  }
  for (let index = 0; index < contractHistory.length - 1; index += 1) {
    const current = contractHistory[index]?.value;
    const predecessor = contractHistory[index + 1];
    if (current === undefined || predecessor === undefined) continue;
    try {
      assertProductDomainContractSuccessor({
        predecessorRef: predecessor.ref,
        predecessor: predecessor.value,
        successor: current,
      });
    } catch {
      throw new DomainPackError(
        "DOMAIN_CONTRACT_HISTORY_INVALID",
        `Contract successor history is invalid: ${contractHistory[index]?.ref}`,
      );
    }
  }
  if (contract.state !== "issued") {
    throw new DomainPackError("DOMAIN_CONTRACT_PROMOTION_INVALID", "pack Contract must be issued");
  }
  for (const artifact of contractHistory) {
    const contractEvent = assertOwnerConfirmation(
      confirmationFor(artifact.value.confirmation),
      "product_domain_contract",
      artifact.value,
      "confirm",
    );
    if (
      artifact.value.decided_by !== contractEvent.actor_id ||
      artifact.value.decided_at !== contractEvent.occurred_at
    ) {
      throw new DomainPackError(
        "DOMAIN_CONTRACT_PROMOTION_INVALID",
        "Contract issuance fields do not match confirmation event",
      );
    }
  }
  const requirementInputs = requirements.map((artifact) => ({
    ref: artifact.ref,
    requirement: artifact.value,
  }));
  if (!sameJson(request.requirements, manifest.requirements)) {
    throw new DomainPackError(
      "DOMAIN_READINESS_REQUEST_INVALID",
      "readiness request must bind the exact manifest Requirement set",
    );
  }
  for (const history of requirementHistories) {
    for (const artifact of history) {
      if (artifact.value.status === "draft") continue;
      if (
        artifact.ref !==
        `requirements/${artifact.value.requirement_id}/v${artifact.value.version}.json`
      ) {
        throw new DomainPackError(
          "DOMAIN_REQUIREMENT_INVALID",
          "owner-confirmed Requirement must use its canonical version path",
        );
      }
      assertOwnerConfirmation(
        confirmationFor(artifact.value.confirmation),
        "requirement_change_set",
        artifact.value,
        "confirm",
      );
    }
  }
  const questionByRef = new Map(
    decisionQuestions.map((artifact) => [artifact.ref, artifact.value]),
  );
  for (const history of interviewHistories) {
    for (const artifact of history) {
      for (const pointer of artifact.value.evidence_card_refs) {
        const cardArtifact = await readPointer(pointer, parseDomainEvidenceCard);
        const card = cardArtifact.value;
        if (card.product_id !== artifact.value.product_id) {
          throw new DomainPackError(
            "DOMAIN_EVIDENCE_INVALID",
            "historical Interview evidence-card ownership drifted",
          );
        }
        if (card.status === "confirmed") {
          if (cardArtifact.ref !== `evidence-cards/${card.card_id}/r${card.revision}.json`) {
            throw new DomainPackError(
              "DOMAIN_EVIDENCE_INVALID",
              "historical confirmed Card uses a non-canonical path",
            );
          }
          assertOwnerConfirmation(
            confirmationFor(card.confirmation),
            "evidence_card",
            card,
            "confirm",
          );
        }
      }
      for (const pointer of artifact.value.decision_question_refs) {
        const questionArtifact = await readPointer(pointer, parseDomainDecisionQuestion);
        const question = questionArtifact.value;
        if (question.product_id !== artifact.value.product_id) {
          throw new DomainPackError(
            "DOMAIN_DECISION_INVALID",
            "historical Interview decision-question ownership drifted",
          );
        }
        if (question.status === "resolved") {
          if (
            questionArtifact.ref !==
            `decision-questions/${question.question_id}/r${question.revision}.json`
          ) {
            throw new DomainPackError(
              "DOMAIN_DECISION_INVALID",
              "historical resolved question uses a non-canonical path",
            );
          }
          assertOwnerConfirmation(
            confirmationFor(question.resolution_confirmation),
            "decision_question",
            question,
            "confirm",
          );
        }
      }
    }
  }
  for (const history of requirementHistories) {
    for (const artifact of history) {
      const baseContractArtifact = await readPointer(
        artifact.value.base_contract,
        parseProductDomainContract,
      );
      const baseContract = baseContractArtifact.value;
      if (baseContract.product_id !== artifact.value.product_id) {
        throw new DomainPackError(
          "DOMAIN_REQUIREMENT_INVALID",
          "historical Requirement base Contract ownership drifted",
        );
      }
      if (
        baseContractArtifact.ref !==
        `contracts/${baseContract.contract_id}/v${baseContract.version}.json`
      ) {
        throw new DomainPackError(
          "DOMAIN_REQUIREMENT_INVALID",
          "Requirement base Contract uses a non-canonical path",
        );
      }
      assertOwnerConfirmation(
        confirmationFor(baseContract.confirmation),
        "product_domain_contract",
        baseContract,
        "confirm",
      );
      for (const pointer of artifact.value.decision_question_refs) {
        const questionArtifact = await readPointer(pointer, parseDomainDecisionQuestion);
        const question = questionArtifact.value;
        if (
          question.product_id !== artifact.value.product_id ||
          (question.requirement_id !== undefined &&
            question.requirement_id !== artifact.value.requirement_id)
        ) {
          throw new DomainPackError(
            "DOMAIN_DECISION_INVALID",
            "historical Requirement decision-question ownership drifted",
          );
        }
        if (question.status === "resolved") {
          if (
            questionArtifact.ref !==
            `decision-questions/${question.question_id}/r${question.revision}.json`
          ) {
            throw new DomainPackError(
              "DOMAIN_DECISION_INVALID",
              "Requirement resolved question uses a non-canonical path",
            );
          }
          assertOwnerConfirmation(
            confirmationFor(question.resolution_confirmation),
            "decision_question",
            question,
            "confirm",
          );
        }
      }
    }
  }
  for (const artifact of requirements) {
    for (const pointer of artifact.value.decision_question_refs) {
      const question = questionByRef.get(pointer.ref);
      if (
        question === undefined ||
        canonicalJsonDigest(question) !== pointer.sha256 ||
        question.product_id !== artifact.value.product_id ||
        (question.requirement_id !== undefined &&
          question.requirement_id !== artifact.value.requirement_id)
      ) {
        throw new DomainPackError(
          "DOMAIN_DECISION_INVALID",
          "Requirement decision-question pointer or ownership drifted",
        );
      }
    }
  }
  for (const interview of interviews) {
    for (const pointer of interview.value.evidence_card_refs) {
      const card = cardsByRef.get(pointer.ref);
      if (card === undefined || canonicalJsonDigest(card) !== pointer.sha256) {
        throw new DomainPackError(
          "DOMAIN_EVIDENCE_INVALID",
          "Interview evidence-card pointer drifted",
        );
      }
    }
    for (const pointer of interview.value.decision_question_refs) {
      const question = questionByRef.get(pointer.ref);
      if (question === undefined || canonicalJsonDigest(question) !== pointer.sha256) {
        throw new DomainPackError(
          "DOMAIN_DECISION_INVALID",
          "Interview decision question pointer drifted",
        );
      }
    }
  }
  for (const history of questionHistories) {
    for (const artifact of history) {
      if (artifact.value.status === "open") continue;
      if (
        artifact.ref !==
        `decision-questions/${artifact.value.question_id}/r${artifact.value.revision}.json`
      ) {
        throw new DomainPackError(
          "DOMAIN_DECISION_INVALID",
          "resolved DecisionQuestion must use its canonical revision path",
        );
      }
      assertOwnerConfirmation(
        confirmationFor(artifact.value.resolution_confirmation),
        "decision_question",
        artifact.value,
        "confirm",
      );
    }
  }
  const rebuiltGraph = buildClaimDependencyGraph({
    contract: { ref: manifest.contract.ref, contract },
    requirements: requirementInputs,
  });
  if (!sameJson(rebuiltGraph, graph)) {
    throw new DomainPackError(
      "DOMAIN_GRAPH_DRIFT",
      "stored Claim graph does not match primary artifacts",
    );
  }
  const rebuiltReadiness = buildDomainTruthReadiness({
    contract: { ref: manifest.contract.ref, sha256: canonicalJsonDigest(contract) },
    requirements: requirementInputs,
    graph: { ref: manifest.graph.ref, graph },
    evidenceCards: evidenceCards.map((artifact) => ({ ref: artifact.ref, card: artifact.value })),
    decisionQuestions: decisionQuestions.map((artifact) => ({
      ref: artifact.ref,
      question: artifact.value,
    })),
    request: { ref: manifest.readiness_request.ref, request },
    generatedAt: readiness.generated_at,
  });
  if (!sameJson(rebuiltReadiness, readiness)) {
    throw new DomainPackError(
      "DOMAIN_READINESS_DRIFT",
      "stored readiness does not match primary artifacts",
    );
  }
  return {
    root: packRoot,
    manifest,
    interviews,
    evidenceCards,
    confirmations,
    decisionQuestions,
    contract,
    requirements,
    graph,
    request,
    readiness,
  };
}

export async function validateDomainPack(
  projectRoot: string,
  packRef: string,
  manifestRef: string,
  options: { readonly confirmationLedger?: OwnerConfirmationLedger } = {},
): Promise<ValidatedDomainPack> {
  try {
    return await validateDomainPackInner(
      projectRoot,
      packRef,
      manifestRef,
      options.confirmationLedger ?? new OwnerConfirmationLedger(),
    );
  } catch (error) {
    if (error instanceof DomainPackError) throw error;
    throw new DomainPackError("DOMAIN_PACK_INVALID", "domain pack validation failed");
  }
}
