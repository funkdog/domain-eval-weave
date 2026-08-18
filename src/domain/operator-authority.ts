import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { packageRelativeRefSchema } from "../contracts/phase2.js";
import {
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
  parseRequirementChangeSet,
} from "./contracts.js";
import { issueProductDomainContract, type ProductDomainContractDraft } from "./promotion.js";

export type AuthorityDecision = "confirm" | "reject" | "withdraw";

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
  readonly decision: AuthorityDecision;
  readonly occurredAt?: string;
  readonly ledger?: OwnerConfirmationLedger;
}

export interface OperatorAuthorityResult {
  readonly event: OwnerConfirmationEvent;
  readonly confirmation: OwnerConfirmationPointer;
  readonly artifact?: { readonly ref: string; readonly value: unknown };
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

async function readCandidate(root: string, ref: string): Promise<unknown> {
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
  readonly decision: AuthorityDecision;
  readonly targetKind: ConfirmationTargetKind;
  readonly projection: string;
}): string {
  return `authority-${input.decision}-${canonicalJsonDigest(input).slice(0, 24)}`;
}

interface AuthorityPlan {
  readonly target: unknown;
  build(
    confirmation: OwnerConfirmationPointer,
    event: OwnerConfirmationEvent,
  ): { readonly ref: string; readonly value: unknown } | undefined;
}

function planAuthorityTransition(
  kind: ConfirmationTargetKind,
  candidate: unknown,
  decision: AuthorityDecision,
  candidateRef: string,
): AuthorityPlan {
  if (kind === "evidence_card") {
    const card = parseDomainEvidenceCard(candidate);
    if (decision === "withdraw" || card.status === "confirmed") {
      invalidTransition("Evidence Card decision is not admissible");
    }
    if (decision === "reject") return { target: card, build: () => undefined };
    if (card.status !== "proposed" && card.status !== "unresolved") {
      throw new Error("only proposed/unresolved Evidence Cards can be confirmed");
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
    const allowed =
      (question.status === "open" && (decision === "confirm" || decision === "reject")) ||
      (question.status === "resolved" && decision === "withdraw");
    if (!allowed) invalidTransition("DecisionQuestion decision is not admissible");
    const { resolution_confirmation: _confirmation, ...questionBase } = question;
    const target = {
      ...questionBase,
      revision: question.revision + 1,
      predecessor: domainPackPointerSchema.parse({
        ref: candidateRef,
        sha256: canonicalJsonDigest(question),
      }),
      status: decision === "withdraw" ? "withdrawn" : "resolved",
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
    if (decision === "reject") {
      if (requirement.status !== "draft")
        invalidTransition("only a draft Requirement can be rejected");
      return { target: requirement, build: () => undefined };
    }
    if (decision === "confirm" && requirement.status !== "draft") {
      invalidTransition("only a draft Requirement can be confirmed");
    }
    if (decision === "withdraw" && requirement.status !== "owner_confirmed") {
      invalidTransition("only an owner-confirmed Requirement can be withdrawn");
    }
    const { confirmation: _confirmation, ...requirementBase } = requirement;
    const target =
      decision === "withdraw"
        ? {
            ...requirementBase,
            version: requirement.version + 1,
            predecessor: domainPackPointerSchema.parse({
              ref: candidateRef,
              sha256: canonicalJsonDigest(requirement),
            }),
            status: "withdrawn" as const,
          }
        : { ...requirementBase, status: "owner_confirmed" as const };
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
  if (kind === "product_domain_contract") {
    if (decision === "reject") {
      confirmationTargetIdentity(kind, candidate);
      return { target: candidate, build: () => undefined };
    }
    if (decision === "confirm") {
      confirmationTargetIdentity(kind, candidate);
      return {
        target: candidate,
        build: (_confirmation, event) => {
          const value = issueProductDomainContract(candidate as ProductDomainContractDraft, {
            event,
          });
          return { ref: `contracts/${value.contract_id}/v${value.version}.json`, value };
        },
      };
    }
    const contract = parseProductDomainContract(candidate);
    if (contract.state !== "issued") invalidTransition("only an issued Contract can be withdrawn");
    const { confirmation: _confirmation, decided_by: _actor, decided_at: _at, ...base } = contract;
    const target = {
      ...base,
      version: contract.version + 1,
      predecessor: domainPackPointerSchema.parse({
        ref: candidateRef,
        sha256: canonicalJsonDigest(contract),
      }),
      state: "withdrawn" as const,
    };
    return {
      target,
      build: (confirmation, event) => {
        const value = parseProductDomainContract({
          ...target,
          confirmation,
          decided_by: event.actor_id,
          decided_at: event.occurred_at,
        });
        return { ref: `contracts/${value.contract_id}/v${value.version}.json`, value };
      },
    };
  }
  if (decision === "withdraw") invalidTransition("Claim transitions cannot be withdrawn");
  confirmationTargetIdentity(kind, candidate);
  return { target: candidate, build: () => undefined };
}

export async function recordOperatorAuthority(
  input: RecordOperatorAuthorityInput,
): Promise<OperatorAuthorityResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.actorId)) {
    throw new Error("operator actor id is invalid");
  }
  const root = await packRoot(input.projectRoot, input.packPath);
  const candidate = await readCandidate(root, input.candidatePath);
  const plan = planAuthorityTransition(
    input.targetKind,
    candidate,
    input.decision,
    input.candidatePath,
  );
  const identity = confirmationTargetIdentity(input.targetKind, plan.target);
  const projection = confirmationProjectionDigest(input.targetKind, plan.target);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const invocation = {
    decision: input.decision,
    pack_path: input.packPath,
    target_kind: input.targetKind,
    candidate_path: input.candidatePath,
    actor_id: input.actorId,
    occurred_at: occurredAt,
  } as const;
  const event = {
    schema_version: 1,
    confirmation_id: eventId({
      decision: input.decision,
      targetKind: input.targetKind,
      projection,
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
    decision: input.decision,
    origin: {
      kind: "management_cli_operator_invocation",
      profile: "eval-clowder",
      command: input.decision,
      invocation_sha256: canonicalJsonDigest(invocation),
    },
    occurred_at: occurredAt,
  } as const;
  const previewConfirmation = ownerConfirmationPointerSchema.parse({
    confirmation_id: event.confirmation_id,
    sha256: canonicalJsonDigest(event),
  });
  const artifact = plan.build(previewConfirmation, event);
  if (artifact !== undefined) await preflightImmutable(root, artifact);
  const ledger = input.ledger ?? new OwnerConfirmationLedger();
  const confirmation = await ledger.write(event);
  if (canonicalJson(confirmation) !== canonicalJson(previewConfirmation)) {
    throw new Error("confirmation ledger returned an unexpected receipt");
  }
  if (artifact !== undefined) await writeImmutable(root, artifact.ref, artifact.value);
  return artifact === undefined ? { event, confirmation } : { event, confirmation, artifact };
}
