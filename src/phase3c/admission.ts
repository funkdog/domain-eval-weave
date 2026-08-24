import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type JudgeAdmission,
  type JudgeCaseInputSet,
  type JudgeExecutionManifest,
  type JudgeFreezeReceipt,
  type JudgeLabelSet,
  type JudgeLabelsUnsealReceipt,
  type Phase3cArtifactPointer,
  parseCodeQualityJudgeContract,
  parseJudgeAdmission,
  parseJudgeCaseInputSet,
  parseJudgeExecutionManifest,
  parseJudgeFreezeReceipt,
  parseJudgeLabelSet,
  parseJudgeLabelsUnsealReceipt,
  parseSemanticJudgeContract,
} from "./contracts.js";
import { aggregateCodeQualityJudgeRuns, aggregateSemanticJudgeRuns } from "./judge.js";

type JudgeKind = "semantic" | "code_quality";
type JudgeContract =
  | ReturnType<typeof parseSemanticJudgeContract>
  | ReturnType<typeof parseCodeQualityJudgeContract>;
type RunTuple = readonly [unknown, unknown, unknown];
type PointerTuple = readonly [
  Phase3cArtifactPointer,
  Phase3cArtifactPointer,
  Phase3cArtifactPointer,
];

function parseContract(value: unknown): {
  readonly kind: JudgeKind;
  readonly contract: JudgeContract;
} {
  const record = value as Record<string, unknown>;
  if (record?.judge_contract_id === "phase3c-semantic-judge-v1") {
    return { kind: "semantic", contract: parseSemanticJudgeContract(value) };
  }
  return { kind: "code_quality", contract: parseCodeQualityJudgeContract(value) };
}

export function judgeDefinitionDigest(value: unknown): string {
  const { contract } = parseContract(value);
  const { calibration_admission_sha256: _admission, ...definition } = contract;
  return canonicalJsonDigest(definition);
}

function assertSet(
  value: unknown,
  kind: JudgeKind,
  setKind: JudgeCaseInputSet["set_kind"],
): JudgeCaseInputSet {
  const set = parseJudgeCaseInputSet(value);
  if (set.judge_kind !== kind || set.set_kind !== setKind) {
    throw new Error(`Judge case input set role mismatch: ${setKind}`);
  }
  return set;
}

function caseDigests(set: JudgeCaseInputSet): readonly string[] {
  return set.cases.map((entry) => entry.input_closure_sha256);
}

function assertDisjoint(sets: readonly JudgeCaseInputSet[]): void {
  const values = sets.flatMap(caseDigests);
  if (new Set(values).size !== values.length)
    throw new Error("Judge case input closures must be digest-disjoint");
}

export function buildJudgeFreezeReceipt(input: {
  readonly judgeContract: unknown;
  readonly developmentSet: unknown;
  readonly lockedAdmissionSet: unknown;
  readonly lockedBiasSet: unknown;
  readonly frozenAt: string;
}): JudgeFreezeReceipt {
  const { kind, contract } = parseContract(input.judgeContract);
  const development = assertSet(input.developmentSet, kind, "development");
  const admission = assertSet(input.lockedAdmissionSet, kind, "locked_admission");
  const bias = assertSet(input.lockedBiasSet, kind, "locked_bias");
  assertDisjoint([development, admission, bias]);
  return parseJudgeFreezeReceipt({
    schema_version: 1,
    judge_kind: kind,
    judge_definition_sha256: judgeDefinitionDigest(contract),
    rubric_sha256: canonicalJsonDigest(contract),
    prompt_sha256: contract.prompt_sha256,
    model_route_sha256: canonicalJsonDigest(contract.model_route),
    output_schema_sha256: contract.output_schema_sha256,
    development_set_sha256: canonicalJsonDigest(development),
    locked_admission_inputs_sha256: canonicalJsonDigest(admission),
    locked_bias_inputs_sha256: canonicalJsonDigest(bias),
    frozen_at: input.frozenAt,
  });
}

export function buildJudgeExecutionManifest(input: {
  readonly freezeReceipt: unknown;
  readonly judgeContract: unknown;
  readonly inputSet: unknown;
  readonly createdAt: string;
}): JudgeExecutionManifest {
  const freeze = parseJudgeFreezeReceipt(input.freezeReceipt);
  const { kind, contract } = parseContract(input.judgeContract);
  const set = parseJudgeCaseInputSet(input.inputSet);
  if (
    kind !== freeze.judge_kind ||
    set.judge_kind !== kind ||
    (set.set_kind !== "locked_admission" && set.set_kind !== "locked_bias") ||
    freeze.judge_definition_sha256 !== judgeDefinitionDigest(contract)
  ) {
    throw new Error("Judge execution manifest identity mismatch");
  }
  const expectedSetDigest =
    set.set_kind === "locked_admission"
      ? freeze.locked_admission_inputs_sha256
      : freeze.locked_bias_inputs_sha256;
  if (canonicalJsonDigest(set) !== expectedSetDigest)
    throw new Error("Judge execution input set drifted");
  if (Date.parse(input.createdAt) <= Date.parse(freeze.frozen_at)) {
    throw new Error("Judge execution manifest must be created after FreezeReceipt");
  }
  return parseJudgeExecutionManifest({
    schema_version: 1,
    judge_kind: kind,
    set_kind: set.set_kind,
    freeze_receipt_sha256: canonicalJsonDigest(freeze),
    judge_definition_sha256: judgeDefinitionDigest(contract),
    input_set_sha256: canonicalJsonDigest(set),
    repeats_per_case: 3,
    created_at: input.createdAt,
  });
}

function assertLabels(value: unknown, set: JudgeCaseInputSet): JudgeLabelSet {
  const labels = parseJudgeLabelSet(value);
  if (
    labels.judge_kind !== set.judge_kind ||
    labels.set_kind !== set.set_kind ||
    labels.input_set_sha256 !== canonicalJsonDigest(set) ||
    canonicalJson(labels.labels.map((label) => label.case_id)) !==
      canonicalJson(set.cases.map((entry) => entry.case_id))
  ) {
    throw new Error("Judge labels do not bind their complete input set");
  }
  return labels;
}

export function buildJudgeLabelsUnsealReceipt(input: {
  readonly freezeReceipt: unknown;
  readonly admissionExecution: unknown;
  readonly biasExecution: unknown;
  readonly admissionLabels: unknown;
  readonly biasLabels: unknown;
  readonly unsealedAt: string;
}): JudgeLabelsUnsealReceipt {
  const freeze = parseJudgeFreezeReceipt(input.freezeReceipt);
  const admissionExecution = parseJudgeExecutionManifest(input.admissionExecution);
  const biasExecution = parseJudgeExecutionManifest(input.biasExecution);
  if (
    admissionExecution.set_kind !== "locked_admission" ||
    biasExecution.set_kind !== "locked_bias" ||
    admissionExecution.judge_kind !== freeze.judge_kind ||
    biasExecution.judge_kind !== freeze.judge_kind ||
    admissionExecution.freeze_receipt_sha256 !== canonicalJsonDigest(freeze) ||
    biasExecution.freeze_receipt_sha256 !== canonicalJsonDigest(freeze)
  ) {
    throw new Error("Judge label unseal execution closure mismatch");
  }
  const admissionLabels = parseJudgeLabelSet(input.admissionLabels);
  const biasLabels = parseJudgeLabelSet(input.biasLabels);
  if (
    admissionLabels.judge_kind !== freeze.judge_kind ||
    biasLabels.judge_kind !== freeze.judge_kind ||
    admissionLabels.input_set_sha256 !== admissionExecution.input_set_sha256 ||
    biasLabels.input_set_sha256 !== biasExecution.input_set_sha256 ||
    admissionLabels.set_kind !== "locked_admission" ||
    biasLabels.set_kind !== "locked_bias"
  ) {
    throw new Error("Judge label unseal set mismatch");
  }
  const latestExecution = Math.max(
    Date.parse(admissionExecution.created_at),
    Date.parse(biasExecution.created_at),
  );
  if (Date.parse(input.unsealedAt) <= latestExecution) {
    throw new Error("Judge labels must unseal after execution manifests are frozen");
  }
  return parseJudgeLabelsUnsealReceipt({
    schema_version: 1,
    judge_kind: freeze.judge_kind,
    freeze_receipt_sha256: canonicalJsonDigest(freeze),
    locked_admission_execution_sha256: canonicalJsonDigest(admissionExecution),
    locked_bias_execution_sha256: canonicalJsonDigest(biasExecution),
    locked_admission_labels_sha256: canonicalJsonDigest(admissionLabels),
    locked_bias_labels_sha256: canonicalJsonDigest(biasLabels),
    unsealed_at: input.unsealedAt,
  });
}

interface DecisionDimension {
  readonly dimension_id: string;
  readonly applicability: string;
  readonly verdict: string;
  readonly severity: string;
  readonly matched_condition_ids: readonly string[];
  readonly abstention_reason: string | null;
}

function decisionProjection(dimension: DecisionDimension) {
  return {
    dimension_id: dimension.dimension_id,
    applicability: dimension.applicability,
    verdict: dimension.verdict,
    severity: dimension.severity,
    matched_condition_ids: dimension.matched_condition_ids,
    abstention_reason: dimension.abstention_reason,
  };
}

function distinctPointers(pointers: PointerTuple, caseId: string): void {
  if (new Set(pointers.map((pointer) => canonicalJson(pointer))).size !== pointers.length) {
    throw new Error(`Judge repeats must use independent receipts: ${caseId}`);
  }
}

function isUnstable(dimensions: readonly ReturnType<typeof decisionProjection>[]): boolean {
  return dimensions.some((dimension) => dimension.abstention_reason === "unstable_across_repeats");
}

function aggregate(kind: JudgeKind, contract: JudgeContract, runs: RunTuple) {
  return kind === "semantic"
    ? aggregateSemanticJudgeRuns(contract, runs)
    : aggregateCodeQualityJudgeRuns(contract, runs);
}

export function buildJudgeAdmission(input: {
  readonly judgeContract: unknown;
  readonly freezeReceipt: unknown;
  readonly admissionExecution: unknown;
  readonly biasExecution: unknown;
  readonly admissionSet: unknown;
  readonly biasSet: unknown;
  readonly admissionLabels: unknown;
  readonly biasLabels: unknown;
  readonly labelsUnsealReceipt: unknown;
  readonly admissionRuns: Readonly<Record<string, RunTuple>>;
  readonly biasRuns: Readonly<Record<string, RunTuple>>;
  readonly admissionRunReceipts: Readonly<Record<string, PointerTuple>>;
  readonly biasRunReceipts: Readonly<Record<string, PointerTuple>>;
}): JudgeAdmission {
  const { kind, contract } = parseContract(input.judgeContract);
  const freeze = parseJudgeFreezeReceipt(input.freezeReceipt);
  const admissionExecution = parseJudgeExecutionManifest(input.admissionExecution);
  const biasExecution = parseJudgeExecutionManifest(input.biasExecution);
  const admissionSet = assertSet(input.admissionSet, kind, "locked_admission");
  const biasSet = assertSet(input.biasSet, kind, "locked_bias");
  const admissionLabels = assertLabels(input.admissionLabels, admissionSet);
  const biasLabels = assertLabels(input.biasLabels, biasSet);
  const unseal = parseJudgeLabelsUnsealReceipt(input.labelsUnsealReceipt);
  if (
    freeze.judge_kind !== kind ||
    freeze.judge_definition_sha256 !== judgeDefinitionDigest(contract) ||
    admissionExecution.input_set_sha256 !== canonicalJsonDigest(admissionSet) ||
    biasExecution.input_set_sha256 !== canonicalJsonDigest(biasSet) ||
    unseal.freeze_receipt_sha256 !== canonicalJsonDigest(freeze) ||
    unseal.locked_admission_execution_sha256 !== canonicalJsonDigest(admissionExecution) ||
    unseal.locked_bias_execution_sha256 !== canonicalJsonDigest(biasExecution) ||
    unseal.locked_admission_labels_sha256 !== canonicalJsonDigest(admissionLabels) ||
    unseal.locked_bias_labels_sha256 !== canonicalJsonDigest(biasLabels)
  ) {
    throw new Error("Judge Admission closure drifted");
  }

  const admissionExpected = new Map(admissionLabels.labels.map((label) => [label.case_id, label]));
  const biasExpected = new Map(biasLabels.labels.map((label) => [label.case_id, label]));
  const admissionCanonicalExpected = new Map(
    admissionLabels.labels.map((label) => [label.case_id, label.expected_dimensions]),
  );
  const allReceipts: Phase3cArtifactPointer[] = [];
  const caseResults = admissionSet.cases.map((entry) => {
    const runs = input.admissionRuns[entry.case_id];
    const receipts = input.admissionRunReceipts[entry.case_id];
    const expected = admissionExpected.get(entry.case_id);
    if (runs === undefined || receipts === undefined || expected === undefined) {
      throw new Error(`Judge Admission case evidence is missing: ${entry.case_id}`);
    }
    distinctPointers(receipts, entry.case_id);
    const result = aggregate(kind, contract, runs);
    const observed = result.dimensions.map(decisionProjection);
    const match =
      !isUnstable(observed) &&
      canonicalJson(observed) === canonicalJson(expected.expected_dimensions)
        ? "pass"
        : "fail";
    allReceipts.push(...receipts);
    return {
      case_id: entry.case_id,
      repeat_results: receipts,
      observed_dimensions: observed,
      expected_dimensions_sha256: canonicalJsonDigest(expected.expected_dimensions),
      match,
    } as const;
  });
  const biasResults = biasSet.cases.map((entry) => {
    const runs = input.biasRuns[entry.case_id];
    const receipts = input.biasRunReceipts[entry.case_id];
    const expected = biasExpected.get(entry.case_id);
    if (entry.canonical_case_id === null || entry.transform_id === null) {
      throw new Error(`Judge bias case transform identity is missing: ${entry.case_id}`);
    }
    const canonicalCaseId = entry.canonical_case_id;
    const transformId = entry.transform_id;
    const canonicalExpected = admissionCanonicalExpected.get(canonicalCaseId);
    if (
      runs === undefined ||
      receipts === undefined ||
      expected === undefined ||
      canonicalExpected === undefined
    ) {
      throw new Error(`Judge bias case evidence is missing: ${entry.case_id}`);
    }
    distinctPointers(receipts, entry.case_id);
    const result = aggregate(kind, contract, runs);
    const observed = result.dimensions.map(decisionProjection);
    const exactExpected =
      canonicalJson(expected.expected_dimensions) === canonicalJson(canonicalExpected);
    const match =
      exactExpected &&
      !isUnstable(observed) &&
      canonicalJson(observed) === canonicalJson(canonicalExpected)
        ? "pass"
        : "fail";
    allReceipts.push(...receipts);
    return {
      case_id: entry.case_id,
      canonical_case_id: canonicalCaseId,
      transform_id: transformId,
      repeat_results: receipts,
      observed_dimensions: observed,
      expected_dimensions_sha256: canonicalJsonDigest(canonicalExpected),
      match,
    } as const;
  });
  if (new Set(allReceipts.map((receipt) => canonicalJson(receipt))).size !== allReceipts.length) {
    throw new Error("Judge Admission reuses one run receipt across cases");
  }
  return parseJudgeAdmission({
    schema_version: 1,
    judge_kind: kind,
    judge_definition_sha256: judgeDefinitionDigest(contract),
    freeze_receipt_sha256: canonicalJsonDigest(freeze),
    locked_admission_execution_sha256: canonicalJsonDigest(admissionExecution),
    locked_bias_execution_sha256: canonicalJsonDigest(biasExecution),
    locked_admission_labels_sha256: canonicalJsonDigest(admissionLabels),
    locked_bias_labels_sha256: canonicalJsonDigest(biasLabels),
    labels_unseal_receipt_sha256: canonicalJsonDigest(unseal),
    run_receipts: allReceipts,
    case_results: caseResults,
    bias_results: biasResults,
    status: [...caseResults, ...biasResults].every((result) => result.match === "pass")
      ? "admitted"
      : "rejected",
  });
}
