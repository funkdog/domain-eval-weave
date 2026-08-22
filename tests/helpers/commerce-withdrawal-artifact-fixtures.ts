import { readFileSync } from "node:fs";

import { buildCommerceGraderAdmission } from "../../src/commerce-withdrawal/admission.js";
import {
  parseCommerceExperiment,
  parseCommercePairedEvaluation,
  parseCommerceVariant,
} from "../../src/commerce-withdrawal/campaign-contracts.js";
import { buildCommercePairedImpactReport } from "../../src/commerce-withdrawal/campaign-report.js";
import { parseCommerceObservationCatalog } from "../../src/commerce-withdrawal/catalog.js";
import { rebuildCommerceOraclePlan } from "../../src/commerce-withdrawal/compiler.js";
import {
  parseCommerceClaimIr,
  parseCommerceDeliveryReport,
} from "../../src/commerce-withdrawal/delivery-contracts.js";
import { buildCommerceDeliveryReport } from "../../src/commerce-withdrawal/delivery-report.js";
import { parseArtifactRef } from "../../src/contracts/artifacts.js";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import type { CommerceCalibrationEvidence } from "../../src/oracle/commerce-calibration-v2.js";
import {
  COMMERCE_BEHAVIORS,
  type CommerceBehavior,
  type CommerceBehaviorVector,
} from "../../src/oracle/commerce-order-v2.js";
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

export const validCommerceWithdrawalCatalog = parseCommerceObservationCatalog(
  JSON.parse(
    readFileSync(
      new URL(
        "../../task-packs/open-coding-ts-commerce-order-v2/claim-observation-catalog.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

const catalogEntries = new Map(
  validCommerceWithdrawalCatalog.behaviors.map((entry) => [entry.behavior_id, entry]),
);
const requirementBehaviors = COMMERCE_BEHAVIORS.slice(0, 8);
const preservationBehaviors = COMMERCE_BEHAVIORS.slice(8);
const bindings = (behaviors: readonly CommerceBehavior[]) =>
  behaviors.map((behavior) => {
    const entry = catalogEntries.get(behavior);
    if (entry === undefined)
      throw new Error(`missing Commerce withdrawal fixture behavior: ${behavior}`);
    return { behavior_id: behavior, entry_sha256: canonicalJsonDigest(entry) };
  });

export const validCommerceWithdrawalClaimIr = parseCommerceClaimIr({
  schema_version: 2,
  template_id: "commerce-order-cancellation-v2",
  compiler: { compiler_id: "phase3b2-commerce-compiler", compiler_version: 1 },
  source: {
    domain_manifest: { ref: "manifests/commerce-order-v1.json", sha256: digest("1") },
    contract: { ref: "contracts/commerce-order/v1.json", sha256: digest("2") },
    requirement: { ref: "requirements/self-service-cancellation/v1.json", sha256: digest("3") },
    task_pack_sha256: digest("4"),
    observation_catalog_sha256: canonicalJsonDigest(validCommerceWithdrawalCatalog),
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

export const validCommerceWithdrawalOraclePlan = rebuildCommerceOraclePlan({
  claimIr: validCommerceWithdrawalClaimIr,
  catalog: validCommerceWithdrawalCatalog,
});

const calibration: CommerceCalibrationEvidence = {
  schema_version: 2,
  template_id: "commerce-order-cancellation-v2",
  vectors: {
    red: failVector(COMMERCE_BEHAVIORS),
    gold: passVector,
    "mutant-handed-off-cancel": failVector(["handed_off_order_requires_after_sales"]),
    "mutant-overrefund-or-currency": failVector([
      "paid_unstarted_creates_paid_amount_refund",
      "withdrawal_completion_precedes_cancellation",
      "restart_recovery_preserves_handoffs_and_audit",
      "refund_preserves_paid_amount_currency_and_units",
      "expired_replay_reconciles_or_fails_closed",
    ]),
    "mutant-premature-cancel": failVector([
      "active_fulfillment_enters_pending_withdrawal",
      "withdrawal_completion_precedes_cancellation",
      "withdrawal_rejection_preserves_order_and_effects",
      "withdrawal_failure_is_recoverable_without_effects",
      "inventory_compensation_is_exactly_once",
      "restart_recovery_preserves_handoffs_and_audit",
      "audit_and_retention_policy_are_complete",
    ]),
    "mutant-withdrawal-rejection-effects": failVector([
      "withdrawal_rejection_preserves_order_and_effects",
    ]),
    "mutant-withdrawal-failure-effects": failVector([
      "withdrawal_failure_is_recoverable_without_effects",
    ]),
    "mutant-double-effects": failVector([
      "inventory_compensation_is_exactly_once",
      "request_replay_and_conflict_are_idempotent",
      "expired_replay_reconciles_or_fails_closed",
    ]),
    "mutant-coupon-always-restored": failVector(["coupon_restore_requires_current_eligibility"]),
    "mutant-no-ownership": failVector(["customer_ownership_is_enforced"]),
    "mutant-no-persistence": failVector([
      "withdrawal_failure_is_recoverable_without_effects",
      "restart_recovery_preserves_handoffs_and_audit",
      "expired_replay_reconciles_or_fails_closed",
    ]),
    "mutant-expired-replay-fresh": failVector(["expired_replay_reconciles_or_fails_closed"]),
    "mutant-sparse-audit": failVector([
      "withdrawal_failure_is_recoverable_without_effects",
      "restart_recovery_preserves_handoffs_and_audit",
      "expired_replay_reconciles_or_fails_closed",
      "audit_and_retention_policy_are_complete",
    ]),
    "gold-repeat": passVector,
    "gold-next-seed": passVector,
  },
};

export const validCommerceWithdrawalAdmission = buildCommerceGraderAdmission({
  oraclePlan: validCommerceWithdrawalOraclePlan,
  catalog: validCommerceWithdrawalCatalog,
  calibration,
  seed: 1729,
  evalPackageDigest: validControlVariant.eval_package_sha256,
});

export const validCommerceWithdrawalControlVariant = parseCommerceVariant({
  ...validControlVariant,
  schema_version: 2,
  template_id: "commerce-order-cancellation-v2",
});
export const validCommerceWithdrawalTreatmentVariant = parseCommerceVariant({
  ...validTreatmentVariant,
  schema_version: 2,
  template_id: "commerce-order-cancellation-v2",
});

export const validCommerceWithdrawalExperiment = parseCommerceExperiment({
  schema_version: 2,
  template_id: "commerce-order-cancellation-v2",
  campaign_id: "campaign-commerce-withdrawal-schema",
  created_at: "2026-08-21T00:00:00.000Z",
  domain: "open-coding-commerce-delivery",
  eval_pack_id: "open-coding-commerce-delivery-v1",
  task_pack_digest: validCommerceWithdrawalClaimIr.source.task_pack_sha256,
  control_variant_digest: canonicalJsonDigest(validCommerceWithdrawalControlVariant),
  treatment_variant_digest: canonicalJsonDigest(validCommerceWithdrawalTreatmentVariant),
  deployment: {
    digest: validExperiment.deployment.digest,
    eval_package_sha256: validControlVariant.eval_package_sha256,
    qualification: validExperiment.deployment.qualification,
    grader_admission_sha256: canonicalJsonDigest(validCommerceWithdrawalAdmission),
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
  template_id: "commerce-order-cancellation-v2" as const,
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

export const validCommerceWithdrawalPairedEvaluation = parseCommercePairedEvaluation({
  schema_version: 2,
  template_id: "commerce-order-cancellation-v2",
  campaign_id: validCommerceWithdrawalExperiment.campaign_id,
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

export const validCommerceWithdrawalPairedEvaluationPointer = {
  ref: parseArtifactRef("artifact://campaign/evaluation.json"),
  sha256: canonicalJsonDigest(validCommerceWithdrawalPairedEvaluation),
};

export const validCommerceWithdrawalPairedReport = buildCommercePairedImpactReport({
  experiment: validCommerceWithdrawalExperiment,
  experimentPointer: artifactPointer(
    "artifact://campaign/manifest.json",
    canonicalJsonDigest(validCommerceWithdrawalExperiment),
  ),
  pairedEvaluation: validCommerceWithdrawalPairedEvaluation,
  evaluationPointer: validCommerceWithdrawalPairedEvaluationPointer,
  controlEpisodePointer: artifactPointer(
    validCommerceWithdrawalPairedEvaluation.arms.control.episode.ref,
    validCommerceWithdrawalPairedEvaluation.arms.control.episode.sha256,
  ),
  treatmentEpisodePointer: artifactPointer(
    validCommerceWithdrawalPairedEvaluation.arms.treatment.episode.ref,
    validCommerceWithdrawalPairedEvaluation.arms.treatment.episode.sha256,
  ),
});

export const validCommerceWithdrawalDeliveryReport = parseCommerceDeliveryReport(
  buildCommerceDeliveryReport({
    evaluationId: "delivery-commerce-schema",
    claimIr: validCommerceWithdrawalClaimIr,
    oraclePlan: validCommerceWithdrawalOraclePlan,
    catalog: validCommerceWithdrawalCatalog,
    admission: validCommerceWithdrawalAdmission,
    pairedEvaluation: validCommerceWithdrawalPairedEvaluation,
    pairedReport: validCommerceWithdrawalPairedReport,
    pairedEvaluationPointer: validCommerceWithdrawalPairedEvaluationPointer,
    pairedReportPointer: {
      ref: "artifact://campaign/report.json",
      sha256: canonicalJsonDigest(validCommerceWithdrawalPairedReport),
    },
  }),
);
