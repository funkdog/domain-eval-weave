import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import { DEDICATED_RUNTIME_ROOT } from "../runtime-root.js";
import {
  admissionReasons,
  FORWARD_RUN_NONCE_ENV,
  FORWARD_RUN_ROOT_ENV,
  type ForwardAttemptOutcome,
  type ForwardAttemptRecord,
  type ForwardEvidenceRoot,
  type ForwardRunDescriptor,
  type ForwardRunEvidence,
  type ForwardRunProjection,
  type ForwardRunReceipt,
  forwardAttemptIntentSchema,
  forwardAttemptOutcomeSchema,
  forwardRunDescriptorSchema,
  forwardRunProjectionSchema,
  forwardRunReceiptSchema,
} from "./contracts.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class ForwardEvidenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ForwardEvidenceError";
  }
}

interface DirectoryIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
}

async function physicalDirectory(path: string, label: string): Promise<DirectoryIdentity> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new ForwardEvidenceError("FORWARD_EVIDENCE_PATH_INVALID", `${label} is missing`);
  }
  if (
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    (entry.mode & 0o777) !== 0o700 ||
    (await realpath(path)) !== resolve(path)
  ) {
    throw new ForwardEvidenceError(
      "FORWARD_EVIDENCE_PATH_INVALID",
      `${label} must be a physical 0700 directory`,
    );
  }
  return { path: resolve(path), dev: entry.dev, ino: entry.ino };
}

async function assertDirectoryIdentity(identity: DirectoryIdentity, label: string): Promise<void> {
  const current = await physicalDirectory(identity.path, label);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new ForwardEvidenceError("FORWARD_EVIDENCE_PATH_INVALID", `${label} identity changed`);
  }
}

function containedRuntimePath(path: string): string {
  const absolute = resolve(path);
  const relation = relative(DEDICATED_RUNTIME_ROOT, absolute);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    throw new ForwardEvidenceError(
      "FORWARD_EVIDENCE_PATH_INVALID",
      "forward evidence must be a strict child of the dedicated runtime root",
    );
  }
  return absolute;
}

async function ensurePhysicalChild(
  parent: DirectoryIdentity,
  name: string,
): Promise<DirectoryIdentity> {
  await assertDirectoryIdentity(parent, "forward evidence parent");
  const path = `${parent.path}/${name}`;
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await assertDirectoryIdentity(parent, "forward evidence parent");
  return physicalDirectory(path, `forward evidence ${name}`);
}

async function readCanonicalFile<T>(
  path: string,
  parser: { parse(value: unknown): T },
  label: string,
): Promise<T> {
  const entry = await lstat(path);
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    (entry.mode & 0o777) !== 0o600 ||
    (await realpath(path)) !== resolve(path)
  ) {
    throw new ForwardEvidenceError(
      "FORWARD_EVIDENCE_ENTRY_INVALID",
      `${label} must be a physical 0600 file`,
    );
  }
  const source = await readFile(path, "utf8");
  let value: T;
  try {
    value = parser.parse(JSON.parse(source));
  } catch {
    throw new ForwardEvidenceError("FORWARD_EVIDENCE_ENTRY_INVALID", `${label} is invalid`);
  }
  if (source !== `${canonicalJson(value)}\n`) {
    throw new ForwardEvidenceError("FORWARD_EVIDENCE_ENTRY_INVALID", `${label} is not canonical`);
  }
  return value;
}

async function writeCanonicalExclusive(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${canonicalJson(value)}\n`, { flag: "wx", mode: 0o600 });
}

export interface ForwardRunMetadata {
  readonly runId: string;
  readonly sourceRevision: string;
  readonly packageTar: { readonly sha256: string; readonly size: number };
  readonly profile: "eval-clowder-author";
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly promptSha256: string;
  readonly fixtureSetSha256: string;
  readonly startedAt: string;
}

export interface ForwardRunHandle {
  readonly runRoot: string;
  readonly nonce: string;
  readonly descriptor: ForwardRunDescriptor;
}

export interface ForwardTerminalEvidence {
  readonly endedAt: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly finalOutputSeen: boolean;
  readonly errorMarkers: readonly string[];
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly projection: ForwardRunProjection;
}

async function readAttempts(runRoot: string): Promise<readonly ForwardAttemptRecord[]> {
  const attemptsRoot = await physicalDirectory(`${runRoot}/attempts`, "attempt ledger");
  const names = (await readdir(attemptsRoot.path)).sort();
  const attempts: ForwardAttemptRecord[] = [];
  for (const name of names) {
    if (!/^[a-f0-9-]{36}$/.test(name)) {
      throw new ForwardEvidenceError(
        "FORWARD_EVIDENCE_ENTRY_INVALID",
        "attempt ledger contains an unknown entry",
      );
    }
    const attemptRoot = await physicalDirectory(`${attemptsRoot.path}/${name}`, "attempt entry");
    const files = (await readdir(attemptRoot.path)).sort();
    if (
      files.some((file) => file !== "intent.json" && file !== "outcome.json") ||
      !files.includes("intent.json")
    ) {
      throw new ForwardEvidenceError(
        "FORWARD_EVIDENCE_ENTRY_INVALID",
        "attempt entry grammar is invalid",
      );
    }
    const intent = await readCanonicalFile(
      `${attemptRoot.path}/intent.json`,
      forwardAttemptIntentSchema,
      "attempt intent",
    );
    if (intent.attempt_id !== name) {
      throw new ForwardEvidenceError(
        "FORWARD_EVIDENCE_ENTRY_INVALID",
        "attempt directory does not match intent identity",
      );
    }
    const outcome = files.includes("outcome.json")
      ? await readCanonicalFile(
          `${attemptRoot.path}/outcome.json`,
          forwardAttemptOutcomeSchema,
          "attempt outcome",
        )
      : undefined;
    if (
      outcome !== undefined &&
      (outcome.attempt_id !== intent.attempt_id ||
        outcome.run_id !== intent.run_id ||
        outcome.descriptor_sha256 !== intent.descriptor_sha256)
    ) {
      throw new ForwardEvidenceError(
        "FORWARD_EVIDENCE_ENTRY_INVALID",
        "attempt outcome identity drifted",
      );
    }
    attempts.push({ intent, ...(outcome === undefined ? {} : { outcome }) });
  }
  return attempts;
}

async function readRun(runRoot: string, allowIncomplete: boolean): Promise<ForwardRunEvidence> {
  const identity = await physicalDirectory(runRoot, "forward run");
  const descriptor = await readCanonicalFile(
    `${identity.path}/descriptor.json`,
    forwardRunDescriptorSchema,
    "run descriptor",
  );
  if (descriptor.run_id !== basename(identity.path)) {
    throw new ForwardEvidenceError(
      "FORWARD_EVIDENCE_ENTRY_INVALID",
      "run directory aliases a different run id",
    );
  }
  const attempts = await readAttempts(identity.path);
  let projection: ForwardRunProjection | undefined;
  try {
    projection = await readCanonicalFile(
      `${identity.path}/projection.json`,
      forwardRunProjectionSchema,
      "run projection",
    );
  } catch (error) {
    if (allowIncomplete && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { descriptor, attempts };
    }
    throw error;
  }
  let receipt: ForwardRunReceipt | undefined;
  try {
    receipt = await readCanonicalFile(
      `${identity.path}/receipt.json`,
      forwardRunReceiptSchema,
      "run receipt",
    );
  } catch (error) {
    if (
      allowIncomplete &&
      error instanceof ForwardEvidenceError &&
      error.message === "run receipt must be a physical 0600 file"
    ) {
      return { descriptor, projection, attempts };
    }
    if (allowIncomplete && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { descriptor, projection, attempts };
    }
    throw error;
  }
  const expectedPointers = attempts.map((attempt) => ({
    attempt_id: attempt.intent.attempt_id,
    intent_sha256: canonicalJsonDigest(attempt.intent),
    ...(attempt.outcome === undefined
      ? {}
      : { outcome_sha256: canonicalJsonDigest(attempt.outcome) }),
  }));
  const reasons = admissionReasons({
    exitCode: receipt.exit_code,
    signal: receipt.signal,
    timedOut: receipt.timed_out,
    outputLimitExceeded: receipt.output_limit_exceeded,
    finalOutputSeen: receipt.final_output_seen,
    errorMarkers: receipt.error_markers,
    attemptsComplete: attempts.every((attempt) => attempt.outcome !== undefined),
    projectionComplete: projection.cases.every(
      (entry) => entry.observed_status !== undefined && entry.target_sha256 !== undefined,
    ),
  });
  if (
    receipt.run_id !== descriptor.run_id ||
    receipt.descriptor.sha256 !== canonicalJsonDigest(descriptor) ||
    receipt.projection.sha256 !== canonicalJsonDigest(projection) ||
    projection.run_id !== descriptor.run_id ||
    projection.descriptor_sha256 !== canonicalJsonDigest(descriptor) ||
    projection.fixture_set_sha256 !== descriptor.fixture_set_sha256 ||
    canonicalJson(receipt.attempts) !== canonicalJson(expectedPointers) ||
    canonicalJson(receipt.admission_reasons) !== canonicalJson(reasons) ||
    receipt.admission !== (reasons.length === 0 ? "admitted" : "failed")
  ) {
    throw new ForwardEvidenceError(
      "FORWARD_EVIDENCE_CLOSURE_INVALID",
      "run receipt does not close over descriptor, attempts, or terminal outcome",
    );
  }
  return { descriptor, projection, receipt, attempts };
}

export class ForwardEvidenceStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = containedRuntimePath(root);
  }

  async beginRun(metadata: ForwardRunMetadata): Promise<ForwardRunHandle> {
    if (!ID_PATTERN.test(metadata.runId)) {
      throw new ForwardEvidenceError("FORWARD_RUN_ID_INVALID", "run id is invalid");
    }
    const root = await physicalDirectory(this.#root, "forward evidence root");
    const runs = await ensurePhysicalChild(root, "runs");
    const runRoot = `${runs.path}/${metadata.runId}`;
    await mkdir(runRoot, { mode: 0o700 });
    const runIdentity = await physicalDirectory(runRoot, "forward run");
    await ensurePhysicalChild(runIdentity, "attempts");
    const nonce = randomUUID();
    const descriptor = forwardRunDescriptorSchema.parse({
      schema_version: 1,
      run_id: metadata.runId,
      session_binding_sha256: sha256Hex(`${metadata.runId}\0${nonce}`),
      source_revision: metadata.sourceRevision,
      package_tar: metadata.packageTar,
      profile: metadata.profile,
      provider: metadata.provider,
      model: metadata.model,
      effort: metadata.effort,
      prompt_sha256: metadata.promptSha256,
      fixture_set_sha256: metadata.fixtureSetSha256,
      started_at: metadata.startedAt,
    });
    await writeCanonicalExclusive(`${runRoot}/descriptor.json`, descriptor);
    return { runRoot, nonce, descriptor };
  }

  async completeRun(
    handle: ForwardRunHandle,
    terminal: ForwardTerminalEvidence,
  ): Promise<ForwardRunReceipt> {
    const run = await readRun(handle.runRoot, true);
    if (
      run.descriptor.session_binding_sha256 !==
        sha256Hex(`${run.descriptor.run_id}\0${handle.nonce}`) ||
      canonicalJson(run.descriptor) !== canonicalJson(handle.descriptor)
    ) {
      throw new ForwardEvidenceError(
        "FORWARD_RUN_CLAIM_INVALID",
        "run handle does not match the immutable descriptor",
      );
    }
    const projection = forwardRunProjectionSchema.parse(terminal.projection);
    if (
      projection.run_id !== run.descriptor.run_id ||
      projection.descriptor_sha256 !== canonicalJsonDigest(run.descriptor) ||
      projection.fixture_set_sha256 !== run.descriptor.fixture_set_sha256
    ) {
      throw new ForwardEvidenceError(
        "FORWARD_PROJECTION_INVALID",
        "run projection does not match the immutable descriptor",
      );
    }
    await writeCanonicalExclusive(`${handle.runRoot}/projection.json`, projection);
    const attemptsComplete = run.attempts.every((attempt) => attempt.outcome !== undefined);
    const projectionComplete = projection.cases.every(
      (entry) => entry.observed_status !== undefined && entry.target_sha256 !== undefined,
    );
    const reasons = admissionReasons({ ...terminal, attemptsComplete, projectionComplete });
    const receipt = forwardRunReceiptSchema.parse({
      schema_version: 1,
      run_id: run.descriptor.run_id,
      descriptor: { ref: "descriptor.json", sha256: canonicalJsonDigest(run.descriptor) },
      projection: { ref: "projection.json", sha256: canonicalJsonDigest(projection) },
      ended_at: terminal.endedAt,
      exit_code: terminal.exitCode,
      signal: terminal.signal,
      timed_out: terminal.timedOut,
      output_limit_exceeded: terminal.outputLimitExceeded,
      final_output_seen: terminal.finalOutputSeen,
      error_markers: [...new Set(terminal.errorMarkers)].sort(),
      stdout_sha256: terminal.stdoutSha256,
      stderr_sha256: terminal.stderrSha256,
      attempts: run.attempts.map((attempt) => ({
        attempt_id: attempt.intent.attempt_id,
        intent_sha256: canonicalJsonDigest(attempt.intent),
        ...(attempt.outcome === undefined
          ? {}
          : { outcome_sha256: canonicalJsonDigest(attempt.outcome) }),
      })),
      admission: reasons.length === 0 ? "admitted" : "failed",
      admission_reasons: reasons,
    });
    await writeCanonicalExclusive(`${handle.runRoot}/receipt.json`, receipt);
    return receipt;
  }
}

export interface ForwardAttemptStartInput {
  readonly targetKind?: "evidence_card" | "decision_question";
  readonly targetRef?: string;
  readonly targetSha256?: string;
  readonly candidateRef?: string;
}

export interface ForwardAttemptToken {
  readonly attemptId: string;
  readonly runId: string;
  readonly descriptorSha256: string;
  readonly attemptRoot: string;
}

export interface ForwardAttemptRecorder {
  start(input: ForwardAttemptStartInput): Promise<ForwardAttemptToken>;
  finish(
    token: ForwardAttemptToken,
    input: {
      readonly result: "staged" | "rejected";
      readonly guardOutcome: ForwardAttemptOutcome["guard_outcome"];
      readonly diagnosticCodes: readonly string[];
    },
  ): Promise<void>;
}

export async function createForwardAttemptRecorder(input: {
  readonly runRoot: string;
  readonly nonce: string;
}): Promise<ForwardAttemptRecorder> {
  const runRoot = containedRuntimePath(input.runRoot);
  const identity = await physicalDirectory(runRoot, "forward run");
  const descriptor = await readCanonicalFile(
    `${runRoot}/descriptor.json`,
    forwardRunDescriptorSchema,
    "run descriptor",
  );
  if (
    descriptor.run_id !== basename(runRoot) ||
    descriptor.session_binding_sha256 !== sha256Hex(`${descriptor.run_id}\0${input.nonce}`)
  ) {
    throw new ForwardEvidenceError(
      "FORWARD_RUN_CLAIM_INVALID",
      "forward run nonce or identity does not match the descriptor",
    );
  }
  const attemptsRoot = await physicalDirectory(`${runRoot}/attempts`, "attempt ledger");
  const descriptorSha256 = canonicalJsonDigest(descriptor);
  async function assertOpen(): Promise<void> {
    await assertDirectoryIdentity(identity, "forward run");
    await assertDirectoryIdentity(attemptsRoot, "attempt ledger");
    const current = await readCanonicalFile(
      `${runRoot}/descriptor.json`,
      forwardRunDescriptorSchema,
      "run descriptor",
    );
    if (canonicalJsonDigest(current) !== descriptorSha256) {
      throw new ForwardEvidenceError("FORWARD_RUN_CLAIM_INVALID", "forward run descriptor drifted");
    }
    try {
      await lstat(`${runRoot}/receipt.json`);
      throw new ForwardEvidenceError(
        "FORWARD_RUN_CLOSED",
        "forward run receipt already closed the attempt ledger",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return {
    async start(startInput) {
      await assertOpen();
      const attemptId = randomUUID();
      const attemptRoot = `${attemptsRoot.path}/${attemptId}`;
      await mkdir(attemptRoot, { mode: 0o700 });
      await physicalDirectory(attemptRoot, "attempt entry");
      const intent = forwardAttemptIntentSchema.parse({
        schema_version: 1,
        attempt_id: attemptId,
        run_id: descriptor.run_id,
        descriptor_sha256: descriptorSha256,
        action: "stage_confirmation_candidate",
        ...(startInput.targetKind === undefined ? {} : { target_kind: startInput.targetKind }),
        ...(startInput.targetRef === undefined ? {} : { target_ref: startInput.targetRef }),
        ...(startInput.targetSha256 === undefined
          ? {}
          : { target_sha256: startInput.targetSha256 }),
        ...(startInput.candidateRef === undefined
          ? {}
          : { candidate_ref: startInput.candidateRef }),
        started_at: new Date().toISOString(),
      });
      await writeCanonicalExclusive(`${attemptRoot}/intent.json`, intent);
      return { attemptId, runId: descriptor.run_id, descriptorSha256, attemptRoot };
    },
    async finish(token, finishInput) {
      await assertOpen();
      if (
        token.runId !== descriptor.run_id ||
        token.descriptorSha256 !== descriptorSha256 ||
        resolve(token.attemptRoot) !== `${attemptsRoot.path}/${token.attemptId}`
      ) {
        throw new ForwardEvidenceError(
          "FORWARD_ATTEMPT_INVALID",
          "attempt token does not belong to this run",
        );
      }
      const attemptIdentity = await physicalDirectory(token.attemptRoot, "attempt entry");
      const intent = await readCanonicalFile(
        `${attemptIdentity.path}/intent.json`,
        forwardAttemptIntentSchema,
        "attempt intent",
      );
      if (intent.attempt_id !== token.attemptId) {
        throw new ForwardEvidenceError(
          "FORWARD_ATTEMPT_INVALID",
          "attempt intent identity drifted",
        );
      }
      const outcome = forwardAttemptOutcomeSchema.parse({
        schema_version: 1,
        attempt_id: token.attemptId,
        run_id: descriptor.run_id,
        descriptor_sha256: descriptorSha256,
        result: finishInput.result,
        guard_outcome: finishInput.guardOutcome,
        diagnostic_codes: [...new Set(finishInput.diagnosticCodes)].sort(),
        ended_at: new Date().toISOString(),
      });
      await writeCanonicalExclusive(`${attemptIdentity.path}/outcome.json`, outcome);
    },
  };
}

export async function createForwardAttemptRecorderFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): Promise<ForwardAttemptRecorder | undefined> {
  const runRoot = env[FORWARD_RUN_ROOT_ENV];
  const nonce = env[FORWARD_RUN_NONCE_ENV];
  if (runRoot === undefined && nonce === undefined) return undefined;
  if (runRoot === undefined || nonce === undefined) {
    throw new ForwardEvidenceError(
      "FORWARD_RUN_CLAIM_INVALID",
      "forward evidence environment is incomplete",
    );
  }
  return createForwardAttemptRecorder({ runRoot, nonce });
}

export async function readForwardEvidenceRoot(
  root: string,
  options: { readonly allowIncomplete?: boolean } = {},
): Promise<ForwardEvidenceRoot> {
  const evidenceRoot = await physicalDirectory(containedRuntimePath(root), "forward evidence root");
  let runsRoot: DirectoryIdentity;
  try {
    runsRoot = await physicalDirectory(`${evidenceRoot.path}/runs`, "forward runs");
  } catch (error) {
    if (options.allowIncomplete && error instanceof ForwardEvidenceError) {
      return { runs: [], admitted_run_ids: [], failed_run_ids: [], incomplete_run_ids: [] };
    }
    throw error;
  }
  const names = (await readdir(runsRoot.path)).sort();
  const runs: ForwardRunEvidence[] = [];
  for (const name of names) {
    if (!ID_PATTERN.test(name)) {
      throw new ForwardEvidenceError(
        "FORWARD_EVIDENCE_ENTRY_INVALID",
        "forward runs contain an unknown entry",
      );
    }
    runs.push(await readRun(`${runsRoot.path}/${name}`, options.allowIncomplete === true));
  }
  return {
    runs,
    admitted_run_ids: runs
      .filter((run) => run.receipt?.admission === "admitted")
      .map((run) => run.descriptor.run_id),
    failed_run_ids: runs
      .filter((run) => run.receipt?.admission === "failed")
      .map((run) => run.descriptor.run_id),
    incomplete_run_ids: runs
      .filter((run) => run.receipt === undefined)
      .map((run) => run.descriptor.run_id),
  };
}
