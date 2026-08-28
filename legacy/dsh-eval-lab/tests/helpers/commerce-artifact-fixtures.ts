import { readFileSync } from "node:fs";

import { buildCommerceGraderAdmission } from "../../src/commerce/admission.js";
import {
  parseCommerceExperiment,
  parseCommercePairedEvaluation,
  parseCommerceVariant,
} from "../../src/commerce/campaign-contracts.js";
import { buildCommercePairedImpactReport } from "../../src/commerce/campaign-report.js";
import { parseCommerceObservationCatalog } from "../../src/commerce/catalog.js";
import { rebuildCommerceOraclePlan } from "../../src/commerce/compiler.js";
import {
  parseCommerceClaimIr,
  parseCommerceDeliveryReport,
} from "../../src/commerce/delivery-contracts.js";
import { buildCommerceDeliveryReport } from "../../src/commerce/delivery-report.js";
import { parseArtifactRef } from "../../src/contracts/artifacts.js";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import type { CommerceCalibrationEvidence } from "../../src/oracle/commerce-calibration.js";
import {
  COMMERCE_BEHAVIORS,
  type CommerceBehavior,
  type CommerceBehaviorVector,
} from "../../src/oracle/commerce-order.js";
import { validControlVariant, validExperiment, validTreatmentVariant } from "./fixtures.js";

const digest = (character: string): string => character.repeat(64);
const artifactPointer = (ref: string, sha256: string) => ({ ref: parseArtifactRef(ref), sha256 });
const passVector = Object.fromEntries(
  COMMERCE_BEHAVIORS.map((behavior) => [behavior, "pass"]),
) as CommerceBehaviorVector;
const failVector = (failures: readonly CommerceBehavior[]) =>
  Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [behavior, failures.includes(behavior) ? "fail" : "pass"]),
  ) as CommerceBehaviorVector;

export const validCommerceCatalog = parseCommerceObservationCatalog(
  JSON.parse(
    readFileSync(
      new URL(
        "../../task-packs/open-coding-ts-commerce-order-v1/claim-observation-catalog.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

const catalogEntries = new Map(
  validCommerceCatalog.behaviors.map((entry) => [entry.behavior_id, entry]),
);
const requirementBehaviors = COMMERCE_BEHAVIORS.slice(0, 4);
const preservationBehaviors = COMMERCE_BEHAVIORS.slice(4);
const bindings = (behaviors: readonly CommerceBehavior[]) =>
  behaviors.map((behavior) => {
    const entry = catalogEntries.get(behavior);
    if (entry === undefined) throw new Error(`missing Commerce fixture behavior: ${behavior}`);
    return { behavior_id: behavior, entry_sha256: canonicalJsonDigest(entry) };
  });

export const validCommerceClaimIr = parseCommerceClaimIr({
  schema_version: 2,
  template_id: "commerce-order-cancellation-v1",
  compiler: { compiler_id: "phase3b1-commerce-compiler", compiler_version: 1 },
  source: {
    domain_manifest: { ref: "manifests/commerce-order-v1.json", sha256: digest("1") },
    contract: { ref: "contracts/commerce-order/v1.json", sha256: digest("2") },
    requirement: { ref: "requirements/self-service-cancellation/v1.json", sha256: digest("3") },
    task_pack_sha256: digest("4"),
    observation_catalog_sha256: canonicalJsonDigest(validCommerceCatalog),
  },
  requirement: {
    requirement_id: "self-service-order-cancellation",
    requirement_version: 1,
    product_id: "synthetic-commerce",
  },
  claims: [
    {
      claim_id: "commerce-cancellation-contract",
      contract_version: 1,
      domain_id: "commerce-order",
      effect: "uses",
      axis: "requirement_delta",
      statement_sha256: digest("5"),
      false_accept_risk: "critical",
      false_reject_risk: "medium",
      dependencies: [],
      observation_bindings: bindings(requirementBehaviors),
    },
    {
      claim_id: "commerce-state-integrity",
      contract_version: 1,
      domain_id: "commerce-order",
      effect: "preserves",
      axis: "domain_preservation",
      statement_sha256: digest("6"),
      false_accept_risk: "critical",
      false_reject_risk: "high",
      dependencies: [],
      observation_bindings: bindings(preservationBehaviors),
    },
  ],
  semantic_residual: [],
  traceability: {
    claim_to_behaviors: {
      "commerce-cancellation-contract": requirementBehaviors,
      "commerce-state-integrity": preservationBehaviors,
    },
    behavior_to_claims: Object.fromEntries(
      COMMERCE_BEHAVIORS.map((behavior) => [
        behavior,
        requirementBehaviors.includes(behavior)
          ? ["commerce-cancellation-contract"]
          : ["commerce-state-integrity"],
      ]),
    ),
  },
});

export const validCommerceOraclePlan = rebuildCommerceOraclePlan({
  claimIr: validCommerceClaimIr,
  catalog: validCommerceCatalog,
});

const calibration: CommerceCalibrationEvidence = {
  schema_version: 2,
  template_id: "commerce-order-cancellation-v1",
  vectors: {
    red: failVector(COMMERCE_BEHAVIORS),
    gold: passVector,
    "mutant-shipped-cancel": failVector(["shipped_order_requires_after_sales"]),
    "mutant-overrefund": failVector(["paid_unshipped_creates_paid_amount_refund"]),
    "mutant-double-effects": failVector([
      "inventory_release_is_exactly_once",
      "restart_recovery_preserves_idempotency_and_audit",
    ]),
    "mutant-coupon-always-restored": failVector(["coupon_restore_requires_current_eligibility"]),
    "mutant-no-ownership-or-persistence": failVector([
      "customer_ownership_is_enforced",
      "restart_recovery_preserves_idempotency_and_audit",
    ]),
    "gold-repeat": passVector,
    "gold-next-seed": passVector,
  },
};

export const validCommerceAdmission = buildCommerceGraderAdmission({
  oraclePlan: validCommerceOraclePlan,
  catalog: validCommerceCatalog,
  calibration,
  seed: 1729,
  evalPackageDigest: validControlVariant.eval_package_sha256,
});

export const validCommerceControlVariant = parseCommerceVariant({
  ...validControlVariant,
  schema_version: 2,
  template_id: "commerce-order-cancellation-v1",
});
export const validCommerceTreatmentVariant = parseCommerceVariant({
  ...validTreatmentVariant,
  schema_version: 2,
  template_id: "commerce-order-cancellation-v1",
});

export const validCommerceExperiment = parseCommerceExperiment({
  schema_version: 2,
  template_id: "commerce-order-cancellation-v1",
  campaign_id: "campaign-commerce-schema",
  created_at: "2026-08-21T00:00:00.000Z",
  domain: "open-coding-commerce-delivery",
  eval_pack_id: "open-coding-commerce-delivery-v1",
  task_pack_digest: validCommerceClaimIr.source.task_pack_sha256,
  control_variant_digest: canonicalJsonDigest(validCommerceControlVariant),
  treatment_variant_digest: canonicalJsonDigest(validCommerceTreatmentVariant),
  deployment: {
    digest: validExperiment.deployment.digest,
    eval_package_sha256: validControlVariant.eval_package_sha256,
    qualification: validExperiment.deployment.qualification,
    grader_admission_sha256: canonicalJsonDigest(validCommerceAdmission),
  },
  intervention: validExperiment.intervention,
  arm_order: ["control", "treatment"],
  timeout_ms_per_arm: 900_000,
  claim_strength: "diagnostic",
  effect_claim_eligible: false,
});

const validity = {
  overall: "valid" as const,
  dimensions: { outcome: "valid" as const, mechanism: "valid" as const, cost: "valid" as const },
  reasons: [],
};
const hardGates = {
  unauthorized_path_change: "pass" as const,
  oracle_hidden_from_candidate: "pass" as const,
  candidate_frozen_before_oracle: "pass" as const,
  candidate_unchanged_after_oracle: "pass" as const,
  deployment_fingerprint_match: "pass" as const,
  carrier_process_healthy: "pass" as const,
};
const result = (treatment: boolean) => ({
  schema_version: 2 as const,
  template_id: "commerce-order-cancellation-v1" as const,
  measurement_validity: validity,
  outcome: {
    externally_verified_completion: treatment,
    behavior_vector: treatment ? passVector : failVector(COMMERCE_BEHAVIORS),
    completion_claim: "complete" as const,
    false_completion_claim: !treatment,
  },
  mechanism: {
    goal_created: treatment,
    goal_rounds_started: treatment ? 1 : 0,
    goal_terminal_phase: treatment ? ("complete" as const) : ("none" as const),
    tool_calls: {},
    turns: 1,
    steps: 1,
  },
  cost: {
    elapsed_ms: treatment ? 65_000 : 60_000,
    input_tokens: treatment ? 110 : 100,
    cached_input_tokens: 10,
    output_tokens: treatment ? 25 : 20,
    failed_tool_calls: 0,
  },
  hard_gates: hardGates,
  claim_strength: "diagnostic" as const,
  effect_claim_eligible: false as const,
});

export const validCommercePairedEvaluation = parseCommercePairedEvaluation({
  schema_version: 2,
  template_id: "commerce-order-cancellation-v1",
  campaign_id: validCommerceExperiment.campaign_id,
  oracle_seed: { ref: "artifact://campaign/oracle/seed.json", sha256: digest("7") },
  measurement_validity: validity,
  arms: {
    control: {
      episode: { ref: "artifact://campaign/arms/control/episode.json", sha256: digest("8") },
      oracle: { ref: "artifact://campaign/oracle/control/behavior.json", sha256: digest("9") },
      candidate: {
        tree: "1".repeat(40),
        archive: { ref: "artifact://campaign/arms/control/candidate.tar", sha256: digest("a") },
      },
      result: result(false),
    },
    treatment: {
      episode: { ref: "artifact://campaign/arms/treatment/episode.json", sha256: digest("b") },
      oracle: { ref: "artifact://campaign/oracle/treatment/behavior.json", sha256: digest("c") },
      candidate: {
        tree: "2".repeat(40),
        archive: { ref: "artifact://campaign/arms/treatment/candidate.tar", sha256: digest("d") },
      },
      result: result(true),
    },
  },
});

export const validCommercePairedEvaluationPointer = {
  ref: parseArtifactRef("artifact://campaign/evaluation.json"),
  sha256: canonicalJsonDigest(validCommercePairedEvaluation),
};

export const validCommercePairedReport = buildCommercePairedImpactReport({
  experiment: validCommerceExperiment,
  experimentPointer: artifactPointer(
    "artifact://campaign/manifest.json",
    canonicalJsonDigest(validCommerceExperiment),
  ),
  pairedEvaluation: validCommercePairedEvaluation,
  evaluationPointer: validCommercePairedEvaluationPointer,
  controlEpisodePointer: artifactPointer(
    validCommercePairedEvaluation.arms.control.episode.ref,
    validCommercePairedEvaluation.arms.control.episode.sha256,
  ),
  treatmentEpisodePointer: artifactPointer(
    validCommercePairedEvaluation.arms.treatment.episode.ref,
    validCommercePairedEvaluation.arms.treatment.episode.sha256,
  ),
});

export const validCommerceDeliveryReport = parseCommerceDeliveryReport(
  buildCommerceDeliveryReport({
    evaluationId: "delivery-commerce-schema",
    claimIr: validCommerceClaimIr,
    oraclePlan: validCommerceOraclePlan,
    catalog: validCommerceCatalog,
    admission: validCommerceAdmission,
    pairedEvaluation: validCommercePairedEvaluation,
    pairedReport: validCommercePairedReport,
    pairedEvaluationPointer: validCommercePairedEvaluationPointer,
    pairedReportPointer: {
      ref: "artifact://campaign/report.json",
      sha256: canonicalJsonDigest(validCommercePairedReport),
    },
  }),
);
