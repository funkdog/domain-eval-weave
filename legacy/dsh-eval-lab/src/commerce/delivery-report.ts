import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import type { CommerceBehaviorVector } from "../oracle/commerce-order.js";
import { COMMERCE_BEHAVIORS } from "../oracle/commerce-order.js";
import type { CommercePairedEvaluation, CommercePairedImpactReport } from "./campaign-contracts.js";
import {
  parseCommercePairedEvaluation,
  parseCommercePairedImpactReport,
} from "./campaign-contracts.js";
import { replayCommerceOraclePlan } from "./compiler.js";
import {
  type CommerceClaimIr,
  type CommerceDeliveryReport,
  parseCommerceClaimIr,
  parseCommerceDeliveryReport,
  parseCommerceGraderAdmission,
} from "./delivery-contracts.js";

function status(values: readonly ("pass" | "fail" | "error")[]): "pass" | "fail" | "error" {
  return values.includes("error") ? "error" : values.includes("fail") ? "fail" : "pass";
}

function pointerDigest(
  value: unknown,
  pointer: { readonly ref: string; readonly sha256: string },
  label: string,
) {
  if (canonicalJsonDigest(value) !== pointer.sha256) {
    throw new Error(`${label} pointer digest does not match persisted bytes`);
  }
}

function axisProjection(
  claimIr: CommerceClaimIr,
  axis: "requirement_delta" | "domain_preservation",
  behavior: CommerceBehaviorVector,
  evidenceRef: string,
) {
  const claims = claimIr.claims
    .filter((claim) => claim.axis === axis)
    .map((claim) => {
      const behaviors = claim.observation_bindings.map((binding) => {
        const behaviorStatus: "pass" | "fail" | "error" = behavior[binding.behavior_id];
        return {
          behavior_id: binding.behavior_id,
          status: behaviorStatus,
          evidence_ref: evidenceRef,
        };
      });
      return {
        claim_id: claim.claim_id,
        status: status(behaviors.map((entry) => entry.status)),
        behaviors,
      };
    });
  if (claims.length === 0) throw new Error(`Commerce report requires one ${axis} Claim`);
  return { status: status(claims.map((claim) => claim.status)), claims };
}

export function buildCommerceDeliveryReport(input: {
  readonly evaluationId: string;
  readonly claimIr: unknown;
  readonly oraclePlan: unknown;
  readonly catalog: unknown;
  readonly admission: unknown;
  readonly pairedEvaluation: unknown;
  readonly pairedReport: unknown;
  readonly pairedEvaluationPointer: { readonly ref: string; readonly sha256: string };
  readonly pairedReportPointer: { readonly ref: string; readonly sha256: string };
}): CommerceDeliveryReport {
  const claimIr = parseCommerceClaimIr(input.claimIr);
  const plan = replayCommerceOraclePlan({
    claimIr,
    oraclePlan: input.oraclePlan,
    catalog: input.catalog,
  });
  const admission = parseCommerceGraderAdmission(input.admission);
  const pairedEvaluation: CommercePairedEvaluation = parseCommercePairedEvaluation(
    input.pairedEvaluation,
  );
  const pairedReport: CommercePairedImpactReport = parseCommercePairedImpactReport(
    input.pairedReport,
  );
  if (
    admission.oracle_plan_sha256 !== canonicalJsonDigest(plan) ||
    admission.task_pack_sha256 !== plan.task_pack_sha256 ||
    admission.observation_catalog_sha256 !== plan.observation_catalog_sha256
  ) {
    throw new Error("Commerce Admission does not bind the Oracle Plan");
  }
  pointerDigest(pairedEvaluation, input.pairedEvaluationPointer, "Commerce paired evaluation");
  pointerDigest(pairedReport, input.pairedReportPointer, "Commerce paired report");
  if (
    pairedEvaluation.campaign_id !== pairedReport.campaign_id ||
    canonicalJson(pairedReport.evidence.evaluation) !==
      canonicalJson(input.pairedEvaluationPointer) ||
    canonicalJson(pairedReport.arms) !==
      canonicalJson({
        control: pairedEvaluation.arms.control.result,
        treatment: pairedEvaluation.arms.treatment.result,
      }) ||
    canonicalJson(pairedEvaluation.measurement_validity) !==
      canonicalJson(pairedReport.measurement_validity)
  ) {
    throw new Error("Commerce Campaign evaluation and report semantic identity drifted");
  }
  const treatment = pairedEvaluation.arms.treatment.result.outcome.behavior_vector;
  const control = pairedEvaluation.arms.control.result.outcome.behavior_vector;
  const evidenceRef = pairedEvaluation.arms.treatment.oracle.ref;
  const requirementDelta = axisProjection(claimIr, "requirement_delta", treatment, evidenceRef);
  const domainPreservation = axisProjection(claimIr, "domain_preservation", treatment, evidenceRef);
  const reasonCodes = pairedEvaluation.measurement_validity.reasons.map((reason) => reason.code);
  const measurementStatus =
    admission.status === "admitted" ? pairedEvaluation.measurement_validity.overall : "invalid";
  if (admission.status !== "admitted") reasonCodes.push("COMMERCE_GRADER_NOT_ADMITTED");
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
  const claims = [...requirementDelta.claims, ...domainPreservation.claims];
  return parseCommerceDeliveryReport({
    schema_version: 2,
    template_id: "commerce-order-cancellation-v1",
    evaluation_id: input.evaluationId,
    source: {
      domain_manifest_sha256: claimIr.source.domain_manifest.sha256,
      requirement_sha256: claimIr.source.requirement.sha256,
      claim_ir_sha256: canonicalJsonDigest(claimIr),
      oracle_plan_sha256: canonicalJsonDigest(plan),
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
        reason_codes: [...new Set(reasonCodes)],
      },
      harness_impact: {
        status: harnessStatus,
        changed_behaviors: COMMERCE_BEHAVIORS.filter(
          (behavior) => control[behavior] !== treatment[behavior],
        ),
        cost_delta: pairedReport.cost_delta,
      },
    },
    traceability: {
      claim_to_behaviors: Object.fromEntries(
        claims.map((claim) => [
          claim.claim_id,
          claim.behaviors.map((behavior) => behavior.behavior_id),
        ]),
      ),
      behavior_to_claims: Object.fromEntries(
        COMMERCE_BEHAVIORS.map((behavior) => [
          behavior,
          claims
            .filter((claim) => claim.behaviors.some((result) => result.behavior_id === behavior))
            .map((claim) => claim.claim_id),
        ]),
      ),
    },
  });
}
