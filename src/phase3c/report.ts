import { type Phase3cDeliveryReport, parsePhase3cDeliveryReport } from "./contracts.js";

type Validity = "valid" | "insufficient" | "invalid";

function combine(values: readonly Validity[]): Validity {
  return values.includes("invalid")
    ? "invalid"
    : values.includes("insufficient")
      ? "insufficient"
      : "valid";
}

export function buildPhase3cDeliveryReport(input: {
  readonly evaluationId: string;
  readonly source: Phase3cDeliveryReport["source"];
  readonly validity: {
    readonly deterministic: "valid" | "invalid";
    readonly semanticJudge: Validity;
    readonly codeQualityJudge: Validity;
    readonly harnessMechanism: Validity;
    readonly cost: Validity;
    readonly reasons: Phase3cDeliveryReport["measurement_validity"]["reasons"];
  };
  readonly delivery: {
    readonly requirementDelta: Phase3cDeliveryReport["axes"]["delivery"]["requirement_delta"];
    readonly domainPreservation: Phase3cDeliveryReport["axes"]["delivery"]["domain_preservation"];
  };
  readonly semantic: {
    readonly required: boolean;
    readonly dimensions: Phase3cDeliveryReport["axes"]["semantic"]["dimensions"];
  };
  readonly codeQuality: {
    readonly dimensions: Phase3cDeliveryReport["axes"]["code_quality"]["dimensions"];
  };
  readonly harnessEffect: {
    readonly contractSha256: string;
    readonly status: Phase3cDeliveryReport["axes"]["harness_effect"]["status"];
    readonly opportunity: Phase3cDeliveryReport["axes"]["harness_effect"]["opportunity"];
    readonly activation: Phase3cDeliveryReport["axes"]["harness_effect"]["activation"];
    readonly changedDeliveryClaims?: readonly string[];
    readonly changedSemanticDimensions?: readonly string[];
    readonly changedCodeQualityDimensions?: readonly string[];
    readonly costDelta: Phase3cDeliveryReport["axes"]["harness_effect"]["cost_delta"];
    readonly claimStrength: Phase3cDeliveryReport["axes"]["harness_effect"]["claim_strength"];
  };
  readonly traceability: Phase3cDeliveryReport["traceability"];
}): Phase3cDeliveryReport {
  const candidateValidity = combine([
    input.validity.deterministic,
    input.validity.semanticJudge,
    input.validity.codeQualityJudge,
  ]);
  const harnessValidity = combine([input.validity.harnessMechanism, input.validity.cost]);
  const observations = [...input.delivery.requirementDelta, ...input.delivery.domainPreservation];
  const deliveryStatus = observations.some((entry) => entry.status === "error")
    ? "error"
    : observations.some((entry) => entry.status === "fail")
      ? "fail"
      : "pass";
  const semanticStatus =
    input.validity.semanticJudge === "invalid" ||
    (input.semantic.required && input.semantic.dimensions.length === 0)
      ? "error"
      : !input.semantic.required
        ? "not_required"
        : input.semantic.dimensions.some((entry) => entry.verdict === "abstain")
          ? "abstain"
          : input.semantic.dimensions.some((entry) => entry.verdict === "fail")
            ? "fail"
            : "pass";
  const codeQualityStatus =
    input.validity.codeQualityJudge === "invalid" || input.codeQuality.dimensions.length === 0
      ? "error"
      : input.codeQuality.dimensions.some((entry) => entry.verdict === "abstain")
        ? "abstain"
        : input.codeQuality.dimensions.some(
              (entry) => entry.verdict === "fail" && entry.severity === "blocking",
            )
          ? "fail"
          : input.codeQuality.dimensions.some(
                (entry) => entry.verdict === "fail" && entry.severity === "concern",
              )
            ? "concern"
            : "pass";
  const verdict =
    candidateValidity !== "valid" ||
    deliveryStatus === "error" ||
    semanticStatus === "abstain" ||
    semanticStatus === "error" ||
    codeQualityStatus === "abstain" ||
    codeQualityStatus === "error"
      ? "inconclusive"
      : deliveryStatus === "fail" || semanticStatus === "fail" || codeQualityStatus === "fail"
        ? "reject"
        : "accept";
  return parsePhase3cDeliveryReport({
    schema_version: 3,
    evaluation_id: input.evaluationId,
    source: input.source,
    measurement_validity: {
      candidate_verdict: candidateValidity,
      harness_effect: harnessValidity,
      deterministic: input.validity.deterministic,
      semantic_judge: input.validity.semanticJudge,
      code_quality_judge: input.validity.codeQualityJudge,
      harness_mechanism: input.validity.harnessMechanism,
      cost: input.validity.cost,
      reasons: input.validity.reasons,
    },
    verdict,
    axes: {
      delivery: {
        status: deliveryStatus,
        requirement_delta: input.delivery.requirementDelta,
        domain_preservation: input.delivery.domainPreservation,
      },
      semantic: {
        status: semanticStatus,
        required: input.semantic.required,
        dimensions: input.semantic.dimensions,
      },
      code_quality: { status: codeQualityStatus, dimensions: input.codeQuality.dimensions },
      harness_effect: {
        contract_sha256: input.harnessEffect.contractSha256,
        status: input.harnessEffect.status,
        opportunity: input.harnessEffect.opportunity,
        activation: input.harnessEffect.activation,
        changed_delivery_claims: input.harnessEffect.changedDeliveryClaims ?? [],
        changed_semantic_dimensions: input.harnessEffect.changedSemanticDimensions ?? [],
        changed_code_quality_dimensions: input.harnessEffect.changedCodeQualityDimensions ?? [],
        cost_delta: input.harnessEffect.costDelta,
        claim_strength: input.harnessEffect.claimStrength,
      },
    },
    traceability: input.traceability,
  });
}
