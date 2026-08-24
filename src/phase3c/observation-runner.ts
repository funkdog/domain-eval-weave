import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type DeterministicObservationResult,
  type ObservationBoundaryAdmission,
  type ObservationBoundarySpec,
  type Phase3cArtifactPointer,
  parseDeterministicObservationResult,
  parseObservationBoundaryAdmission,
  parseObservationBoundarySpec,
} from "./contracts.js";
import {
  evaluateObservationExpression,
  type ObservationContext,
  validateObservationBoundary,
} from "./observation.js";

export interface ObservationExecutionEvidence {
  readonly context: ObservationContext;
  readonly normalFormRef: Phase3cArtifactPointer;
  readonly evidenceRefs: readonly Phase3cArtifactPointer[];
}

export interface ObservationExecutionFailureEvidence {
  readonly evidenceRefs: readonly Phase3cArtifactPointer[];
}

export interface ObservationExecutor {
  execute(
    binding: ObservationBoundarySpec["bindings"][number],
  ): Promise<ObservationExecutionEvidence>;
  captureFailure(
    binding: ObservationBoundarySpec["bindings"][number],
    error: unknown,
  ): Promise<ObservationExecutionFailureEvidence>;
}

export async function runDeterministicObservations(input: {
  readonly boundary: unknown;
  readonly authorityMap: unknown;
  readonly claimAxes: Readonly<Record<string, "requirement_delta" | "domain_preservation">>;
  readonly candidateArchive: Phase3cArtifactPointer;
  readonly candidateTreeSha256Before: string;
  readonly candidateTreeSha256After: () => Promise<string>;
  readonly seed: number;
  readonly executor: ObservationExecutor;
}): Promise<DeterministicObservationResult> {
  const { boundary } = validateObservationBoundary({
    boundary: input.boundary,
    authorityMap: input.authorityMap,
    claimAxes: input.claimAxes,
  });
  const observations: DeterministicObservationResult["observations"] = [];
  for (const binding of boundary.bindings) {
    try {
      const evidence = await input.executor.execute(binding);
      observations.push({
        observation_id: binding.observation_id,
        claim_id: binding.claim_id,
        axis: binding.axis,
        dimension_ids: binding.dimension_ids,
        status: evaluateObservationExpression(binding.expression, evidence.context)
          ? "pass"
          : "fail",
        normal_form_ref: evidence.normalFormRef,
        evidence_refs: [...evidence.evidenceRefs],
      });
    } catch (error) {
      const failure = await input.executor.captureFailure(binding, error);
      observations.push({
        observation_id: binding.observation_id,
        claim_id: binding.claim_id,
        axis: binding.axis,
        dimension_ids: binding.dimension_ids,
        status: "error",
        normal_form_ref: null,
        evidence_refs: [...failure.evidenceRefs],
      });
    }
  }
  const candidateTreeSha256After = await input.candidateTreeSha256After();
  return parseDeterministicObservationResult({
    schema_version: 3,
    template_id: "commerce-order-cancellation-v3",
    boundary_sha256: canonicalJsonDigest(boundary),
    candidate_archive: input.candidateArchive,
    candidate_tree_sha256_before: input.candidateTreeSha256Before,
    candidate_tree_sha256_after: candidateTreeSha256After,
    seed: input.seed,
    observations,
    measurement_validity:
      input.candidateTreeSha256Before === candidateTreeSha256After &&
      observations.every((entry) => entry.status !== "error")
        ? "valid"
        : "invalid",
  });
}

export interface ObservationCalibrationCaseInput {
  readonly caseId: string;
  readonly caseKind: "gold" | "equivalent" | "mutant" | "relaxation_mutant";
  readonly candidateArchive: Phase3cArtifactPointer;
  readonly expectedFailedObservationIds: readonly string[];
  readonly result: unknown;
  readonly resultPointer: Phase3cArtifactPointer;
}

function canonicalIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function buildObservationBoundaryAdmission(input: {
  readonly boundary: unknown;
  readonly taskPackSha256: string;
  readonly seed: number;
  readonly cases: readonly ObservationCalibrationCaseInput[];
}): ObservationBoundaryAdmission {
  const boundary = parseObservationBoundarySpec(input.boundary);
  const cases = input.cases.map((entry) => {
    const result = parseDeterministicObservationResult(entry.result);
    if (
      result.boundary_sha256 !== canonicalJsonDigest(boundary) ||
      canonicalJson(result.candidate_archive) !== canonicalJson(entry.candidateArchive) ||
      result.seed !== input.seed ||
      result.measurement_validity !== "valid" ||
      entry.resultPointer.sha256 !== canonicalJsonDigest(result)
    ) {
      throw new Error(`Observation calibration case closure drifted: ${entry.caseId}`);
    }
    const expected = canonicalIds(entry.expectedFailedObservationIds);
    const observed = canonicalIds(
      result.observations
        .filter((observation) => observation.status === "fail")
        .map((observation) => observation.observation_id),
    );
    return {
      case_id: entry.caseId,
      case_kind: entry.caseKind,
      candidate_archive: entry.candidateArchive,
      expected_failed_observation_ids: expected,
      observed_failed_observation_ids: observed,
      deterministic_result: entry.resultPointer,
      match:
        canonicalJson(expected) === canonicalJson(observed) ? ("pass" as const) : ("fail" as const),
    };
  });
  const falseRejectCaseIds = cases
    .filter(
      (entry) =>
        (entry.case_kind === "gold" || entry.case_kind === "equivalent") && entry.match === "fail",
    )
    .map((entry) => entry.case_id);
  const falseAcceptCaseIds = cases
    .filter(
      (entry) =>
        (entry.case_kind === "mutant" || entry.case_kind === "relaxation_mutant") &&
        entry.match === "fail",
    )
    .map((entry) => entry.case_id);
  return parseObservationBoundaryAdmission({
    schema_version: 1,
    boundary_sha256: canonicalJsonDigest(boundary),
    task_pack_sha256: input.taskPackSha256,
    runner_sha256: boundary.runner_sha256,
    seed: input.seed,
    cases,
    false_reject_case_ids: falseRejectCaseIds,
    false_accept_case_ids: falseAcceptCaseIds,
    status:
      falseRejectCaseIds.length === 0 && falseAcceptCaseIds.length === 0 ? "admitted" : "rejected",
  });
}
