import { randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { z } from "zod";

import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { packageRelativeRefSchema } from "../contracts/phase2.js";
import {
  type DomainDecisionQuestion,
  type DomainEvidenceCard,
  type DomainInterviewSession,
  type DomainSourceRef,
  domainPackPointerSchema,
  domainSourceRefSchema,
  type ProductDomainContractCandidate,
  parseDomainDecisionQuestion,
  parseDomainEvidenceCard,
  parseDomainInterviewSession,
  parseProductDomainContract,
  parseProductDomainContractCandidate,
  parseRequirementChangeSet,
  type RequirementChangeSet,
} from "../domain/contracts.js";
import { buildClaimDependencyGraph } from "../domain/graph.js";
import { DomainPackError, domainSourceDigest, verifyDomainSourceRef } from "../domain/pack.js";
import { assertProductDomainContractSuccessor } from "../domain/promotion.js";
import { assertSecretFreeText, SecretScanError } from "../report/secret-scan.js";

const MAX_SOURCE_BYTES = 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CANDIDATE_REF_PATTERN = /^candidates\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/;

const sourceKindSchema = z.enum([
  "owner_statement",
  "requirement",
  "product_doc",
  "external_contract",
  "code",
  "test",
  "runtime_observation",
  "domain_knowledge",
]);

const snapshotInputSchema = z
  .strictObject({
    action: z.literal("snapshot_source"),
    source_path: z.string().min(1).optional(),
    content: z.string().optional(),
    artifact_ref: z.string().min(1),
    source_id: z.string().regex(ID_PATTERN),
    kind: sourceKindSchema,
    locator: z.string().min(1).max(512).optional(),
  })
  .superRefine((input, context) => {
    if ((input.source_path === undefined) === (input.content === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["source_path"],
        message: "snapshot_source requires exactly one of source_path or content",
      });
    }
    if (input.content !== undefined && input.kind !== "owner_statement") {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "inline content is reserved for an explicit owner_statement",
      });
    }
  });

const artifactKindSchema = z.enum([
  "interview_session",
  "evidence_card",
  "decision_question",
  "product_domain_contract_candidate",
  "requirement_change_set_candidate",
]);

const writeInputSchema = z.strictObject({
  action: z.literal("write_artifact"),
  kind: artifactKindSchema,
  artifact_ref: z.string().min(1),
  value: z.unknown(),
});

const stageInputSchema = z.strictObject({
  action: z.literal("stage_confirmation_candidate"),
  target_kind: z.enum(["evidence_card", "decision_question"]),
  artifact: domainPackPointerSchema,
  candidate_ref: z.string().min(1),
});

const inputSchema = z.discriminatedUnion("action", [
  snapshotInputSchema,
  writeInputSchema,
  stageInputSchema,
]);

type DomainArtifactInput = z.infer<typeof inputSchema>;
type ArtifactKind = z.infer<typeof artifactKindSchema>;

interface Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

interface FailureResult {
  readonly ok: false;
  readonly action: string;
  readonly diagnostics: readonly Diagnostic[];
}

class DomainArtifactToolError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainArtifactToolError";
  }
}

function sameOrNested(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function zodDiagnostics(code: string, error: z.ZodError): readonly Diagnostic[] {
  return error.issues.map((issue) => ({
    code,
    path: issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`,
    message: issue.message,
  }));
}

function failure(action: string, error: unknown): FailureResult {
  if (error instanceof DomainArtifactToolError) {
    return {
      ok: false,
      action,
      diagnostics: [{ code: error.code, path: error.path, message: error.message }],
    };
  }
  if (error instanceof SecretScanError) {
    return {
      ok: false,
      action,
      diagnostics: [{ code: error.code, path: "$", message: error.message }],
    };
  }
  if (error instanceof DomainPackError) {
    return {
      ok: false,
      action,
      diagnostics: [{ code: error.code, path: "$", message: error.message }],
    };
  }
  return {
    ok: false,
    action,
    diagnostics: [
      {
        code: "ARTIFACT_OPERATION_FAILED",
        path: "$",
        message: error instanceof Error ? error.message : "domain artifact operation failed",
      },
    ],
  };
}

function parseInput(value: unknown): DomainArtifactInput | FailureResult {
  const parsed = inputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const action =
    typeof value === "object" && value !== null && "action" in value
      ? String((value as { readonly action?: unknown }).action)
      : "unknown";
  return {
    ok: false,
    action,
    diagnostics: zodDiagnostics("ARTIFACT_INPUT_INVALID", parsed.error),
  };
}

async function assertPhysicalDirectory(path: string): Promise<void> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new DomainArtifactToolError(
      "ARTIFACT_PATH_INVALID",
      "$",
      "domain artifact directory does not exist",
    );
  }
  if (entry.isSymbolicLink() || !entry.isDirectory() || (await realpath(path)) !== path) {
    throw new DomainArtifactToolError(
      "ARTIFACT_PATH_INVALID",
      "$",
      "domain artifact path must be a physical directory",
    );
  }
}

async function ensurePackRoot(workspaceRoot: string, domainRoot: string): Promise<void> {
  try {
    await mkdir(domainRoot, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await assertPhysicalDirectory(workspaceRoot);
  await assertPhysicalDirectory(domainRoot);
}

function normalizeRelativeRef(value: string, path: string): string {
  const parsed = packageRelativeRefSchema.safeParse(value);
  if (!parsed.success || value.includes("\0")) {
    throw new DomainArtifactToolError(
      "ARTIFACT_PATH_INVALID",
      path,
      "path must be a normalized project-relative reference",
    );
  }
  return parsed.data;
}

function assertSourcePathAllowed(sourcePath: string, diagnosticPath = "$.source_path"): void {
  const segments = sourcePath.toLowerCase().split("/");
  const forbidden = segments.some(
    (segment) =>
      segment === ".git" ||
      segment === ".ssh" ||
      segment === ".codex" ||
      segment === ".dsh" ||
      segment === "node_modules" ||
      segment === "auth.json" ||
      segment === ".openai-codex-auth.json" ||
      segment === "credentials" ||
      segment === "credentials.json" ||
      segment === "secrets" ||
      segment === "secrets.json" ||
      segment === ".env" ||
      segment.startsWith(".env.") ||
      /(?:^|[._-])(?:oauth|credentials?|secrets?|access[._-]?token|refresh[._-]?token|id[._-]?token|client[._-]?secret|api[._-]?key|private[._-]?key)(?:[._-]|$)/.test(
        segment,
      ) ||
      /^(?:id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/.test(segment),
  );
  if (forbidden) {
    throw new DomainArtifactToolError(
      "ARTIFACT_PATH_FORBIDDEN",
      diagnosticPath,
      "source path is credential- or runtime-sensitive",
    );
  }
}

async function resolvePhysicalFile(root: string, ref: string, path: string): Promise<string> {
  const normalized = normalizeRelativeRef(ref, path);
  const target = resolve(root, normalized);
  if (!sameOrNested(root, target) || target === root) {
    throw new DomainArtifactToolError(
      "ARTIFACT_PATH_INVALID",
      path,
      "path escapes the authorized root",
    );
  }
  let current = root;
  for (const segment of relative(root, target).split("/")) {
    current = resolve(current, segment);
    let entry: Awaited<ReturnType<typeof lstat>>;
    try {
      entry = await lstat(current);
    } catch {
      throw new DomainArtifactToolError(
        "ARTIFACT_PATH_INVALID",
        path,
        "path does not resolve to a physical file",
      );
    }
    if (entry.isSymbolicLink()) {
      throw new DomainArtifactToolError(
        "ARTIFACT_PATH_INVALID",
        path,
        "path crosses a symbolic link",
      );
    }
  }
  const entry = await lstat(target);
  if (!entry.isFile() || (await realpath(target)) !== target) {
    throw new DomainArtifactToolError(
      "ARTIFACT_PATH_INVALID",
      path,
      "path must resolve to a physical regular file",
    );
  }
  return target;
}

async function ensurePhysicalParent(root: string, ref: string, path: string): Promise<string> {
  const normalized = normalizeRelativeRef(ref, path);
  const target = resolve(root, normalized);
  if (!sameOrNested(root, target) || target === root) {
    throw new DomainArtifactToolError(
      "ARTIFACT_PATH_INVALID",
      path,
      "artifact path escapes domain-eval",
    );
  }
  let current = root;
  for (const segment of relative(root, dirname(target)).split("/")) {
    if (segment === "") continue;
    current = resolve(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await assertPhysicalDirectory(current);
  }
  return target;
}

async function readExistingImmutable(path: string, expected: Uint8Array): Promise<boolean> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile() || (await realpath(path)) !== path) {
      throw new DomainArtifactToolError(
        "ARTIFACT_PATH_INVALID",
        "$.artifact_ref",
        "artifact target is not a physical regular file",
      );
    }
    const existing = await readFile(path);
    if (!existing.equals(Buffer.from(expected))) {
      throw new DomainArtifactToolError(
        "ARTIFACT_IMMUTABLE_CONFLICT",
        "$.artifact_ref",
        "artifact path already binds different immutable bytes",
      );
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeImmutable(
  root: string,
  ref: string,
  bytes: Uint8Array,
  path = "$.artifact_ref",
): Promise<void> {
  const target = await ensurePhysicalParent(root, ref, path);
  if (await readExistingImmutable(target, bytes)) return;

  const temp = resolve(dirname(target), `.dsh-eval-artifact-${randomUUID()}.tmp`);
  let tempExists = false;
  try {
    const handle = await open(
      temp,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    tempExists = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temp, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await readExistingImmutable(target, bytes);
    }
  } finally {
    if (tempExists) await unlink(temp).catch(() => undefined);
  }
}

async function readCanonicalArtifact<T>(
  root: string,
  pointer: { readonly ref: string; readonly sha256: string },
  parser: (value: unknown) => T,
): Promise<T> {
  let path: string;
  try {
    path = await resolvePhysicalFile(root, pointer.ref, "$.artifact.ref");
  } catch (error) {
    if (error instanceof DomainArtifactToolError) {
      throw new DomainArtifactToolError("ARTIFACT_POINTER_INVALID", "$.artifact", error.message);
    }
    throw error;
  }
  const source = await readFile(path, "utf8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new DomainArtifactToolError(
      "ARTIFACT_POINTER_INVALID",
      "$.artifact",
      "artifact pointer target is not JSON",
    );
  }
  let parsed: T;
  try {
    parsed = parser(decoded);
  } catch {
    throw new DomainArtifactToolError(
      "ARTIFACT_POINTER_INVALID",
      "$.artifact",
      "artifact pointer target does not match its schema",
    );
  }
  const canonical = canonicalJson(parsed);
  if (source !== canonical && source !== `${canonical}\n`) {
    throw new DomainArtifactToolError(
      "ARTIFACT_POINTER_INVALID",
      "$.artifact",
      "artifact pointer target is not canonical JSON",
    );
  }
  if (canonicalJsonDigest(parsed) !== pointer.sha256) {
    throw new DomainArtifactToolError(
      "ARTIFACT_POINTER_DRIFT",
      "$.artifact.sha256",
      `artifact pointer digest drifted: ${pointer.ref}`,
    );
  }
  return parsed;
}

async function verifySources(root: string, sources: readonly DomainSourceRef[]): Promise<void> {
  for (const source of sources) {
    try {
      await verifyDomainSourceRef(root, source);
    } catch (error) {
      throw new DomainArtifactToolError(
        "ARTIFACT_SOURCE_INVALID",
        "$.value",
        error instanceof Error ? error.message : `source ref is invalid: ${source.source_id}`,
      );
    }
  }
}

function selectedSources(
  card: DomainEvidenceCard,
  ids: readonly string[],
): readonly DomainSourceRef[] {
  const sources = new Map(card.source_refs.map((source) => [source.source_id, source]));
  return ids.map((id) => {
    const source = sources.get(id);
    if (source === undefined) {
      throw new DomainArtifactToolError(
        "ARTIFACT_CLOSURE_INVALID",
        "$.value",
        `Evidence Card is missing source ${id}`,
      );
    }
    return source;
  });
}

async function assertPredecessor<T extends { readonly product_id: string }>(input: {
  readonly root: string;
  readonly pointer: { readonly ref: string; readonly sha256: string } | undefined;
  readonly parser: (value: unknown) => T;
  readonly identity: string;
  readonly sequence: number;
  readonly identityOf: (value: T) => string;
  readonly sequenceOf: (value: T) => number;
  readonly productId: string;
}): Promise<T | undefined> {
  if (input.pointer === undefined) return undefined;
  const predecessor = await readCanonicalArtifact(input.root, input.pointer, input.parser);
  if (
    input.identityOf(predecessor) !== input.identity ||
    input.sequenceOf(predecessor) !== input.sequence - 1 ||
    predecessor.product_id !== input.productId
  ) {
    throw new DomainArtifactToolError(
      "ARTIFACT_PREDECESSOR_INVALID",
      "$.value.predecessor",
      "artifact predecessor identity, sequence, or product drifted",
    );
  }
  return predecessor;
}

async function validateEvidenceCard(root: string, card: DomainEvidenceCard): Promise<void> {
  if (card.status === "confirmed" || card.confirmation !== undefined) {
    throw new DomainArtifactToolError(
      "ARTIFACT_AUTHORITY_FORBIDDEN",
      "$.value.status",
      "author helper cannot write a confirmed Evidence Card",
    );
  }
  await verifySources(root, card.source_refs);
  await assertPredecessor({
    root,
    pointer: card.predecessor,
    parser: parseDomainEvidenceCard,
    identity: card.card_id,
    sequence: card.revision,
    identityOf: (value) => value.card_id,
    sequenceOf: (value) => value.revision,
    productId: card.product_id,
  });
}

async function validateDecisionQuestion(
  root: string,
  question: DomainDecisionQuestion,
): Promise<void> {
  if (question.status !== "open" || question.resolution_confirmation !== undefined) {
    throw new DomainArtifactToolError(
      "ARTIFACT_AUTHORITY_FORBIDDEN",
      "$.value.status",
      "author helper can write only an open DecisionQuestion",
    );
  }
  await assertPredecessor({
    root,
    pointer: question.predecessor,
    parser: parseDomainDecisionQuestion,
    identity: question.question_id,
    sequence: question.revision,
    identityOf: (value) => value.question_id,
    sequenceOf: (value) => value.revision,
    productId: question.product_id,
  });
}

async function validateInterview(root: string, interview: DomainInterviewSession): Promise<void> {
  await verifySources(root, [
    ...interview.source_snapshot,
    ...(interview.requirement_ref === undefined ? [] : [interview.requirement_ref]),
  ]);
  await assertPredecessor({
    root,
    pointer: interview.predecessor,
    parser: parseDomainInterviewSession,
    identity: interview.interview_id,
    sequence: interview.revision,
    identityOf: (value) => value.interview_id,
    sequenceOf: (value) => value.revision,
    productId: interview.product_id,
  });
  if (interview.base_contract !== undefined) {
    const contract = await readCanonicalArtifact(
      root,
      interview.base_contract,
      parseProductDomainContract,
    );
    if (
      interview.base_contract.ref !==
        `contracts/${contract.contract_id}/v${contract.version}.json` ||
      contract.product_id !== interview.product_id ||
      contract.state !== "issued"
    ) {
      throw new DomainArtifactToolError(
        "ARTIFACT_CLOSURE_INVALID",
        "$.value.base_contract",
        "Interview base Contract identity or state drifted",
      );
    }
  }
  for (const pointer of interview.evidence_card_refs) {
    const card = await readCanonicalArtifact(root, pointer, parseDomainEvidenceCard);
    if (
      pointer.ref !== `evidence-cards/${card.card_id}/r${card.revision}.json` ||
      card.product_id !== interview.product_id
    ) {
      throw new DomainArtifactToolError(
        "ARTIFACT_CLOSURE_INVALID",
        "$.value.evidence_card_refs",
        "Interview Evidence Card belongs to another product",
      );
    }
  }
  for (const pointer of interview.decision_question_refs) {
    const question = await readCanonicalArtifact(root, pointer, parseDomainDecisionQuestion);
    if (
      pointer.ref !== `decision-questions/${question.question_id}/r${question.revision}.json` ||
      question.product_id !== interview.product_id
    ) {
      throw new DomainArtifactToolError(
        "ARTIFACT_CLOSURE_INVALID",
        "$.value.decision_question_refs",
        "Interview DecisionQuestion belongs to another product",
      );
    }
  }
}

async function validateContractCandidate(
  root: string,
  contract: ProductDomainContractCandidate,
): Promise<void> {
  const interview = await readCanonicalArtifact(
    root,
    contract.source_interview,
    parseDomainInterviewSession,
  );
  if (
    contract.source_interview.ref !==
      `interviews/${interview.interview_id}/r${interview.revision}.json` ||
    interview.product_id !== contract.product_id ||
    interview.status !== "completed" ||
    canonicalJsonDigest(interview.source_snapshot) !== contract.source_snapshot_digest
  ) {
    throw new DomainArtifactToolError(
      "ARTIFACT_CLOSURE_INVALID",
      "$.value.source_interview",
      "Contract source Interview or source snapshot drifted",
    );
  }
  await verifySources(root, interview.source_snapshot);
  if (contract.predecessor !== undefined) {
    const predecessor = await readCanonicalArtifact(
      root,
      contract.predecessor,
      parseProductDomainContract,
    );
    if (
      contract.predecessor.ref !==
      `contracts/${predecessor.contract_id}/v${predecessor.version}.json`
    ) {
      throw new DomainArtifactToolError(
        "ARTIFACT_PREDECESSOR_INVALID",
        "$.value.predecessor",
        "Contract predecessor does not use its canonical version path",
      );
    }
    try {
      assertProductDomainContractSuccessor({
        predecessorRef: contract.predecessor.ref,
        predecessor,
        successor: contract,
      });
    } catch (error) {
      throw new DomainArtifactToolError(
        "ARTIFACT_PREDECESSOR_INVALID",
        "$.value.predecessor",
        error instanceof Error ? error.message : "Contract successor is invalid",
      );
    }
  }
  for (const claim of contract.claims) {
    const card = await readCanonicalArtifact(root, claim.evidence_card, parseDomainEvidenceCard);
    await verifySources(root, card.source_refs);
    if (
      claim.evidence_card.ref !== `evidence-cards/${card.card_id}/r${card.revision}.json` ||
      card.status !== "confirmed" ||
      card.product_id !== contract.product_id ||
      card.claim_id !== claim.claim_id ||
      card.domain_id !== claim.domain_id ||
      card.statement !== claim.statement ||
      card.applicability !== claim.applicability ||
      card.false_accept_risk !== claim.false_accept_risk ||
      card.false_reject_risk !== claim.false_reject_risk ||
      canonicalJson(selectedSources(card, card.authority_ref_ids)) !==
        canonicalJson(claim.authority_refs) ||
      canonicalJson(selectedSources(card, card.observation_ref_ids)) !==
        canonicalJson(claim.observation_refs)
    ) {
      throw new DomainArtifactToolError(
        "ARTIFACT_CLOSURE_INVALID",
        "$.value.claims",
        `Contract Claim is not backed by confirmed Card ${claim.claim_id}`,
      );
    }
  }
}

async function validateRequirement(
  root: string,
  ref: string,
  requirement: RequirementChangeSet,
): Promise<void> {
  if (requirement.status !== "draft" || requirement.confirmation !== undefined) {
    throw new DomainArtifactToolError(
      "ARTIFACT_AUTHORITY_FORBIDDEN",
      "$.value.status",
      "author helper can write only a draft Requirement ChangeSet",
    );
  }
  await verifySources(root, requirement.requirement_refs);
  const contract = await readCanonicalArtifact(
    root,
    requirement.base_contract,
    parseProductDomainContract,
  );
  if (
    requirement.base_contract.ref !==
      `contracts/${contract.contract_id}/v${contract.version}.json` ||
    contract.product_id !== requirement.product_id ||
    contract.state !== "issued"
  ) {
    throw new DomainArtifactToolError(
      "ARTIFACT_CLOSURE_INVALID",
      "$.value.base_contract",
      "Requirement base Contract identity or state drifted",
    );
  }
  await assertPredecessor({
    root,
    pointer: requirement.predecessor,
    parser: parseRequirementChangeSet,
    identity: requirement.requirement_id,
    sequence: requirement.version,
    identityOf: (value) => value.requirement_id,
    sequenceOf: (value) => value.version,
    productId: requirement.product_id,
  });
  for (const pointer of requirement.decision_question_refs) {
    const question = await readCanonicalArtifact(root, pointer, parseDomainDecisionQuestion);
    if (
      pointer.ref !== `decision-questions/${question.question_id}/r${question.revision}.json` ||
      question.product_id !== requirement.product_id ||
      (question.requirement_id !== undefined &&
        question.requirement_id !== requirement.requirement_id)
    ) {
      throw new DomainArtifactToolError(
        "ARTIFACT_CLOSURE_INVALID",
        "$.value.decision_question_refs",
        "Requirement DecisionQuestion ownership drifted",
      );
    }
  }
  try {
    buildClaimDependencyGraph({
      contract: { ref: requirement.base_contract.ref, contract },
      requirements: [{ ref, requirement }],
    });
  } catch (error) {
    throw new DomainArtifactToolError(
      "ARTIFACT_CLOSURE_INVALID",
      "$.value.effects",
      error instanceof Error ? error.message : "Requirement graph closure is invalid",
    );
  }
}

function parseArtifact(kind: ArtifactKind, value: unknown): unknown {
  try {
    switch (kind) {
      case "interview_session":
        return parseDomainInterviewSession(value);
      case "evidence_card":
        return parseDomainEvidenceCard(value);
      case "decision_question":
        return parseDomainDecisionQuestion(value);
      case "product_domain_contract_candidate":
        return parseProductDomainContractCandidate(value);
      case "requirement_change_set_candidate":
        return parseRequirementChangeSet(value);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new DomainArtifactToolError(
        "ARTIFACT_SCHEMA_INVALID",
        "$.value",
        zodDiagnostics("ARTIFACT_SCHEMA_INVALID", error)
          .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
          .join("; "),
      );
    }
    throw error;
  }
}

async function prepareArtifactValue(
  root: string,
  kind: ArtifactKind,
  value: unknown,
): Promise<unknown> {
  if (
    kind !== "product_domain_contract_candidate" ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const pointer = domainPackPointerSchema.safeParse(record.source_interview);
  if (!pointer.success) return value;
  const interview = await readCanonicalArtifact(root, pointer.data, parseDomainInterviewSession);
  const derived = canonicalJsonDigest(interview.source_snapshot);
  if (record.source_snapshot_digest !== undefined && record.source_snapshot_digest !== derived) {
    throw new DomainArtifactToolError(
      "ARTIFACT_DERIVED_FIELD_MISMATCH",
      "$.value.source_snapshot_digest",
      "Contract source_snapshot_digest does not match the bound Interview",
    );
  }
  return { ...record, source_snapshot_digest: derived };
}

function assertArtifactRef(kind: ArtifactKind, ref: string, value: unknown): void {
  const normalized = normalizeRelativeRef(ref, "$.artifact_ref");
  let expected: string | RegExp;
  switch (kind) {
    case "interview_session": {
      const interview = value as DomainInterviewSession;
      expected = `interviews/${interview.interview_id}/r${interview.revision}.json`;
      break;
    }
    case "evidence_card": {
      const card = value as DomainEvidenceCard;
      expected = `evidence-cards/${card.card_id}/r${card.revision}.json`;
      break;
    }
    case "decision_question": {
      const question = value as DomainDecisionQuestion;
      expected = `decision-questions/${question.question_id}/r${question.revision}.json`;
      break;
    }
    case "product_domain_contract_candidate":
    case "requirement_change_set_candidate":
      expected = CANDIDATE_REF_PATTERN;
      break;
  }
  if (typeof expected === "string" ? normalized !== expected : !expected.test(normalized)) {
    throw new DomainArtifactToolError(
      "ARTIFACT_REF_INVALID",
      "$.artifact_ref",
      `artifact ref does not match ${kind} immutable identity`,
    );
  }
}

async function validateArtifact(
  root: string,
  ref: string,
  kind: ArtifactKind,
  value: unknown,
): Promise<void> {
  switch (kind) {
    case "interview_session":
      await validateInterview(root, value as DomainInterviewSession);
      return;
    case "evidence_card":
      await validateEvidenceCard(root, value as DomainEvidenceCard);
      return;
    case "decision_question":
      await validateDecisionQuestion(root, value as DomainDecisionQuestion);
      return;
    case "product_domain_contract_candidate":
      await validateContractCandidate(root, value as ProductDomainContractCandidate);
      return;
    case "requirement_change_set_candidate":
      await validateRequirement(root, ref, value as RequirementChangeSet);
      return;
  }
}

function sourceRefFrom(
  input: z.infer<typeof snapshotInputSchema>,
  bytes: Uint8Array,
): DomainSourceRef {
  let digest: string;
  try {
    digest = domainSourceDigest(bytes, input.locator);
  } catch (error) {
    if (error instanceof DomainPackError) {
      throw new DomainArtifactToolError("ARTIFACT_SOURCE_INVALID", "$.locator", error.message);
    }
    throw error;
  }
  const parsed = domainSourceRefSchema.safeParse({
    source_id: input.source_id,
    kind: input.kind,
    artifact_ref: input.artifact_ref,
    digest,
    ...(input.locator === undefined ? {} : { locator: input.locator }),
  });
  if (!parsed.success) {
    throw new DomainArtifactToolError(
      "ARTIFACT_INPUT_INVALID",
      "$.locator",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return parsed.data;
}

async function executeSnapshot(
  workspaceRoot: string,
  domainRoot: string,
  input: z.infer<typeof snapshotInputSchema>,
) {
  const artifactRef = normalizeRelativeRef(input.artifact_ref, "$.artifact_ref");
  if (!artifactRef.startsWith("sources/")) {
    throw new DomainArtifactToolError(
      "ARTIFACT_REF_INVALID",
      "$.artifact_ref",
      "source snapshots must use the sources/ namespace",
    );
  }
  let bytes: Uint8Array;
  if (input.source_path !== undefined) {
    const sourceRef = normalizeRelativeRef(input.source_path, "$.source_path");
    assertSourcePathAllowed(sourceRef);
    const sourcePath = await resolvePhysicalFile(workspaceRoot, sourceRef, "$.source_path");
    const entry = await lstat(sourcePath);
    if (entry.size > MAX_SOURCE_BYTES) {
      throw new DomainArtifactToolError(
        "ARTIFACT_SOURCE_TOO_LARGE",
        "$.source_path",
        "source snapshot exceeds the 1 MiB limit",
      );
    }
    bytes = await readFile(sourcePath);
  } else {
    bytes = Buffer.from(input.content ?? "", "utf8");
  }
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new DomainArtifactToolError(
      "ARTIFACT_SOURCE_TOO_LARGE",
      input.source_path === undefined ? "$.content" : "$.source_path",
      "source snapshot exceeds the 1 MiB limit",
    );
  }
  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DomainArtifactToolError(
      "ARTIFACT_SOURCE_INVALID",
      input.source_path === undefined ? "$.content" : "$.source_path",
      "source snapshot must be valid UTF-8",
    );
  }
  assertSecretFreeText(sourceText);
  const source = sourceRefFrom({ ...input, artifact_ref: artifactRef }, bytes);
  await writeImmutable(domainRoot, artifactRef, bytes);
  return { ok: true as const, action: input.action, source_ref: source };
}

async function executeWrite(domainRoot: string, input: z.infer<typeof writeInputSchema>) {
  const prepared = await prepareArtifactValue(domainRoot, input.kind, input.value);
  const parsed = parseArtifact(input.kind, prepared);
  assertArtifactRef(input.kind, input.artifact_ref, parsed);
  const canonical = canonicalJson(parsed);
  assertSecretFreeText(canonical);
  await validateArtifact(domainRoot, input.artifact_ref, input.kind, parsed);
  await writeImmutable(domainRoot, input.artifact_ref, Buffer.from(`${canonical}\n`, "utf8"));
  return {
    ok: true as const,
    action: input.action,
    artifact: { ref: input.artifact_ref, sha256: canonicalJsonDigest(parsed) },
  };
}

async function executeStage(domainRoot: string, input: z.infer<typeof stageInputSchema>) {
  const candidateRef = normalizeRelativeRef(input.candidate_ref, "$.candidate_ref");
  if (!CANDIDATE_REF_PATTERN.test(candidateRef)) {
    throw new DomainArtifactToolError(
      "ARTIFACT_REF_INVALID",
      "$.candidate_ref",
      "confirmation candidates must use candidates/<candidate-id>.json",
    );
  }
  const parsed =
    input.target_kind === "evidence_card"
      ? await readCanonicalArtifact(domainRoot, input.artifact, parseDomainEvidenceCard)
      : await readCanonicalArtifact(domainRoot, input.artifact, parseDomainDecisionQuestion);
  if (input.target_kind === "evidence_card") {
    assertArtifactRef("evidence_card", input.artifact.ref, parsed);
    await validateEvidenceCard(domainRoot, parsed as DomainEvidenceCard);
    if (!new Set(["proposed", "unresolved"]).has((parsed as DomainEvidenceCard).status)) {
      throw new DomainArtifactToolError(
        "ARTIFACT_AUTHORITY_FORBIDDEN",
        "$.artifact",
        "only proposed or unresolved Evidence Cards can be staged for confirmation",
      );
    }
  } else {
    assertArtifactRef("decision_question", input.artifact.ref, parsed);
    await validateDecisionQuestion(domainRoot, parsed as DomainDecisionQuestion);
  }
  const canonical = canonicalJson(parsed);
  assertSecretFreeText(canonical);
  await writeImmutable(
    domainRoot,
    candidateRef,
    Buffer.from(`${canonical}\n`, "utf8"),
    "$.candidate_ref",
  );
  return {
    ok: true as const,
    action: input.action,
    artifact: { ref: candidateRef, sha256: canonicalJsonDigest(parsed) },
  };
}

const parameters = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["snapshot_source", "write_artifact", "stage_confirmation_candidate"],
    },
    source_path: { type: "string" },
    content: { type: "string" },
    artifact_ref: { type: "string" },
    source_id: { type: "string" },
    kind: {
      type: "string",
      enum: [...sourceKindSchema.options, ...artifactKindSchema.options],
    },
    locator: { type: "string" },
    value: {},
    target_kind: { type: "string", enum: ["evidence_card", "decision_question"] },
    artifact: {
      type: "object",
      additionalProperties: false,
      required: ["ref", "sha256"],
      properties: { ref: { type: "string" }, sha256: { type: "string" } },
    },
    candidate_ref: { type: "string" },
  },
} as const;

export function createDomainArtifactDefinition(input: { readonly workspaceRoot: string }) {
  const requestedRoot = resolve(input.workspaceRoot);
  assertSourcePathAllowed(requestedRoot, "$.workspace_root");
  const workspaceRoot = realpathSync(requestedRoot);
  assertSourcePathAllowed(workspaceRoot, "$.workspace_root");
  if (workspaceRoot !== requestedRoot) {
    throw new Error("author workspace root must be a physical directory");
  }
  const domainRoot = resolve(workspaceRoot, "domain-eval");
  return {
    name: "domain_artifact",
    description:
      "Snapshot provenance-bound sources and write schema-valid canonical Domain Eval artifacts. Never creates owner authority.",
    parameters,
    output: {
      schema: { type: "object" },
      render: (_args: unknown, value: unknown) => [
        { type: "text" as const, text: JSON.stringify(value) },
      ],
    },
    async execute(argumentsValue: unknown) {
      const parsed = parseInput(argumentsValue);
      if ("ok" in parsed) return parsed;
      try {
        await ensurePackRoot(workspaceRoot, domainRoot);
        switch (parsed.action) {
          case "snapshot_source":
            return await executeSnapshot(workspaceRoot, domainRoot, parsed);
          case "write_artifact":
            return await executeWrite(domainRoot, parsed);
          case "stage_confirmation_candidate":
            return await executeStage(domainRoot, parsed);
        }
      } catch (error) {
        return failure(parsed.action, error);
      }
    },
  } satisfies ToolDefinition;
}
