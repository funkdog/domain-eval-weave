import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type CodeQualityJudgeResult,
  type CodeQualityJudgeRunResult,
  type Phase3cArtifactPointer,
  parseCodeQualityJudgeContract,
  parseCodeQualityJudgeResult,
  parseCodeQualityJudgeRunResult,
  parseSemanticJudgeContract,
  parseSemanticJudgeResult,
  parseSemanticJudgeRunResult,
  type SemanticJudgeResult,
  type SemanticJudgeRunResult,
} from "./contracts.js";

function uniqueEvidence<T extends { readonly source_ref: string; readonly locator: string }>(
  values: readonly (readonly T[])[],
): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of values.flat()) {
    const key = canonicalJson(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function dimensionDecision(dimension: {
  readonly applicability: string;
  readonly verdict: string;
  readonly severity: string;
  readonly matched_condition_ids: readonly string[];
  readonly abstention_reason: string | null;
}): string {
  return canonicalJson({
    applicability: dimension.applicability,
    verdict: dimension.verdict,
    severity: dimension.severity,
    matched_condition_ids: dimension.matched_condition_ids,
    abstention_reason: dimension.abstention_reason,
  });
}

function validateCommonDimension(dimension: {
  readonly applicability: "applicable" | "not_applicable";
  readonly verdict: "pass" | "fail" | "abstain";
  readonly severity: "blocking" | "concern" | "none";
  readonly evidence: readonly unknown[];
  readonly abstention_reason: string | null;
}): void {
  if ((dimension.verdict === "abstain") !== (dimension.abstention_reason !== null)) {
    throw new Error("Judge abstention reason does not match verdict");
  }
  if (dimension.verdict !== "abstain" && dimension.evidence.length === 0) {
    throw new Error("Judge decision requires evidence");
  }
  if (dimension.applicability === "not_applicable") {
    if (
      dimension.verdict !== "abstain" ||
      dimension.abstention_reason !== "rubric_not_applicable"
    ) {
      throw new Error("Not-applicable Judge dimension must abstain with rubric_not_applicable");
    }
  }
}

export function validateSemanticJudgeRun(
  contractInput: unknown,
  runInput: unknown,
): SemanticJudgeRunResult {
  const contract = parseSemanticJudgeContract(contractInput);
  const run = parseSemanticJudgeRunResult(runInput);
  if (run.judge_contract_sha256 !== canonicalJsonDigest(contract)) {
    throw new Error("Semantic Judge contract digest mismatch");
  }
  if (run.protocol_status !== "valid") throw new Error("Semantic Judge protocol is invalid");
  if (
    canonicalJson(run.dimensions.map((dimension) => dimension.dimension_id)) !==
    canonicalJson(contract.dimensions.map((dimension) => dimension.dimension_id))
  ) {
    throw new Error("Semantic Judge dimensions do not match contract");
  }
  for (const [index, dimension] of run.dimensions.entries()) {
    const rule = contract.dimensions[index];
    if (rule === undefined) throw new Error("Semantic Judge rule is missing");
    validateCommonDimension(dimension);
    if (dimension.matched_condition_ids.length !== 0) {
      throw new Error("Semantic Judge cannot cite Code Quality conditions");
    }
    if (rule.applicability === "required" && dimension.applicability !== "applicable") {
      throw new Error("Required Semantic dimension cannot be not applicable");
    }
    const severity =
      dimension.verdict === "fail" ? (rule.blocking ? "blocking" : "concern") : "none";
    if (dimension.severity !== severity)
      throw new Error("Semantic Judge severity disagrees with contract");
  }
  return run;
}

export function validateCodeQualityJudgeRun(
  contractInput: unknown,
  runInput: unknown,
): CodeQualityJudgeRunResult {
  const contract = parseCodeQualityJudgeContract(contractInput);
  const run = parseCodeQualityJudgeRunResult(runInput);
  if (run.rubric_sha256 !== canonicalJsonDigest(contract)) {
    throw new Error("Code Quality rubric digest mismatch");
  }
  if (run.protocol_status !== "valid") throw new Error("Code Quality Judge protocol is invalid");
  if (
    canonicalJson(run.dimensions.map((dimension) => dimension.dimension_id)) !==
    canonicalJson(contract.dimensions.map((dimension) => dimension.dimension_id))
  ) {
    throw new Error("Code Quality Judge dimensions do not match rubric");
  }
  for (const [index, dimension] of run.dimensions.entries()) {
    const rule = contract.dimensions[index];
    if (rule === undefined) throw new Error("Code Quality rule is missing");
    validateCommonDimension(dimension);
    if (rule.applicability === "required" && dimension.applicability !== "applicable") {
      throw new Error("Required Code Quality dimension cannot be not applicable");
    }
    const conditions = new Map(
      rule.conditions.map((condition) => [condition.condition_id, condition]),
    );
    const matched = dimension.matched_condition_ids.map((id) => {
      const condition = conditions.get(id);
      if (condition === undefined) throw new Error(`Unknown Code Quality condition: ${id}`);
      return condition;
    });
    if (dimension.verdict === "fail" && matched.length === 0) {
      throw new Error("Code Quality failure must cite a condition");
    }
    if (dimension.verdict !== "fail" && matched.length !== 0) {
      throw new Error("Only Code Quality failures may cite conditions");
    }
    const severity =
      dimension.verdict !== "fail"
        ? "none"
        : matched.some((condition) => condition.level === "blocking")
          ? "blocking"
          : "concern";
    if (dimension.severity !== severity)
      throw new Error("Code Quality severity disagrees with matched conditions");
  }
  return run;
}

function requireThree<T>(runs: readonly T[]): asserts runs is readonly [T, T, T] {
  if (runs.length !== 3)
    throw new Error("Judge evaluation requires exactly three independent runs");
}

function requiredAt<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) throw new Error(`${label} is missing at index ${index}`);
  return value;
}

export function aggregateSemanticJudgeRuns(
  contractInput: unknown,
  runInputs: readonly unknown[],
): SemanticJudgeRunResult {
  const contract = parseSemanticJudgeContract(contractInput);
  const runs = runInputs.map((run) => validateSemanticJudgeRun(contract, run));
  requireThree(runs);
  if (
    new Set(runs.map((run) => `${run.judge_contract_sha256}:${run.input_manifest_sha256}`)).size !==
    1
  ) {
    throw new Error("Semantic Judge repeats do not share one contract and input manifest");
  }
  const dimensions = contract.dimensions.map((rule, index) => {
    const repeated = runs.map((run) => requiredAt(run.dimensions, index, "Semantic dimension"));
    if (new Set(repeated.map(dimensionDecision)).size === 1) {
      return requiredAt(repeated, 0, "Semantic repeat");
    }
    return {
      dimension_id: rule.dimension_id,
      applicability: "applicable" as const,
      verdict: "abstain" as const,
      severity: "none" as const,
      matched_condition_ids: [],
      evidence: uniqueEvidence(repeated.map((dimension) => dimension.evidence)),
      rationale: "Independent Judge repeats disagreed.",
      counterevidence: null,
      abstention_reason: "unstable_across_repeats" as const,
    };
  });
  return parseSemanticJudgeRunResult({
    ...runs[0],
    dimensions,
  });
}

export function aggregateCodeQualityJudgeRuns(
  contractInput: unknown,
  runInputs: readonly unknown[],
): CodeQualityJudgeRunResult {
  const contract = parseCodeQualityJudgeContract(contractInput);
  const runs = runInputs.map((run) => validateCodeQualityJudgeRun(contract, run));
  requireThree(runs);
  if (new Set(runs.map((run) => `${run.rubric_sha256}:${run.input_manifest_sha256}`)).size !== 1) {
    throw new Error("Code Quality Judge repeats do not share one rubric and input manifest");
  }
  const dimensions = contract.dimensions.map((rule, index) => {
    const repeated = runs.map((run) => requiredAt(run.dimensions, index, "Code Quality dimension"));
    if (new Set(repeated.map(dimensionDecision)).size === 1) {
      return requiredAt(repeated, 0, "Code Quality repeat");
    }
    return {
      dimension_id: rule.dimension_id,
      applicability: "applicable" as const,
      verdict: "abstain" as const,
      severity: "none" as const,
      matched_condition_ids: [],
      evidence: uniqueEvidence(repeated.map((dimension) => dimension.evidence)),
      rationale: "Independent Judge repeats disagreed.",
      counterevidence: null,
      abstention_reason: "unstable_across_repeats" as const,
    };
  });
  return parseCodeQualityJudgeRunResult({
    ...runs[0],
    dimensions,
  });
}

type PointerTuple = readonly [
  Phase3cArtifactPointer,
  Phase3cArtifactPointer,
  Phase3cArtifactPointer,
];

export function buildSemanticJudgeResult(input: {
  readonly contract: unknown;
  readonly runs: readonly unknown[];
  readonly runReceipts: PointerTuple;
  readonly repeatResults: PointerTuple;
}): SemanticJudgeResult {
  const aggregated = aggregateSemanticJudgeRuns(input.contract, input.runs);
  return parseSemanticJudgeResult({
    ...aggregated,
    run_receipts: input.runReceipts,
    repeat_results: input.repeatResults,
  });
}

export function buildCodeQualityJudgeResult(input: {
  readonly contract: unknown;
  readonly runs: readonly unknown[];
  readonly runReceipts: PointerTuple;
  readonly repeatResults: PointerTuple;
}): CodeQualityJudgeResult {
  const aggregated = aggregateCodeQualityJudgeRuns(input.contract, input.runs);
  return parseCodeQualityJudgeResult({
    ...aggregated,
    run_receipts: input.runReceipts,
    repeat_results: input.repeatResults,
  });
}
