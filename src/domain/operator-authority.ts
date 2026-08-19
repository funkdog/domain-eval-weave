import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { packageRelativeRefSchema } from "../contracts/phase2.js";
import {
  assertOwnerConfirmation,
  type ConfirmationTargetKind,
  confirmationProjectionDigest,
  confirmationTargetIdentity,
} from "./confirmation.js";
import { OwnerConfirmationLedger } from "./confirmation-ledger.js";
import {
  domainPackPointerSchema,
  type OwnerConfirmationEvent,
  type OwnerConfirmationPointer,
  ownerConfirmationPointerSchema,
  parseDomainDecisionQuestion,
  parseDomainEvidenceCard,
  parseProductDomainContract,
  parseProductDomainContractCandidate,
  parseRequirementChangeSet,
} from "./contracts.js";
import { buildClaimDependencyGraph } from "./graph.js";
import { issueProductDomainContract, type ProductDomainContractDraft } from "./promotion.js";

export class OperatorAuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OperatorAuthorityError";
    this.code = code;
  }
}

const invalidTransition = (message: string): never => {
  throw new OperatorAuthorityError("AUTHORITY_TRANSITION_INVALID", message);
};

export interface RecordOperatorAuthorityInput {
  readonly projectRoot: string;
  readonly packPath: string;
  readonly candidatePath: string;
  readonly targetKind: ConfirmationTargetKind;
  readonly actorId: string;
  readonly occurredAt?: string;
  readonly ledger?: OwnerConfirmationLedger;
}

export interface OperatorAuthorityResult {
  readonly status: "complete" | "incomplete";
  readonly event: OwnerConfirmationEvent;
  readonly confirmation: OwnerConfirmationPointer;
  readonly artifact?: { readonly ref: string; readonly value: unknown };
  readonly error?: {
    readonly code: "AUTHORITY_FINAL_WRITE_INCOMPLETE";
    readonly message: string;
  };
}

function contained(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

async function physicalDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory() || (await realpath(path)) !== resolve(path)) {
    throw new Error("domain authority path must be a physical directory");
  }
}

async function packRoot(projectRoot: string, packPath: string): Promise<string> {
  const project = resolve(projectRoot);
  await physicalDirectory(project);
  const normalized = packageRelativeRefSchema.parse(packPath);
  const root = resolve(project, normalized);
  if (!contained(project, root)) throw new Error("domain pack escapes project root");
  await physicalDirectory(root);
  return root;
}

async function readCanonicalPackJson(root: string, ref: string): Promise<unknown> {
  const normalized = packageRelativeRefSchema.parse(ref);
  const path = resolve(root, normalized);
  if (!contained(root, path)) throw new Error("authority candidate escapes pack root");
  let current = root;
  for (const segment of relative(root, path).split("/")) {
    current = resolve(current, segment);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error("authority candidate crosses a symlink");
  }
  const source = await readFile(path, "utf8");
  const value = JSON.parse(source);
  if (source !== canonicalJson(value) && source !== `${canonicalJson(value)}\n`) {
    throw new Error("authority candidate must be canonical JSON");
  }
  return value;
}

async function readCandidate(root: string, ref: string): Promise<unknown> {
  const normalized = packageRelativeRefSchema.parse(ref);
  if (!/^candidates\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(normalized)) {
    throw new Error("authority candidate must use the immutable candidates/<id>.json namespace");
  }
  return readCanonicalPackJson(root, normalized);
}

async function readBoundArtifact<T>(
  root: string,
  pointer: { readonly ref: string; readonly sha256: string },
  parser: (value: unknown) => T,
): Promise<T> {
  const value = parser(await readCanonicalPackJson(root, pointer.ref));
  if (canonicalJsonDigest(value) !== pointer.sha256) {
    throw new Error(`authority input pointer digest drifted: ${pointer.ref}`);
  }
  return value;
}

async function writeImmutable(root: string, ref: string, value: unknown): Promise<void> {
  const normalized = packageRelativeRefSchema.parse(ref);
  const path = resolve(root, normalized);
  if (!contained(root, path)) throw new Error("authority output escapes pack root");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let current = root;
  for (const segment of relative(root, dirname(path)).split("/")) {
    if (segment === "") continue;
    current = resolve(current, segment);
    await physicalDirectory(current);
  }
  const bytes = `${canonicalJson(value)}\n`;
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== bytes) {
      throw new Error("authority output path already binds different immutable bytes");
    }
  }
}

async function preflightImmutable(
  root: string,
  artifact: { ref: string; value: unknown },
): Promise<void> {
  const path = resolve(root, packageRelativeRefSchema.parse(artifact.ref));
  if (!contained(root, path)) throw new Error("authority output escapes pack root");
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error("authority output path is not a regular file");
    }
    const expected = `${canonicalJson(artifact.value)}\n`;
    if ((await readFile(path, "utf8")) !== expected) {
      throw new Error("authority output path already binds different immutable bytes");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function eventId(input: {
  readonly targetKind: ConfirmationTargetKind;
  readonly projection: string;
  readonly occurredAt: string;
}): string {
  return `authority-confirm-${canonicalJsonDigest(input).slice(0, 24)}`;
}

function selectedSources(
  card: ReturnType<typeof parseDomainEvidenceCard>,
  ids: readonly string[],
): readonly unknown[] {
  const sources = new Map(card.source_refs.map((source) => [source.source_id, source]));
  return ids.map((id) => {
    const source = sources.get(id);
    if (source === undefined) throw new Error(`Evidence Card is missing source ${id}`);
    return source;
  });
}

async function preflightAuthorityClosure(input: {
  readonly root: string;
  readonly targetKind: ConfirmationTargetKind;
  readonly candidate: unknown;
  readonly artifact: { readonly ref: string; readonly value: unknown };
  readonly ledger: OwnerConfirmationLedger;
}): Promise<void> {
  if (input.targetKind === "product_domain_contract") {
    const draft = parseProductDomainContractCandidate(input.candidate);
    for (const claim of draft.claims) {
      const card = await readBoundArtifact(
        input.root,
        claim.evidence_card,
        parseDomainEvidenceCard,
      );
      if (
        card.status !== "confirmed" ||
        card.claim_id !== claim.claim_id ||
        card.domain_id !== claim.domain_id ||
        card.statement !== claim.statement ||
        card.applicability !== claim.applicability ||
        canonicalJson(selectedSources(card, card.authority_ref_ids)) !==
          canonicalJson(claim.authority_refs) ||
        canonicalJson(selectedSources(card, card.observation_ref_ids)) !==
          canonicalJson(claim.observation_refs)
      ) {
        throw new Error(`Contract Claim is not backed by confirmed Card for ${claim.claim_id}`);
      }
      const cardEvent = await input.ledger.read(card.confirmation);
      assertOwnerConfirmation(cardEvent, "evidence_card", card, "confirm");
    }
    return;
  }

  if (input.targetKind === "requirement_change_set") {
    const requirement = parseRequirementChangeSet(input.candidate);
    const contract = await readBoundArtifact(
      input.root,
      requirement.base_contract,
      parseProductDomainContract,
    );
    if (contract.state !== "issued") throw new Error("Requirement base Contract is not issued");
    const contractEvent = await input.ledger.read(contract.confirmation);
    assertOwnerConfirmation(contractEvent, "product_domain_contract", contract, "confirm");
    for (const pointer of requirement.decision_question_refs) {
      const question = await readBoundArtifact(input.root, pointer, parseDomainDecisionQuestion);
      if (question.status === "open" && question.blocking) {
        throw new Error(`Requirement has open blocking DecisionQuestion ${question.question_id}`);
      }
    }
    buildClaimDependencyGraph({
      contract: { ref: requirement.base_contract.ref, contract },
      requirements: [{ ref: input.artifact.ref, requirement: input.artifact.value }],
    });
  }
}

interface AuthorityPlan {
  readonly target: unknown;
  build(
    confirmation: OwnerConfirmationPointer,
    event: OwnerConfirmationEvent,
  ): { readonly ref: string; readonly value: unknown };
}

function planAuthorityTransition(
  kind: ConfirmationTargetKind,
  candidate: unknown,
  candidateRef: string,
): AuthorityPlan {
  if (kind === "evidence_card") {
    const card = parseDomainEvidenceCard(candidate);
    if (card.status !== "proposed" && card.status !== "unresolved") {
      invalidTransition("only proposed/unresolved Evidence Cards can be confirmed");
    }
    const { conflict: _conflict, confirmation: _confirmation, ...cardBase } = card;
    const target = {
      ...cardBase,
      revision: card.revision + 1,
      predecessor: domainPackPointerSchema.parse({
        ref: candidateRef,
        sha256: canonicalJsonDigest(card),
      }),
      status: "confirmed",
    } as const;
    return {
      target,
      build: (confirmation) => {
        const value = parseDomainEvidenceCard({ ...target, confirmation });
        return { ref: `evidence-cards/${card.card_id}/r${value.revision}.json`, value };
      },
    };
  }
  if (kind === "decision_question") {
    const question = parseDomainDecisionQuestion(candidate);
    if (question.status !== "open") {
      invalidTransition("only open DecisionQuestions can be resolved");
    }
    const { resolution_confirmation: _confirmation, ...questionBase } = question;
    const target = {
      ...questionBase,
      revision: question.revision + 1,
      predecessor: domainPackPointerSchema.parse({
        ref: candidateRef,
        sha256: canonicalJsonDigest(question),
      }),
      status: "resolved" as const,
    } as const;
    return {
      target,
      build: (confirmation) => {
        const value = parseDomainDecisionQuestion({
          ...target,
          resolution_confirmation: confirmation,
        });
        return {
          ref: `decision-questions/${question.question_id}/r${value.revision}.json`,
          value,
        };
      },
    };
  }
  if (kind === "requirement_change_set") {
    const requirement = parseRequirementChangeSet(candidate);
    if (requirement.status !== "draft") {
      invalidTransition("only a draft Requirement can be confirmed");
    }
    const { confirmation: _confirmation, ...requirementBase } = requirement;
    const target = { ...requirementBase, status: "owner_confirmed" as const };
    return {
      target,
      build: (confirmation) => {
        const value = parseRequirementChangeSet({ ...target, confirmation });
        return {
          ref: `requirements/${requirement.requirement_id}/v${value.version}.json`,
          value,
        };
      },
    };
  }
  const draft = parseProductDomainContractCandidate(candidate);
  return {
    target: draft,
    build: (_confirmation, event) => {
      const value = issueProductDomainContract(draft as ProductDomainContractDraft, { event });
      return { ref: `contracts/${value.contract_id}/v${value.version}.json`, value };
    },
  };
}

export async function recordOperatorAuthority(
  input: RecordOperatorAuthorityInput,
): Promise<OperatorAuthorityResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.actorId)) {
    throw new Error("operator actor id is invalid");
  }
  const root = await packRoot(input.projectRoot, input.packPath);
  const candidate = await readCandidate(root, input.candidatePath);
  const plan = planAuthorityTransition(input.targetKind, candidate, input.candidatePath);
  const identity = confirmationTargetIdentity(input.targetKind, plan.target);
  const projection = confirmationProjectionDigest(input.targetKind, plan.target);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const invocation = {
    decision: "confirm",
    pack_path: input.packPath,
    target_kind: input.targetKind,
    candidate_path: input.candidatePath,
    actor_id: input.actorId,
    occurred_at: occurredAt,
  } as const;
  const event = {
    schema_version: 1,
    confirmation_id: eventId({
      targetKind: input.targetKind,
      projection,
      occurredAt,
    }),
    actor_id: input.actorId,
    authority_scope: {
      product_id: identity.productId,
      domain_ids: [
        ...new Set(
          identity.domainIds.filter((value): value is string => typeof value === "string"),
        ),
      ].sort(),
    },
    target: {
      kind: input.targetKind,
      object_id: identity.objectId,
      ...(identity.objectVersion === undefined ? {} : { object_version: identity.objectVersion }),
      projection_sha256: projection,
    },
    decision: "confirm",
    origin: {
      kind: "management_cli_operator_invocation",
      profile: "eval-clowder",
      command: "confirm",
      invocation_sha256: canonicalJsonDigest(invocation),
    },
    occurred_at: occurredAt,
  } as const;
  const previewConfirmation = ownerConfirmationPointerSchema.parse({
    confirmation_id: event.confirmation_id,
    sha256: canonicalJsonDigest(event),
  });
  const artifact = plan.build(previewConfirmation, event);
  await preflightImmutable(root, artifact);
  const ledger = input.ledger ?? new OwnerConfirmationLedger();
  await preflightAuthorityClosure({
    root,
    targetKind: input.targetKind,
    candidate,
    artifact,
    ledger,
  });
  const confirmation = await ledger.write(event);
  if (canonicalJson(confirmation) !== canonicalJson(previewConfirmation)) {
    throw new Error("confirmation ledger returned an unexpected receipt");
  }
  try {
    await writeImmutable(root, artifact.ref, artifact.value);
  } catch {
    return {
      status: "incomplete",
      event,
      confirmation,
      artifact,
      error: {
        code: "AUTHORITY_FINAL_WRITE_INCOMPLETE",
        message: "authority event persisted but final artifact write did not complete",
      },
    };
  }
  return { status: "complete", event, confirmation, artifact };
}
