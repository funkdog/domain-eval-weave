import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../canonical-json.js";
import { writeExclusiveOrVerify } from "../capsule/artifact-store.js";
import {
  type CapsuleRelease,
  type EvaluationRun,
  type EvaluatorCheck,
  parseEvaluationRun,
} from "../capsule/contracts.js";
import {
  CapsuleError,
  findCandidate,
  findEvaluator,
  findRequirement,
  type LoadedCapsule,
} from "../capsule/loader.js";
import type { ReleasedCapsule } from "../capsule/release.js";
import { readCapsuleRelease } from "../capsule/release.js";
import {
  type CandidateExecution,
  type CandidateRunner,
  SandboxedCommandRunner,
} from "./command-runner.js";

export interface PersistedEvaluationRun {
  readonly run: EvaluationRun;
  readonly sha256: string;
  readonly ref: string;
}

function assertRelease(capsule: LoadedCapsule, release: ReleasedCapsule): void {
  if (
    release.release.capsule_id !== capsule.manifest.capsule_id ||
    release.release.capsule_version !== capsule.manifest.version ||
    canonicalJsonDigest(release.release) !== release.sha256
  ) {
    throw new CapsuleError("CAPSULE_RELEASE_MISMATCH", "Release does not match loaded Capsule");
  }
}

type JsonDocument =
  | null
  | boolean
  | number
  | string
  | JsonDocument[]
  | { [key: string]: JsonDocument };

function select(
  document: JsonDocument,
  path: readonly (number | string)[],
): { found: boolean; value?: JsonDocument } {
  let current: JsonDocument = document;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return { found: false };
      current = current[segment] as JsonDocument;
      continue;
    }
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      return { found: false };
    }
    current = current[segment] as JsonDocument;
  }
  return { found: true, value: current };
}

function evaluateCheck(
  check: EvaluatorCheck,
  execution: CandidateExecution,
  document: JsonDocument | undefined,
): { status: "pass" | "fail" | "measurement_error"; message?: string } {
  if (check.kind === "exit_code_equals") {
    return execution.exitCode === check.expected
      ? { status: "pass" }
      : {
          status: "fail",
          message: `exit code ${execution.exitCode ?? "null"} did not equal ${check.expected}`,
        };
  }
  if (document === undefined) {
    return { status: "measurement_error", message: "Candidate stdout was not one JSON document" };
  }
  const selected = select(document, check.path);
  if (!selected.found) {
    return {
      status: "fail",
      message: `public observation path ${check.path.join(".")} is missing`,
    };
  }
  if (check.kind === "json_path_equals") {
    return canonicalJson(selected.value) === canonicalJson(check.expected)
      ? { status: "pass" }
      : {
          status: "fail",
          message: `public observation ${check.path.join(".")} did not equal expectation`,
        };
  }
  if (!Array.isArray(selected.value)) {
    return {
      status: "fail",
      message: `public observation ${check.path.join(".")} is not an array`,
    };
  }
  const count = selected.value.filter((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    return Object.entries(check.where).every(
      ([key, expected]) => key in entry && canonicalJson(entry[key]) === canonicalJson(expected),
    );
  }).length;
  return count === check.expected_count
    ? { status: "pass" }
    : {
        status: "fail",
        message: `matching effect count ${count} did not equal ${check.expected_count}`,
      };
}

function parseDocument(execution: CandidateExecution): JsonDocument | undefined {
  if (execution.timedOut || execution.outputLimitExceeded) return undefined;
  try {
    return JSON.parse(execution.stdout.trim()) as JsonDocument;
  } catch {
    return undefined;
  }
}

function rebuildRun(run: EvaluationRun): EvaluationRun {
  const statuses = run.claims.map((claim) => claim.status);
  const measurementValidity = statuses.includes("measurement_error")
    ? "invalid"
    : statuses.includes("inconclusive")
      ? "insufficient"
      : "valid";
  const verdict =
    measurementValidity !== "valid"
      ? "inconclusive"
      : statuses.includes("fail")
        ? "reject"
        : statuses.length === 0
          ? "inconclusive"
          : "accept";
  return parseEvaluationRun({
    ...run,
    measurement_validity: measurementValidity,
    verdict,
  });
}

async function persistRun(root: string, run: EvaluationRun): Promise<PersistedEvaluationRun> {
  const sha256 = canonicalJsonDigest(run);
  const ref = `.eval/runs/${sha256}.json`;
  await mkdir(resolve(root, ".eval/runs"), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(`${canonicalJson(run)}\n`, "utf8");
  await writeExclusiveOrVerify(
    resolve(root, ref),
    bytes,
    () => new CapsuleError("CAPSULE_RUN_COLLISION", "Existing Run contains different bytes", ref),
  );
  return { run, sha256, ref };
}

async function evaluateExecution(input: {
  readonly capsule: LoadedCapsule;
  readonly release: ReleasedCapsule;
  readonly evaluatorRef: string;
  readonly requirementId: string;
  readonly candidateId: string;
  readonly candidateSha256: string;
  readonly execution: CandidateExecution;
  readonly initialDiagnostics?: EvaluationRun["diagnostics"];
  readonly persist?: boolean;
}): Promise<PersistedEvaluationRun> {
  const requirement = findRequirement(input.capsule, input.requirementId);
  const evaluator = findEvaluator(input.capsule, input.evaluatorRef);
  if (evaluator.requirement_id !== requirement.requirement_id) {
    throw new CapsuleError(
      "CAPSULE_EVALUATOR_REQUIREMENT_MISMATCH",
      `Evaluator ${input.evaluatorRef} does not evaluate ${requirement.requirement_id}`,
    );
  }
  const diagnostics: EvaluationRun["diagnostics"] = [...(input.initialDiagnostics ?? [])];
  if (input.execution.timedOut)
    diagnostics.push({ code: "CANDIDATE_TIMEOUT", message: "Candidate timed out" });
  if (input.execution.outputLimitExceeded) {
    diagnostics.push({
      code: "CANDIDATE_OUTPUT_LIMIT",
      message: "Candidate exceeded output limit",
    });
  }
  const document = diagnostics.length === 0 ? parseDocument(input.execution) : undefined;
  if (diagnostics.length === 0 && document === undefined) {
    diagnostics.push({
      code: "CANDIDATE_OUTPUT_INVALID",
      message: "Candidate stdout must contain exactly one JSON document",
    });
  }

  const claimsById = new Map(input.capsule.domain.claims.map((claim) => [claim.claim_id, claim]));
  const claimResults: EvaluationRun["claims"] = [];
  for (const edge of requirement.edges) {
    if (!edge.required) continue;
    const claim = claimsById.get(edge.claim_id);
    if (claim === undefined) throw new CapsuleError("CAPSULE_CLAIM_UNKNOWN", edge.claim_id);
    const axis = edge.relation === "preserves" ? "domain_preservation" : "requirement_delta";
    if (claim.status !== "confirmed") {
      claimResults.push({
        claim_id: claim.claim_id,
        axis,
        status: "inconclusive",
        check_ids: [],
        diagnostics: [
          {
            code: "CLAIM_NOT_CONFIRMED",
            message: `${claim.status} Claim cannot form a hard verdict`,
            locator: `domain.yaml#${claim.claim_id}`,
          },
        ],
      });
      continue;
    }
    const checks = evaluator.checks.filter((check) => check.claim_id === claim.claim_id);
    if (checks.length === 0) {
      claimResults.push({
        claim_id: claim.claim_id,
        axis,
        status: "inconclusive",
        check_ids: [],
        diagnostics: [
          {
            code: "CLAIM_NOT_OBSERVED",
            message: "Confirmed Claim has no check in this Evaluator",
            locator: `${input.evaluatorRef}#${claim.claim_id}`,
          },
        ],
      });
      continue;
    }
    const outcomes = checks.map((check) => ({
      check,
      result: evaluateCheck(check, input.execution, document),
    }));
    const status =
      diagnostics.length > 0 ||
      outcomes.some((outcome) => outcome.result.status === "measurement_error")
        ? "measurement_error"
        : outcomes.some((outcome) => outcome.result.status === "fail")
          ? "fail"
          : "pass";
    claimResults.push({
      claim_id: claim.claim_id,
      axis,
      status,
      check_ids: checks.map((check) => check.check_id),
      diagnostics: outcomes.flatMap((outcome) =>
        outcome.result.message === undefined
          ? []
          : [
              {
                code:
                  outcome.result.status === "measurement_error"
                    ? "OBSERVATION_INVALID"
                    : "CLAIM_CHECK_FAILED",
                message: outcome.result.message,
                locator: `${input.evaluatorRef}#${outcome.check.check_id}`,
              },
            ],
      ),
    });
  }
  const provisional = parseEvaluationRun({
    schema_version: 1,
    run_id: "pending",
    capsule_release_sha256: input.release.sha256,
    requirement_id: requirement.requirement_id,
    evaluator: { evaluator_id: evaluator.evaluator_id, version: evaluator.version },
    candidate_id: input.candidateId,
    candidate_sha256: input.candidateSha256,
    measurement_validity: "invalid",
    verdict: "inconclusive",
    claims: claimResults,
    execution: {
      exit_code: input.execution.exitCode,
      signal: input.execution.signal,
      stdout_sha256: sha256Hex(input.execution.stdout),
      stderr_sha256: sha256Hex(input.execution.stderr),
      timed_out: input.execution.timedOut,
      output_limit_exceeded: input.execution.outputLimitExceeded,
    },
    diagnostics,
  });
  const { run_id: _pendingRunId, ...body } = provisional;
  const run = rebuildRun({
    ...provisional,
    run_id: `run-${canonicalJsonDigest(body).slice(0, 24)}`,
  });
  if (input.persist !== false) return persistRun(input.capsule.root, run);
  const sha256 = canonicalJsonDigest(run);
  return { run, sha256, ref: `.eval/runs/${sha256}.json` };
}

export async function evaluateCandidate(input: {
  readonly capsule: LoadedCapsule;
  readonly release: ReleasedCapsule;
  readonly evaluatorRef: string;
  readonly requirementId: string;
  readonly candidateId: string;
  readonly runner?: CandidateRunner;
  readonly persist?: boolean;
}): Promise<PersistedEvaluationRun> {
  assertRelease(input.capsule, input.release);
  const candidate = findCandidate(input.capsule, input.candidateId);
  const candidateEntries = input.release.release.entries.filter(
    (entry) => entry.path === candidate.path || entry.path.startsWith(`${candidate.path}/`),
  );
  if (candidateEntries.length === 0) {
    throw new CapsuleError(
      "CAPSULE_CANDIDATE_CLOSURE_MISSING",
      `Release does not bind Candidate ${candidate.candidate_id}`,
    );
  }
  const candidateSha256 = canonicalJsonDigest(candidateEntries);
  let execution: CandidateExecution;
  const diagnostics: EvaluationRun["diagnostics"] = [];
  try {
    execution = await (input.runner ?? new SandboxedCommandRunner()).run({
      capsule: input.capsule,
      candidate,
    });
  } catch (error) {
    execution = {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      outputLimitExceeded: false,
    };
    diagnostics.push({
      code: "CANDIDATE_RUNNER_ERROR",
      message: error instanceof Error ? error.message : "Candidate runner failed",
    });
  }
  return evaluateExecution({
    capsule: input.capsule,
    release: input.release,
    evaluatorRef: input.evaluatorRef,
    requirementId: input.requirementId,
    candidateId: candidate.candidate_id,
    candidateSha256,
    execution,
    initialDiagnostics: diagnostics,
    ...(input.persist === undefined ? {} : { persist: input.persist }),
  });
}

export async function evaluateObservedCandidate(input: {
  readonly capsule: LoadedCapsule;
  readonly release: ReleasedCapsule;
  readonly evaluatorRef: string;
  readonly requirementId: string;
  readonly candidateId: string;
  readonly candidateSha256: string;
  readonly observation: unknown;
  readonly persist?: boolean;
}): Promise<PersistedEvaluationRun> {
  assertRelease(input.capsule, input.release);
  let stdout: string;
  try {
    stdout = canonicalJson(input.observation);
  } catch (error) {
    throw new CapsuleError(
      "CAPSULE_OBSERVATION_INVALID",
      error instanceof Error ? error.message : "Observed Candidate output is not JSON",
    );
  }
  return evaluateExecution({
    capsule: input.capsule,
    release: input.release,
    evaluatorRef: input.evaluatorRef,
    requirementId: input.requirementId,
    candidateId: input.candidateId,
    candidateSha256: input.candidateSha256,
    execution: {
      exitCode: 0,
      signal: null,
      stdout,
      stderr: "",
      timedOut: false,
      outputLimitExceeded: false,
    },
    ...(input.persist === undefined ? {} : { persist: input.persist }),
  });
}

export async function replayEvaluationRun(root: string, ref: string): Promise<EvaluationRun> {
  if (!/^\.eval\/runs\/[0-9a-f]{64}\.json$/.test(ref)) {
    throw new CapsuleError("CAPSULE_RUN_REF_INVALID", "Run ref is invalid", ref);
  }
  const run = parseEvaluationRun(JSON.parse(await readFile(resolve(root, ref), "utf8")));
  const expectedDigest = ref.slice(".eval/runs/".length, -".json".length);
  if (canonicalJsonDigest(run) !== expectedDigest) {
    throw new CapsuleError("CAPSULE_RUN_DRIFT", "Run digest drifted", ref);
  }
  await readCapsuleRelease(root, `.eval/releases/${run.capsule_release_sha256}.json`);
  if (canonicalJson(rebuildRun(run)) !== canonicalJson(run)) {
    throw new CapsuleError("CAPSULE_RUN_DRIFT", "Run cannot be mechanically rebuilt", ref);
  }
  return run;
}

export type { CapsuleRelease };
