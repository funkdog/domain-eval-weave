import { lstat, open, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { canonicalJson, canonicalJsonDigest } from "../canonical-json.js";
import { compileEvaluationClosureDirectory } from "./closure.js";
import { readDomainYaml, resolveDomainRoot } from "./compiler.js";
import {
  domainEvaluationSchema,
  productContractsSchema,
  qualificationCasesSchema,
  qualificationExpectationsSchema,
} from "./contracts.js";
import { DomainCompilerError } from "./errors.js";
import {
  buildGraderContext,
  executeGradeVector,
  type GraderContext,
  validateDomainGraderDirectory,
} from "./validation.js";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const revisionSchema = z.string().regex(/^[0-9a-f]{40}$/);
const gradeOutcomeSchema = z.enum([
  "pass",
  "fail",
  "not_applicable",
  "insufficient_evidence",
  "indeterminate",
]);
const graderContextSchema = z.strictObject({
  expectedCash: z.number().finite().nonnegative(),
  settlementDeadlineHours: z.number().finite().nonnegative(),
  expectedEconomicEffects: z.number().int().nonnegative(),
  expectedLedgerBalanced: z.boolean(),
  completeChannelAbsence: gradeOutcomeSchema,
  unavailableChannelAbsence: gradeOutcomeSchema,
});
const verifiedCuratorAttestationSchema = z.strictObject({
  schemaVersion: z.literal("domain-first-curator-attestation-v0"),
  attestationDigest: sha256Schema,
  provider: z.literal("cat-cafe"),
  candidateDigest: sha256Schema,
  curatorId: z.string().min(1),
  assignmentMessageId: z.string().min(1),
  acceptanceMessageId: z.string().min(1),
});
const predictionSchema = z.strictObject({
  caseId: z.string().min(1),
  kind: z.enum(["gold", "equivalent", "mutant"]),
  observationDigest: sha256Schema,
  atoms: z.record(z.string().min(1), gradeOutcomeSchema),
  overall: gradeOutcomeSchema,
});

const candidateSchema = z.strictObject({
  schemaVersion: z.literal("domain-first-qualification-candidate-v0"),
  candidateDigest: sha256Schema,
  authorId: z.string().min(1),
  sourceRevision: revisionSchema,
  closureDigest: sha256Schema,
  graderDigest: sha256Schema,
  validationEvidenceDigest: sha256Schema,
  visibleCaseIds: z.array(z.string().min(1)).min(1),
  visibleObservationDigests: z.array(sha256Schema).min(1),
  gradeAtoms: domainEvaluationSchema.shape.grade_atoms,
  verdictPolicy: domainEvaluationSchema.shape.verdict_policy,
  context: graderContextSchema,
});

const holdoutFreezeSchema = z.strictObject({
  schemaVersion: z.literal("domain-first-holdout-freeze-v0"),
  freezeDigest: sha256Schema,
  candidateDigest: sha256Schema,
  casesDigest: sha256Schema,
  cohortId: z.string().min(1),
  curatorId: z.string().min(1),
  curatorAttestation: verifiedCuratorAttestationSchema,
});

const holdoutExecutionSchema = z.strictObject({
  schemaVersion: z.literal("domain-first-holdout-execution-v0"),
  executionDigest: sha256Schema,
  candidateDigest: sha256Schema,
  casesDigest: sha256Schema,
  freezeDigest: sha256Schema,
  cohortId: z.string().min(1),
  curatorId: z.string().min(1),
  curatorAttestation: verifiedCuratorAttestationSchema,
  predictions: z.array(predictionSchema).min(1),
});

const holdoutUnsealSchema = z.strictObject({
  schemaVersion: z.literal("domain-first-holdout-unseal-v0"),
  unsealDigest: sha256Schema,
  candidateDigest: sha256Schema,
  casesDigest: sha256Schema,
  executionDigest: sha256Schema,
  expectationsDigest: sha256Schema,
  cohortId: z.string().min(1),
  curatorId: z.string().min(1),
  curatorAttestation: verifiedCuratorAttestationSchema,
});

const qualificationResultSchema = z.strictObject({
  status: z.enum(["qualified", "unqualified"]),
  candidateDigest: sha256Schema,
  casesDigest: sha256Schema,
  freezeDigest: sha256Schema,
  executionDigest: sha256Schema,
  expectationsDigest: sha256Schema,
  unsealDigest: sha256Schema,
  curatorId: z.string().min(1),
  curatorAttestation: verifiedCuratorAttestationSchema,
  evidenceDigest: sha256Schema,
  predictions: z.array(predictionSchema).min(1),
});

const qualificationRunSchema = z.strictObject({
  schemaVersion: z.literal("domain-first-independent-qualification-run-v0"),
  runDigest: sha256Schema,
  result: qualificationResultSchema,
});

export type DomainQualificationResult = z.infer<typeof qualificationResultSchema>;

export interface StoredQualificationArtifact {
  readonly digest: string;
  readonly path: string;
}

export interface StoredIndependentQualificationRun extends StoredQualificationArtifact {
  readonly result: DomainQualificationResult;
}

export interface CuratorAuthorityVerificationRequest {
  readonly provider: "cat-cafe";
  readonly candidateDigest: string;
  readonly authorId: string;
  readonly curatorId: string;
  readonly assignmentMessageId: string;
  readonly acceptanceMessageId: string;
}

export type CuratorAuthorityVerifier = (
  request: CuratorAuthorityVerificationRequest,
) => Promise<unknown>;

function attestationPayload(attestation: z.infer<typeof verifiedCuratorAttestationSchema>) {
  const { attestationDigest: _attestationDigest, ...payload } = attestation;
  return payload;
}

async function verifyCuratorAuthority(
  request: CuratorAuthorityVerificationRequest,
  verifier: CuratorAuthorityVerifier | undefined,
) {
  if (verifier === undefined) {
    throw new DomainCompilerError(
      "qualification_authority_verifier_required",
      "A runtime-owned Curator authority verifier is required",
    );
  }
  let raw: unknown;
  try {
    raw = await verifier(request);
  } catch {
    throw new DomainCompilerError(
      "qualification_authority_verification_failed",
      "Runtime Curator authority verification failed",
      request.curatorId,
    );
  }
  const parsed = verifiedCuratorAttestationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainCompilerError(
      "qualification_authority_verification_failed",
      parsed.error.issues[0]?.message ?? "Runtime Curator attestation is invalid",
      request.curatorId,
    );
  }
  const attestation = parsed.data;
  if (
    request.authorId === request.curatorId ||
    attestation.provider !== request.provider ||
    attestation.candidateDigest !== request.candidateDigest ||
    attestation.curatorId !== request.curatorId ||
    attestation.assignmentMessageId !== request.assignmentMessageId ||
    attestation.acceptanceMessageId !== request.acceptanceMessageId ||
    attestation.attestationDigest !== canonicalJsonDigest(attestationPayload(attestation))
  ) {
    throw new DomainCompilerError(
      "qualification_authority_verification_failed",
      "Runtime Curator attestation does not authorize this candidate and Curator",
      request.curatorId,
    );
  }
  return attestation;
}

async function requirePhysicalDirectory(path: string): Promise<string> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new DomainCompilerError(
      "invalid_qualification_output_directory",
      "Qualification output directory does not exist",
      path,
    );
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new DomainCompilerError(
      "invalid_qualification_output_directory",
      "Qualification output must be one physical directory",
      path,
    );
  }
  return realpath(path);
}

async function writeArtifact(
  outputRoot: string,
  prefix: string,
  digest: string,
  artifact: unknown,
): Promise<string> {
  const physicalOutputRoot = await requirePhysicalDirectory(outputRoot);
  const path = join(physicalOutputRoot, `${prefix}-${digest}.json`);
  const bytes = `${canonicalJson(artifact)}\n`;
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(bytes, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== bytes) {
      throw new DomainCompilerError(
        "qualification_artifact_collision",
        "Existing artifact bytes do not match their content address",
        digest,
      );
    }
  }
  return path;
}

async function readJsonArtifact<T extends z.ZodType>(
  path: string,
  schema: T,
  invalidCode: string,
): Promise<z.infer<T>> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new DomainCompilerError(invalidCode, "Artifact is unavailable", path);
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new DomainCompilerError(invalidCode, "Artifact must be one physical file", path);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new DomainCompilerError(invalidCode, "Artifact is not valid JSON", path);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainCompilerError(
      invalidCode,
      parsed.error.issues[0]?.message ?? "Artifact is invalid",
      path,
    );
  }
  return parsed.data;
}

async function readYamlArtifact<T extends z.ZodType>(
  path: string,
  schema: T,
  invalidCode: string,
): Promise<{ readonly value: z.infer<T>; readonly raw: unknown }> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new DomainCompilerError(invalidCode, "Artifact is unavailable", path);
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new DomainCompilerError(invalidCode, "Artifact must be one physical file", path);
  }
  let raw: unknown;
  try {
    raw = parse(await readFile(path, "utf8"));
  } catch {
    throw new DomainCompilerError(invalidCode, "Artifact is not valid YAML", path);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainCompilerError(
      invalidCode,
      parsed.error.issues[0]?.message ?? "Artifact is invalid",
      path,
    );
  }
  return { value: parsed.data, raw };
}

function candidatePayload(candidate: z.infer<typeof candidateSchema>) {
  const { candidateDigest: _candidateDigest, ...payload } = candidate;
  return payload;
}

function freezePayload(freeze: z.infer<typeof holdoutFreezeSchema>) {
  const { freezeDigest: _freezeDigest, ...payload } = freeze;
  return payload;
}

function executionPayload(execution: z.infer<typeof holdoutExecutionSchema>) {
  const { executionDigest: _executionDigest, ...payload } = execution;
  return payload;
}

function unsealPayload(unseal: z.infer<typeof holdoutUnsealSchema>) {
  const { unsealDigest: _unsealDigest, ...payload } = unseal;
  return payload;
}

function assertDigest(actual: string, expected: string, code: string, locator: string): void {
  if (actual !== expected) {
    throw new DomainCompilerError(code, "Artifact digest chain is invalid", locator);
  }
}

async function findCompleteClosure(root: string) {
  const evaluation = (
    await readDomainYaml(
      root,
      "evaluation.yaml",
      domainEvaluationSchema,
      "invalid_domain_evaluation",
    )
  ).value;
  const results = await Promise.all(
    evaluation.closure_expectations.map(async (request) => ({
      request,
      result: await compileEvaluationClosureDirectory(root, { closureId: request.closure_id }),
    })),
  );
  const complete = results.filter(({ result }) => result.status === "complete");
  if (complete.length !== 1 || complete[0] === undefined) {
    throw new DomainCompilerError(
      "qualification_closure_ambiguous",
      "Qualification candidate requires exactly one complete Closure",
    );
  }
  return { evaluation, request: complete[0].request, closure: complete[0].result };
}

export async function freezeDomainQualificationCandidateDirectory(
  inputRoot: string,
  outputRoot: string,
  identity: { readonly authorId: string; readonly sourceRevision: string },
): Promise<StoredQualificationArtifact> {
  if (
    !revisionSchema.safeParse(identity.sourceRevision).success ||
    identity.authorId.length === 0
  ) {
    throw new DomainCompilerError(
      "invalid_candidate_identity",
      "Candidate freeze requires author identity and exact source revision",
    );
  }
  const root = await resolveDomainRoot(inputRoot);
  const validation = await validateDomainGraderDirectory(root);
  if (validation.status !== "validated") {
    throw new DomainCompilerError(
      "candidate_not_validated",
      "An invalid grader cannot enter independent qualification",
    );
  }
  const [{ evaluation, request, closure }, contractsInput] = await Promise.all([
    findCompleteClosure(root),
    readDomainYaml(
      root,
      "product-contracts.yaml",
      productContractsSchema,
      "invalid_product_contracts",
    ),
  ]);
  const context = buildGraderContext(evaluation, contractsInput.value, request);
  const payload = {
    schemaVersion: "domain-first-qualification-candidate-v0" as const,
    authorId: identity.authorId,
    sourceRevision: identity.sourceRevision,
    closureDigest: closure.digest,
    graderDigest: validation.graderDigest,
    validationEvidenceDigest: validation.evidenceDigest,
    visibleCaseIds: validation.caseEvidence.map((evidence) => evidence.caseId).sort(),
    visibleObservationDigests: [
      ...validation.caseEvidence.map((evidence) => evidence.observationDigest),
      ...evaluation.qualification_protocol.retired_holdout_observation_digests,
    ].sort(),
    gradeAtoms: evaluation.grade_atoms,
    verdictPolicy: evaluation.verdict_policy,
    context,
  };
  const digest = canonicalJsonDigest(payload);
  const path = await writeArtifact(outputRoot, "candidate", digest, {
    ...payload,
    candidateDigest: digest,
  });
  return { digest, path };
}

export async function freezeIndependentQualificationCasesFile(
  candidatePath: string,
  casesPath: string,
  outputRoot: string,
  verifier?: CuratorAuthorityVerifier,
): Promise<StoredQualificationArtifact> {
  const candidate = await readJsonArtifact(
    candidatePath,
    candidateSchema,
    "invalid_qualification_candidate",
  );
  assertDigest(
    candidate.candidateDigest,
    canonicalJsonDigest(candidatePayload(candidate)),
    "qualification_candidate_digest_mismatch",
    candidatePath,
  );
  const cases = await readYamlArtifact(
    casesPath,
    qualificationCasesSchema,
    "invalid_qualification_cases",
  );
  if (cases.value.curator_id === candidate.authorId) {
    throw new DomainCompilerError(
      "qualification_curator_not_independent",
      "Qualification Curator must differ from the grader author",
      cases.value.curator_id,
    );
  }
  const visibleCaseIds = new Set(candidate.visibleCaseIds);
  const overlap = cases.value.cases.find((fixtureCase) => visibleCaseIds.has(fixtureCase.case_id));
  if (overlap !== undefined) {
    throw new DomainCompilerError(
      "qualification_case_reuses_visible_identity",
      "Independent holdout cannot reuse a visible development, calibration or validation case ID",
      overlap.case_id,
    );
  }
  const visibleObservationDigests = new Set(candidate.visibleObservationDigests);
  const observationOverlap = cases.value.cases.find((fixtureCase) =>
    visibleObservationDigests.has(canonicalJsonDigest(fixtureCase.observations)),
  );
  if (observationOverlap !== undefined) {
    throw new DomainCompilerError(
      "qualification_case_reuses_visible_observation",
      "Independent holdout cannot reuse a visible or retired observation vector",
      observationOverlap.case_id,
    );
  }
  const curatorAttestation = await verifyCuratorAuthority(
    {
      provider: cases.value.curator_authority.provider,
      candidateDigest: candidate.candidateDigest,
      authorId: candidate.authorId,
      curatorId: cases.value.curator_id,
      assignmentMessageId: cases.value.curator_authority.assignment_message_id,
      acceptanceMessageId: cases.value.curator_authority.acceptance_message_id,
    },
    verifier,
  );
  const payload = {
    schemaVersion: "domain-first-holdout-freeze-v0" as const,
    candidateDigest: candidate.candidateDigest,
    casesDigest: canonicalJsonDigest(cases.raw),
    cohortId: cases.value.cohort_id,
    curatorId: cases.value.curator_id,
    curatorAttestation,
  };
  const digest = canonicalJsonDigest(payload);
  const path = await writeArtifact(outputRoot, "holdout-freeze", digest, {
    ...payload,
    freezeDigest: digest,
  });
  return { digest, path };
}

export async function executeIndependentQualificationHoldout(
  candidatePath: string,
  casesPath: string,
  freezePath: string,
  outputRoot: string,
): Promise<StoredQualificationArtifact> {
  const [candidate, cases, freeze] = await Promise.all([
    readJsonArtifact(candidatePath, candidateSchema, "invalid_qualification_candidate"),
    readYamlArtifact(casesPath, qualificationCasesSchema, "invalid_qualification_cases"),
    readJsonArtifact(freezePath, holdoutFreezeSchema, "invalid_holdout_freeze"),
  ]);
  assertDigest(
    candidate.candidateDigest,
    canonicalJsonDigest(candidatePayload(candidate)),
    "qualification_candidate_digest_mismatch",
    candidatePath,
  );
  assertDigest(
    freeze.freezeDigest,
    canonicalJsonDigest(freezePayload(freeze)),
    "holdout_freeze_digest_mismatch",
    freezePath,
  );
  const casesDigest = canonicalJsonDigest(cases.raw);
  if (
    freeze.candidateDigest !== candidate.candidateDigest ||
    freeze.casesDigest !== casesDigest ||
    freeze.cohortId !== cases.value.cohort_id ||
    freeze.curatorId !== cases.value.curator_id ||
    freeze.curatorAttestation.curatorId !== cases.value.curator_id ||
    freeze.curatorAttestation.assignmentMessageId !==
      cases.value.curator_authority.assignment_message_id ||
    freeze.curatorAttestation.acceptanceMessageId !==
      cases.value.curator_authority.acceptance_message_id ||
    freeze.curatorId === candidate.authorId ||
    cases.value.cases.some(
      (fixtureCase) =>
        candidate.visibleCaseIds.includes(fixtureCase.case_id) ||
        candidate.visibleObservationDigests.includes(canonicalJsonDigest(fixtureCase.observations)),
    )
  ) {
    throw new DomainCompilerError(
      "holdout_freeze_binding_mismatch",
      "Holdout freeze does not bind the candidate and label-free cases",
    );
  }
  const predictions = cases.value.cases.map((fixtureCase) => {
    const result = executeGradeVector(
      candidate.gradeAtoms,
      fixtureCase.observations,
      candidate.context as GraderContext,
      candidate.verdictPolicy.precedence,
    );
    return {
      caseId: fixtureCase.case_id,
      kind: fixtureCase.kind,
      observationDigest: canonicalJsonDigest(fixtureCase.observations),
      atoms: result.atoms,
      overall: result.overall,
    };
  });
  const payload = {
    schemaVersion: "domain-first-holdout-execution-v0" as const,
    candidateDigest: candidate.candidateDigest,
    casesDigest,
    freezeDigest: freeze.freezeDigest,
    cohortId: cases.value.cohort_id,
    curatorId: cases.value.curator_id,
    curatorAttestation: freeze.curatorAttestation,
    predictions,
  };
  const digest = canonicalJsonDigest(payload);
  const path = await writeArtifact(outputRoot, "holdout-execution", digest, {
    ...payload,
    executionDigest: digest,
  });
  return { digest, path };
}

export async function unsealIndependentQualificationExpectationsFile(
  executionPath: string,
  expectationsPath: string,
  outputRoot: string,
): Promise<StoredQualificationArtifact> {
  const [execution, expectations] = await Promise.all([
    readJsonArtifact(executionPath, holdoutExecutionSchema, "invalid_holdout_execution"),
    readYamlArtifact(
      expectationsPath,
      qualificationExpectationsSchema,
      "invalid_qualification_expectations",
    ),
  ]);
  assertDigest(
    execution.executionDigest,
    canonicalJsonDigest(executionPayload(execution)),
    "holdout_execution_digest_mismatch",
    executionPath,
  );
  if (
    expectations.value.cohort_id !== execution.cohortId ||
    expectations.value.curator_id !== execution.curatorId
  ) {
    throw new DomainCompilerError(
      "holdout_unseal_identity_mismatch",
      "Unsealed expectations must come from the holdout Curator",
    );
  }
  const payload = {
    schemaVersion: "domain-first-holdout-unseal-v0" as const,
    candidateDigest: execution.candidateDigest,
    casesDigest: execution.casesDigest,
    executionDigest: execution.executionDigest,
    expectationsDigest: canonicalJsonDigest(expectations.raw),
    cohortId: execution.cohortId,
    curatorId: execution.curatorId,
    curatorAttestation: execution.curatorAttestation,
  };
  const digest = canonicalJsonDigest(payload);
  const path = await writeArtifact(outputRoot, "holdout-unseal", digest, {
    ...payload,
    unsealDigest: digest,
  });
  return { digest, path };
}

export async function admitIndependentQualificationRun(
  candidatePath: string,
  casesPath: string,
  freezePath: string,
  executionPath: string,
  expectationsPath: string,
  unsealPath: string,
  outputRoot: string,
  verifier?: CuratorAuthorityVerifier,
): Promise<StoredIndependentQualificationRun> {
  const [candidate, cases, freeze, execution, expectations, unseal] = await Promise.all([
    readJsonArtifact(candidatePath, candidateSchema, "invalid_qualification_candidate"),
    readYamlArtifact(casesPath, qualificationCasesSchema, "invalid_qualification_cases"),
    readJsonArtifact(freezePath, holdoutFreezeSchema, "invalid_holdout_freeze"),
    readJsonArtifact(executionPath, holdoutExecutionSchema, "invalid_holdout_execution"),
    readYamlArtifact(
      expectationsPath,
      qualificationExpectationsSchema,
      "invalid_qualification_expectations",
    ),
    readJsonArtifact(unsealPath, holdoutUnsealSchema, "invalid_holdout_unseal"),
  ]);
  assertDigest(
    candidate.candidateDigest,
    canonicalJsonDigest(candidatePayload(candidate)),
    "qualification_candidate_digest_mismatch",
    candidatePath,
  );
  assertDigest(
    freeze.freezeDigest,
    canonicalJsonDigest(freezePayload(freeze)),
    "holdout_freeze_digest_mismatch",
    freezePath,
  );
  assertDigest(
    execution.executionDigest,
    canonicalJsonDigest(executionPayload(execution)),
    "holdout_execution_digest_mismatch",
    executionPath,
  );
  assertDigest(
    unseal.unsealDigest,
    canonicalJsonDigest(unsealPayload(unseal)),
    "holdout_unseal_digest_mismatch",
    unsealPath,
  );
  const casesDigest = canonicalJsonDigest(cases.raw);
  const expectationsDigest = canonicalJsonDigest(expectations.raw);
  const liveAttestation = await verifyCuratorAuthority(
    {
      provider: cases.value.curator_authority.provider,
      candidateDigest: candidate.candidateDigest,
      authorId: candidate.authorId,
      curatorId: cases.value.curator_id,
      assignmentMessageId: cases.value.curator_authority.assignment_message_id,
      acceptanceMessageId: cases.value.curator_authority.acceptance_message_id,
    },
    verifier,
  );
  if (
    execution.candidateDigest !== candidate.candidateDigest ||
    execution.casesDigest !== casesDigest ||
    execution.freezeDigest !== freeze.freezeDigest ||
    freeze.candidateDigest !== candidate.candidateDigest ||
    freeze.casesDigest !== casesDigest ||
    freeze.cohortId !== cases.value.cohort_id ||
    freeze.curatorId !== cases.value.curator_id ||
    unseal.candidateDigest !== candidate.candidateDigest ||
    unseal.casesDigest !== casesDigest ||
    unseal.executionDigest !== execution.executionDigest ||
    unseal.expectationsDigest !== expectationsDigest ||
    cases.value.cohort_id !== execution.cohortId ||
    expectations.value.cohort_id !== execution.cohortId ||
    cases.value.curator_id !== execution.curatorId ||
    expectations.value.curator_id !== execution.curatorId ||
    candidate.authorId === execution.curatorId ||
    cases.value.cases.some(
      (fixtureCase) =>
        candidate.visibleCaseIds.includes(fixtureCase.case_id) ||
        candidate.visibleObservationDigests.includes(canonicalJsonDigest(fixtureCase.observations)),
    ) ||
    canonicalJsonDigest(liveAttestation) !== canonicalJsonDigest(freeze.curatorAttestation) ||
    canonicalJsonDigest(freeze.curatorAttestation) !==
      canonicalJsonDigest(execution.curatorAttestation) ||
    canonicalJsonDigest(execution.curatorAttestation) !==
      canonicalJsonDigest(unseal.curatorAttestation)
  ) {
    throw new DomainCompilerError(
      "qualification_chain_mismatch",
      "Qualification artifacts do not form one exact freeze/execution/unseal chain",
    );
  }
  const expectationByCase = new Map(
    expectations.value.expectations.map((expectation) => [expectation.case_id, expectation]),
  );
  let admitted = execution.predictions.length === expectations.value.expectations.length;
  for (const prediction of execution.predictions) {
    const expectation = expectationByCase.get(prediction.caseId);
    admitted &&=
      expectation !== undefined &&
      canonicalJsonDigest(prediction.atoms) === canonicalJsonDigest(expectation.atoms) &&
      prediction.overall === expectation.overall &&
      (prediction.kind === "mutant"
        ? prediction.overall === "fail"
        : prediction.overall === "pass");
  }
  const resultWithoutDigest = {
    status: admitted ? ("qualified" as const) : ("unqualified" as const),
    candidateDigest: candidate.candidateDigest,
    casesDigest,
    freezeDigest: freeze.freezeDigest,
    executionDigest: execution.executionDigest,
    expectationsDigest,
    unsealDigest: unseal.unsealDigest,
    curatorId: execution.curatorId,
    curatorAttestation: execution.curatorAttestation,
    predictions: execution.predictions,
  };
  const result: DomainQualificationResult = {
    ...resultWithoutDigest,
    evidenceDigest: canonicalJsonDigest(resultWithoutDigest),
  };
  const runPayload = {
    schemaVersion: "domain-first-independent-qualification-run-v0" as const,
    result,
  };
  const digest = canonicalJsonDigest(runPayload);
  const path = await writeArtifact(outputRoot, "qualification-run", digest, {
    ...runPayload,
    runDigest: digest,
  });
  return { digest, path, result };
}

export async function replayIndependentQualificationRunFile(
  runPath: string,
): Promise<DomainQualificationResult> {
  const run = await readJsonArtifact(
    runPath,
    qualificationRunSchema,
    "invalid_independent_qualification_run",
  );
  const expectedResultDigest = canonicalJsonDigest({
    status: run.result.status,
    candidateDigest: run.result.candidateDigest,
    casesDigest: run.result.casesDigest,
    freezeDigest: run.result.freezeDigest,
    executionDigest: run.result.executionDigest,
    expectationsDigest: run.result.expectationsDigest,
    unsealDigest: run.result.unsealDigest,
    curatorId: run.result.curatorId,
    curatorAttestation: run.result.curatorAttestation,
    predictions: run.result.predictions,
  });
  const expectedRunDigest = canonicalJsonDigest({
    schemaVersion: run.schemaVersion,
    result: run.result,
  });
  if (run.result.evidenceDigest !== expectedResultDigest || run.runDigest !== expectedRunDigest) {
    throw new DomainCompilerError(
      "independent_qualification_run_digest_mismatch",
      "Qualification Run does not match its evidence and content digests",
      runPath,
    );
  }
  return run.result;
}
