import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";

import { writeArtifactBytes, writeCanonicalJsonArtifact } from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest, sha256Hex } from "../contracts/canonical-json.js";
import type {
  CodeQualityJudgeResult,
  JudgeCaseInputSet,
  JudgeInputManifest,
  Phase3cArtifactPointer,
  SemanticJudgeResult,
} from "./contracts.js";
import {
  parseCodeQualityJudgeContract,
  parseJudgeCaseInputSet,
  parseJudgeInputManifest,
  parseSemanticJudgeContract,
} from "./contracts.js";
import { buildCodeQualityJudgeResult, buildSemanticJudgeResult } from "./judge.js";
import type { JudgeDevelopmentCase } from "./judge-development.js";
import { executeJudgeRun, type JudgeCarrier, type JudgeMaterial } from "./judge-runner.js";

const CASE_ENTRIES = [
  "base",
  "candidate",
  "candidate.diff",
  "domain.md",
  "manifest.json",
  "public-task.md",
  "requirement.md",
] as const;

type JudgeKind = "semantic" | "code_quality";
type PointerTuple = readonly [
  Phase3cArtifactPointer,
  Phase3cArtifactPointer,
  Phase3cArtifactPointer,
];

export interface JudgeCaseSource {
  readonly caseId: string;
  readonly judgeKind: JudgeKind;
  readonly requirement: string;
  readonly domain: string;
  readonly publicTask: string;
  readonly base: string;
  readonly candidateDiff: string;
  readonly candidateCode: string;
  readonly publicTestEvidence: readonly string[];
  readonly semanticResidualClaimIds: readonly string[];
}

export interface JudgeCaseExecution {
  readonly case_id: string;
  readonly judge_kind: JudgeKind;
  readonly input_manifest: Phase3cArtifactPointer;
  readonly attempt_receipts: readonly Phase3cArtifactPointer[];
  readonly run_receipts: PointerTuple;
  readonly repeat_results: PointerTuple;
  readonly aggregate: Phase3cArtifactPointer;
  readonly observed_dimensions: readonly {
    readonly dimension_id: string;
    readonly applicability: string;
    readonly verdict: string;
    readonly severity: string;
    readonly matched_condition_ids: readonly string[];
    readonly abstention_reason: string | null;
  }[];
}

function inside(root: string, candidate: string): boolean {
  const relation = relative(resolve(root), resolve(candidate));
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
}

async function readPrivateText(root: string, path: string): Promise<string> {
  if (!inside(root, path)) throw new Error("Judge case source escaped its sealed root");
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600
  ) {
    throw new Error(`Judge case source boundary is invalid: ${path}`);
  }
  if (!inside(await realpath(root), await realpath(path))) {
    throw new Error("Judge case source realpath escaped its sealed root");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
}

async function readPrivateTree(root: string, directory: string): Promise<string> {
  if (!inside(root, directory)) throw new Error("Judge case tree escaped its sealed root");
  const stat = await lstat(directory);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o777) !== 0o700 ||
    !inside(await realpath(root), await realpath(directory))
  ) {
    throw new Error(`Judge case tree boundary is invalid: ${directory}`);
  }
  const files: { readonly path: string; readonly content: string }[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        files.push({
          path: relative(directory, target),
          content: await readPrivateText(root, target),
        });
      } else {
        throw new Error(`Judge case tree contains a non-regular entry: ${target}`);
      }
    }
  };
  await visit(directory);
  if (files.length === 0) throw new Error("Judge case tree cannot be empty");
  return files.map(({ path, content }) => `<file path="${path}">\n${content}\n</file>`).join("\n");
}

export function developmentJudgeCaseSource(value: JudgeDevelopmentCase): JudgeCaseSource {
  return value.judgeKind === "semantic"
    ? {
        caseId: value.caseId,
        judgeKind: value.judgeKind,
        requirement: value.requirement,
        domain: value.domain,
        publicTask: value.publicTask,
        base: value.base,
        candidateDiff: value.candidateDiff,
        candidateCode: value.candidateCode,
        publicTestEvidence: [],
        semanticResidualClaimIds: value.semanticResidualClaimIds,
      }
    : {
        caseId: value.caseId,
        judgeKind: value.judgeKind,
        requirement: "",
        domain: "",
        publicTask: value.publicTask,
        base: value.base,
        candidateDiff: value.candidateDiff,
        candidateCode: value.candidateCode,
        publicTestEvidence: value.publicTestEvidence,
        semanticResidualClaimIds: [],
      };
}

export async function lockedJudgeCaseSource(input: {
  readonly curationRoot: string;
  readonly set: JudgeCaseInputSet;
  readonly caseId: string;
}): Promise<JudgeCaseSource> {
  const set = parseJudgeCaseInputSet(input.set);
  const entry = set.cases.find((candidate) => candidate.case_id === input.caseId);
  if (entry === undefined)
    throw new Error(`Judge case is absent from the locked set: ${input.caseId}`);
  const caseRoot = `${input.curationRoot}/cases/${input.caseId}`;
  const rootStat = await lstat(caseRoot);
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    (rootStat.mode & 0o777) !== 0o700 ||
    !inside(await realpath(input.curationRoot), await realpath(caseRoot))
  ) {
    throw new Error("Judge locked case root boundary is invalid");
  }
  const topLevel = (await readdir(caseRoot)).sort();
  if (canonicalJson(topLevel) !== canonicalJson([...CASE_ENTRIES].sort())) {
    throw new Error(`Judge locked case closure has missing or extra entries: ${input.caseId}`);
  }
  const manifestBytes = await readPrivateText(input.curationRoot, `${caseRoot}/manifest.json`);
  if (sha256Hex(manifestBytes) !== entry.input_closure_sha256) {
    throw new Error(`Judge locked case manifest digest drifted: ${input.caseId}`);
  }
  const parsedManifest = JSON.parse(manifestBytes) as unknown;
  if (canonicalJson(parsedManifest) !== manifestBytes) {
    throw new Error(`Judge locked case manifest is not canonical: ${input.caseId}`);
  }
  return {
    caseId: input.caseId,
    judgeKind: set.judge_kind,
    requirement: await readPrivateText(input.curationRoot, `${caseRoot}/requirement.md`),
    domain: await readPrivateText(input.curationRoot, `${caseRoot}/domain.md`),
    publicTask: await readPrivateText(input.curationRoot, `${caseRoot}/public-task.md`),
    base: await readPrivateTree(input.curationRoot, `${caseRoot}/base`),
    candidateDiff: await readPrivateText(input.curationRoot, `${caseRoot}/candidate.diff`),
    candidateCode: await readPrivateTree(input.curationRoot, `${caseRoot}/candidate`),
    publicTestEvidence: [],
    semanticResidualClaimIds:
      set.judge_kind === "semantic" ? [`semantic-residual-${input.caseId}`] : [],
  };
}

async function persistMaterial(input: {
  readonly campaignRoot: string;
  readonly ref: string;
  readonly role: JudgeMaterial["role"];
  readonly content: string;
}): Promise<{ readonly pointer: Phase3cArtifactPointer; readonly material: JudgeMaterial }> {
  const pointer = await writeArtifactBytes(input.campaignRoot, input.ref, input.content);
  return {
    pointer,
    material: { role: input.role, sourceRef: pointer.ref, content: input.content },
  };
}

export async function persistJudgeCaseInput(input: {
  readonly campaignRoot: string;
  readonly source: JudgeCaseSource;
  readonly contractPointer: Phase3cArtifactPointer;
}): Promise<{
  readonly manifest: JudgeInputManifest;
  readonly manifestPointer: Phase3cArtifactPointer;
  readonly materials: readonly JudgeMaterial[];
}> {
  const caseRoot = `artifact://campaign/phase3c/judge-cohort/${input.source.judgeKind}/cases/${input.source.caseId}`;
  const common = await Promise.all([
    persistMaterial({
      campaignRoot: input.campaignRoot,
      ref: `${caseRoot}/public-task.md`,
      role: "public_task",
      content: input.source.publicTask,
    }),
    persistMaterial({
      campaignRoot: input.campaignRoot,
      ref: `${caseRoot}/base.txt`,
      role: "base",
      content: input.source.base,
    }),
    persistMaterial({
      campaignRoot: input.campaignRoot,
      ref: `${caseRoot}/candidate.diff`,
      role: "candidate_diff",
      content: input.source.candidateDiff,
    }),
    persistMaterial({
      campaignRoot: input.campaignRoot,
      ref: `${caseRoot}/candidate.txt`,
      role: "candidate_code",
      content: input.source.candidateCode,
    }),
  ]);
  const [publicTask, base, candidateDiff, candidate] = common;
  if (
    publicTask === undefined ||
    base === undefined ||
    candidateDiff === undefined ||
    candidate === undefined
  ) {
    throw new Error("Judge common material persistence is incomplete");
  }
  let manifest: JudgeInputManifest;
  let materials = common.map((entry) => entry.material);
  if (input.source.judgeKind === "semantic") {
    const [requirement, domain] = await Promise.all([
      persistMaterial({
        campaignRoot: input.campaignRoot,
        ref: `${caseRoot}/requirement.md`,
        role: "requirement",
        content: input.source.requirement,
      }),
      persistMaterial({
        campaignRoot: input.campaignRoot,
        ref: `${caseRoot}/domain.md`,
        role: "domain",
        content: input.source.domain,
      }),
    ]);
    materials = [...materials, requirement.material, domain.material];
    manifest = parseJudgeInputManifest({
      schema_version: 1,
      judge_kind: "semantic",
      candidate_archive: candidate.pointer,
      candidate_diff: candidateDiff.pointer,
      base_tree: base.pointer,
      public_task: publicTask.pointer,
      untrusted_candidate_content: true,
      requirement: requirement.pointer,
      domain_refs: [domain.pointer],
      semantic_residual_claim_ids: input.source.semanticResidualClaimIds,
      judge_contract: input.contractPointer,
    });
  } else {
    const tests = await Promise.all(
      input.source.publicTestEvidence.map((content, index) =>
        persistMaterial({
          campaignRoot: input.campaignRoot,
          ref: `${caseRoot}/public-test-evidence-${index + 1}.txt`,
          role: "public_test_evidence",
          content,
        }),
      ),
    );
    materials = [...materials, ...tests.map((entry) => entry.material)];
    manifest = parseJudgeInputManifest({
      schema_version: 1,
      judge_kind: "code_quality",
      candidate_archive: candidate.pointer,
      candidate_diff: candidateDiff.pointer,
      base_tree: base.pointer,
      public_task: publicTask.pointer,
      untrusted_candidate_content: true,
      public_test_evidence: tests.map((entry) => entry.pointer),
      rubric: input.contractPointer,
    });
  }
  const manifestPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    `${caseRoot}/input-manifest.json`,
    manifest,
  );
  return { manifest, manifestPointer, materials };
}

function decisionProjection(dimension: {
  readonly dimension_id: string;
  readonly applicability: string;
  readonly verdict: string;
  readonly severity: string;
  readonly matched_condition_ids: readonly string[];
  readonly abstention_reason: string | null;
}) {
  return {
    dimension_id: dimension.dimension_id,
    applicability: dimension.applicability,
    verdict: dimension.verdict,
    severity: dimension.severity,
    matched_condition_ids: dimension.matched_condition_ids,
    abstention_reason: dimension.abstention_reason,
  };
}

export async function executeJudgeCase(input: {
  readonly campaignRoot: string;
  readonly cohortId: string;
  readonly source: JudgeCaseSource;
  readonly contract: unknown;
  readonly contractPointer: Phase3cArtifactPointer;
  readonly promptTemplate: string;
  readonly promptPointer: Phase3cArtifactPointer;
  readonly outputSchemaBytes: string;
  readonly outputSchemaPointer: Phase3cArtifactPointer;
  readonly carrier: (repeatIndex: 1 | 2 | 3) => JudgeCarrier;
  readonly timeoutMs: number;
  readonly maxAttemptsPerRepeat?: 1 | 2 | 3 | 4 | 5;
  readonly retryDelaysMs?: readonly number[];
  readonly clock?: () => string;
}): Promise<JudgeCaseExecution> {
  const kind = input.source.judgeKind;
  const contract =
    kind === "semantic"
      ? parseSemanticJudgeContract(input.contract)
      : parseCodeQualityJudgeContract(input.contract);
  const persisted = await persistJudgeCaseInput({
    campaignRoot: input.campaignRoot,
    source: input.source,
    contractPointer: input.contractPointer,
  });
  const clock = input.clock ?? (() => new Date().toISOString());
  const maxAttempts = input.maxAttemptsPerRepeat ?? 1;
  const retryDelays = input.retryDelaysMs ?? [5_000, 15_000, 30_000, 30_000];
  if (retryDelays.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 30_000)) {
    throw new Error("Judge retry delays must be nonnegative integers no greater than 30000 ms");
  }
  const runResults = [];
  const runReceiptPointers: Phase3cArtifactPointer[] = [];
  const repeatResultPointers: Phase3cArtifactPointer[] = [];
  const attemptReceipts: Phase3cArtifactPointer[] = [];
  for (const repeatIndex of [1, 2, 3] as const) {
    let completed = false;
    for (let attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex += 1) {
      const execution = await executeJudgeRun({
        campaignRoot: input.campaignRoot,
        runId: `${input.cohortId}-${input.source.caseId}-r${repeatIndex}-a${attemptIndex}`,
        repeatIndex,
        contract,
        contractPointer: input.contractPointer,
        promptTemplate: input.promptTemplate,
        promptPointer: input.promptPointer,
        inputManifest: persisted.manifest,
        inputManifestPointer: persisted.manifestPointer,
        outputSchemaPointer: input.outputSchemaPointer,
        outputSchemaBytes: input.outputSchemaBytes,
        materials: persisted.materials,
        startedAt: clock(),
        endedAt: clock,
        timeoutMs: input.timeoutMs,
        carrier: input.carrier(repeatIndex),
      });
      attemptReceipts.push(execution.receiptPointer);
      if (execution.result !== null && execution.resultPointer !== null) {
        runResults.push(execution.result);
        runReceiptPointers.push(execution.receiptPointer);
        repeatResultPointers.push(execution.resultPointer);
        completed = true;
        break;
      }
      const retryableTransportFailure =
        execution.receipt.diagnostic_codes.includes("JUDGE_SESSION_INVALID") &&
        execution.receipt.diagnostic_codes.every(
          (code) => code === "JUDGE_SESSION_INVALID" || code === "JUDGE_PROCESS_INVALID",
        );
      if (!retryableTransportFailure || attemptIndex === maxAttempts) break;
      const retryDelayMs = retryDelays[attemptIndex - 1] ?? 30_000;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, retryDelayMs));
    }
    if (!completed) {
      throw new Error(`Judge case protocol is invalid: ${input.source.caseId}`);
    }
  }
  const runReceipts = runReceiptPointers as unknown as PointerTuple;
  const repeatResults = repeatResultPointers as unknown as PointerTuple;
  const aggregate: SemanticJudgeResult | CodeQualityJudgeResult =
    kind === "semantic"
      ? buildSemanticJudgeResult({ contract, runs: runResults, runReceipts, repeatResults })
      : buildCodeQualityJudgeResult({ contract, runs: runResults, runReceipts, repeatResults });
  const aggregatePointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    `artifact://campaign/phase3c/judge-cohort/${kind}/cases/${input.source.caseId}/aggregate.json`,
    aggregate,
  );
  return {
    case_id: input.source.caseId,
    judge_kind: kind,
    input_manifest: persisted.manifestPointer,
    attempt_receipts: attemptReceipts,
    run_receipts: runReceipts,
    repeat_results: repeatResults,
    aggregate: aggregatePointer,
    observed_dimensions: aggregate.dimensions.map(decisionProjection),
  };
}

export function developmentCaseMatches(
  source: JudgeDevelopmentCase,
  execution: JudgeCaseExecution,
): boolean {
  return (
    source.caseId === execution.case_id &&
    source.judgeKind === execution.judge_kind &&
    canonicalJson(source.expectedDimensions) === canonicalJson(execution.observed_dimensions)
  );
}

export function judgeCohortDigest(executions: readonly JudgeCaseExecution[]): string {
  return canonicalJsonDigest(executions);
}
