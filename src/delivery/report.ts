import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import { parsePairedEvaluationArtifact, parsePairedImpactReport } from "../contracts/parsers.js";
import { type BehaviorStatus, LEDGER_BEHAVIORS } from "../oracle/ledger.js";
import {
  type ClaimIr,
  type DeliveryEvaluationReport,
  parseClaimIr,
  parseDeliveryEvaluationReport,
  parseGraderAdmission,
  parseOraclePlan,
} from "./contracts.js";

function deterministicStatus(statuses: readonly BehaviorStatus[]): BehaviorStatus {
  return statuses.includes("error") ? "error" : statuses.includes("fail") ? "fail" : "pass";
}

function pointerDigest(
  value: unknown,
  pointer: { readonly ref: string; readonly sha256: string },
  label: string,
): void {
  if (canonicalJsonDigest(value) !== pointer.sha256) {
    throw new Error(`${label} pointer digest does not match persisted bytes`);
  }
}

function claimAxis(
  claimIr: ClaimIr,
  axis: "requirement_delta" | "domain_preservation",
  behavior: Readonly<Record<string, BehaviorStatus>>,
  evidenceRef: string,
) {
  const claims = claimIr.claims
    .filter((claim) => claim.axis === axis)
    .map((claim) => {
      const behaviors = claim.observation_bindings.map((binding) => ({
        behavior_id: binding.behavior_id,
        status: behavior[binding.behavior_id] ?? "error",
        evidence_ref: evidenceRef,
      }));
      return {
        claim_id: claim.claim_id,
        status: deterministicStatus(behaviors.map((entry) => entry.status)),
        behaviors,
      };
    });
  if (claims.length === 0) {
    throw new Error(`bounded Phase 3B report requires at least one ${axis} Claim`);
  }
  return {
    status: deterministicStatus(claims.map((claim) => claim.status)),
    claims,
  };
}

export function buildDeliveryEvaluationReport(input: {
  readonly evaluationId: string;
  readonly claimIr: unknown;
  readonly oraclePlan: unknown;
  readonly admission: unknown;
  readonly pairedEvaluation: unknown;
  readonly pairedReport: unknown;
  readonly pairedEvaluationPointer: { readonly ref: string; readonly sha256: string };
  readonly pairedReportPointer: { readonly ref: string; readonly sha256: string };
}): DeliveryEvaluationReport {
  const claimIr = parseClaimIr(input.claimIr);
  const oraclePlan = parseOraclePlan(input.oraclePlan);
  const admission = parseGraderAdmission(input.admission);
  const pairedEvaluation = parsePairedEvaluationArtifact(input.pairedEvaluation);
  const pairedReport = parsePairedImpactReport(input.pairedReport);
  if (oraclePlan.claim_ir_sha256 !== canonicalJsonDigest(claimIr)) {
    throw new Error("Oracle Plan does not bind the supplied Claim IR");
  }
  if (
    admission.oracle_plan_sha256 !== canonicalJsonDigest(oraclePlan) ||
    admission.task_pack_sha256 !== oraclePlan.task_pack_sha256 ||
    admission.observation_catalog_sha256 !== oraclePlan.observation_catalog_sha256
  ) {
    throw new Error("Grader Admission does not bind the supplied Oracle Plan");
  }
  pointerDigest(pairedEvaluation, input.pairedEvaluationPointer, "paired evaluation");
  pointerDigest(pairedReport, input.pairedReportPointer, "paired report");
  if (
    pairedEvaluation.campaign_id !== pairedReport.campaign_id ||
    canonicalJson(pairedEvaluation.measurement_validity) !==
      canonicalJson(pairedReport.measurement_validity)
  ) {
    throw new Error("paired Campaign evaluation and report identity drifted");
  }
  const treatmentBehavior = pairedEvaluation.arms.treatment.result.outcome.behavior_vector;
  const controlBehavior = pairedEvaluation.arms.control.result.outcome.behavior_vector;
  const evidenceRef = pairedEvaluation.arms.treatment.oracle.ref;
  const requirementDelta = claimAxis(claimIr, "requirement_delta", treatmentBehavior, evidenceRef);
  const domainPreservation = claimAxis(
    claimIr,
    "domain_preservation",
    treatmentBehavior,
    evidenceRef,
  );
  const measurementReasonCodes = pairedEvaluation.measurement_validity.reasons.map(
    (reason) => reason.code,
  );
  const measurementStatus =
    admission.status === "admitted" ? pairedEvaluation.measurement_validity.overall : "invalid";
  if (admission.status !== "admitted") measurementReasonCodes.push("GRADER_NOT_ADMITTED");
  const changedBehaviors = LEDGER_BEHAVIORS.filter(
    (behavior) => controlBehavior[behavior] !== treatmentBehavior[behavior],
  );
  const semanticResidual = {
    status: claimIr.semantic_residual.length === 0 ? "not_required" : "not_evaluated",
    claims: claimIr.semantic_residual,
  } as const;
  const harnessStatus = pairedEvaluation.measurement_validity.overall;
  const verdict =
    measurementStatus !== "valid" ||
    harnessStatus !== "valid" ||
    semanticResidual.status !== "not_required" ||
    requirementDelta.status === "error" ||
    domainPreservation.status === "error"
      ? "inconclusive"
      : requirementDelta.status === "fail" || domainPreservation.status === "fail"
        ? "reject"
        : "accept";
  const traceability = {
    claim_to_behaviors: Object.fromEntries(
      [...requirementDelta.claims, ...domainPreservation.claims].map((claim) => [
        claim.claim_id,
        claim.behaviors.map((behavior) => behavior.behavior_id),
      ]),
    ),
    behavior_to_claims: Object.fromEntries(
      LEDGER_BEHAVIORS.map((behavior) => [
        behavior,
        [...requirementDelta.claims, ...domainPreservation.claims]
          .filter((claim) => claim.behaviors.some((result) => result.behavior_id === behavior))
          .map((claim) => claim.claim_id),
      ]),
    ),
  };
  return parseDeliveryEvaluationReport({
    schema_version: 1,
    evaluation_id: input.evaluationId,
    source: {
      domain_manifest_sha256: claimIr.source.domain_manifest.sha256,
      requirement_sha256: claimIr.source.requirement.sha256,
      claim_ir_sha256: canonicalJsonDigest(claimIr),
      oracle_plan_sha256: canonicalJsonDigest(oraclePlan),
      grader_admission_sha256: canonicalJsonDigest(admission),
      campaign_id: pairedEvaluation.campaign_id,
      paired_evaluation: input.pairedEvaluationPointer,
      paired_report: input.pairedReportPointer,
    },
    verdict,
    axes: {
      requirement_delta: requirementDelta,
      domain_preservation: domainPreservation,
      semantic_residual: semanticResidual,
      measurement_validity: {
        status: measurementStatus,
        reason_codes: [...new Set(measurementReasonCodes)],
      },
      harness_impact: {
        status: harnessStatus,
        changed_behaviors: changedBehaviors,
        cost_delta: pairedReport.cost_delta,
      },
    },
    traceability,
  });
}
