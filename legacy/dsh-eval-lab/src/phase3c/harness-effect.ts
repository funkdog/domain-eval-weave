import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  COST_METRICS,
  type HarnessEffectContract,
  parseHarnessEffectContract,
} from "./contracts.js";
import { parseTddTaskRegistry, TDD_SKILL_BINDING } from "./tdd-binding.js";

type Validity = "valid" | "insufficient" | "invalid";
type DeliveryStatus = "fail" | "pass";
type SemanticStatus = "fail" | "pass";
type CodeQualityStatus = "fail" | "concern" | "pass";
type CostMetric = (typeof COST_METRICS)[number];
type CostVector = Readonly<Record<CostMetric, number | null>>;

export interface HarnessArmResult {
  readonly delivery: DeliveryStatus;
  readonly semantic: SemanticStatus;
  readonly codeQuality: CodeQualityStatus;
  readonly cost: CostVector;
}

export interface HarnessEffectProjection {
  readonly contractSha256: string;
  readonly status:
    | "improvement_observed"
    | "harm_observed"
    | "mixed"
    | "no_observed_difference"
    | "not_activated"
    | "inconclusive";
  readonly opportunity: "eligible" | "ineligible" | "unknown";
  readonly activation: "activated" | "not_activated" | "unknown";
  readonly costDelta: Readonly<Record<CostMetric, number | null>>;
  readonly claimStrength: "descriptive" | "diagnostic" | "effect_eligible";
}

export function createTddHarnessEffectContract(input: {
  readonly taskRegistry: unknown;
  readonly activationSchemaSha256: string;
}): HarnessEffectContract {
  const registry = parseTddTaskRegistry(input.taskRegistry);
  const tolerance: Readonly<Record<CostMetric, number>> = {
    elapsed_ms: 5_000,
    input_tokens: 500,
    cached_input_tokens: 500,
    output_tokens: 250,
    failed_tool_calls: 0,
  };
  const unit: Readonly<Record<CostMetric, "milliseconds" | "tokens" | "calls">> = {
    elapsed_ms: "milliseconds",
    input_tokens: "tokens",
    cached_input_tokens: "tokens",
    output_tokens: "tokens",
    failed_tool_calls: "calls",
  };
  return parseHarnessEffectContract({
    schema_version: 1,
    contract_id: "tdd-skill-harness-effect-v1",
    harness_binding_sha256: canonicalJsonDigest(TDD_SKILL_BINDING),
    task_registry_sha256: canonicalJsonDigest(registry),
    opportunity_rules: [
      { bucket: "TDD-suitable", expected_opportunity: "eligible" },
      { bucket: "borderline", expected_opportunity: "unknown" },
      { bucket: "non-trigger", expected_opportunity: "ineligible" },
      { bucket: "holdout", expected_opportunity: "eligible" },
    ],
    activation: {
      source_schema_sha256: input.activationSchemaSha256,
      event_ids: [
        "skill_loaded",
        "first_test_write",
        "first_production_write",
        "focused_red",
        "focused_green",
        "full_suite_green",
        "refactor_after_green",
      ],
      dependency_escape_event_id: "codebase_design_requested",
    },
    quality_partial_order: {
      delivery: ["fail", "pass"],
      semantic: ["fail", "pass"],
      code_quality: ["fail", "concern", "pass"],
    },
    cost: {
      rules: COST_METRICS.map((metricId) => ({
        metric_id: metricId,
        unit: unit[metricId],
        direction: "lower_is_better",
        tolerance: tolerance[metricId],
        budget: { kind: "none", value: null },
        missing_or_null: "insufficient",
      })),
    },
    claim_strength_rules: {
      single_pair: "descriptive",
      repeated_known_tasks: "diagnostic",
      holdout_minimum: 2,
      effect_eligible_minimum: 6,
    },
  });
}

function claimStrength(
  contract: HarnessEffectContract,
  repeatedKnownTasks: number,
  holdoutTasks: number,
): HarnessEffectProjection["claimStrength"] {
  const total = repeatedKnownTasks + holdoutTasks;
  if (
    holdoutTasks >= contract.claim_strength_rules.holdout_minimum &&
    total >= contract.claim_strength_rules.effect_eligible_minimum
  ) {
    return "effect_eligible";
  }
  return repeatedKnownTasks > 1 ? "diagnostic" : "descriptive";
}

function rank<T extends string>(order: readonly T[], value: T): number {
  const index = order.indexOf(value);
  if (index < 0) throw new Error(`Harness Effect status is absent from partial order: ${value}`);
  return index;
}

export function projectHarnessEffect(input: {
  readonly contract: unknown;
  readonly bucket: "TDD-suitable" | "borderline" | "non-trigger" | "holdout";
  readonly activation: "activated" | "not_activated" | "unknown";
  readonly validity: { readonly mechanism: Validity; readonly cost: Validity };
  readonly control: HarnessArmResult;
  readonly treatment: HarnessArmResult;
  readonly repeatedKnownTasks: number;
  readonly holdoutTasks: number;
}): HarnessEffectProjection {
  const contract = parseHarnessEffectContract(input.contract);
  const opportunity = contract.opportunity_rules.find(
    (rule) => rule.bucket === input.bucket,
  )?.expected_opportunity;
  if (opportunity === undefined) throw new Error("Harness Effect opportunity rule is missing");
  const costDelta = Object.fromEntries(
    COST_METRICS.map((metric) => {
      const control = input.control.cost[metric];
      const treatment = input.treatment.cost[metric];
      return [metric, control === null || treatment === null ? null : treatment - control];
    }),
  ) as Record<CostMetric, number | null>;
  const strength = claimStrength(contract, input.repeatedKnownTasks, input.holdoutTasks);
  const base = {
    contractSha256: canonicalJsonDigest(contract),
    opportunity,
    activation: input.activation,
    costDelta,
    claimStrength: strength,
  } as const;
  if (
    input.validity.mechanism !== "valid" ||
    input.validity.cost !== "valid" ||
    opportunity === "unknown" ||
    input.activation === "unknown"
  ) {
    return { ...base, status: "inconclusive" };
  }
  if (input.activation === "not_activated") return { ...base, status: "not_activated" };

  let qualityImproved = false;
  let qualityHarmed = false;
  const compare = (left: number, right: number) => {
    if (right > left) qualityImproved = true;
    if (right < left) qualityHarmed = true;
  };
  compare(
    rank(contract.quality_partial_order.delivery, input.control.delivery),
    rank(contract.quality_partial_order.delivery, input.treatment.delivery),
  );
  compare(
    rank(contract.quality_partial_order.semantic, input.control.semantic),
    rank(contract.quality_partial_order.semantic, input.treatment.semantic),
  );
  compare(
    rank(contract.quality_partial_order.code_quality, input.control.codeQuality),
    rank(contract.quality_partial_order.code_quality, input.treatment.codeQuality),
  );

  let costImproved = false;
  let costHarmed = false;
  let budgetExceeded = false;
  for (const rule of contract.cost.rules) {
    const delta = costDelta[rule.metric_id];
    const treatment = input.treatment.cost[rule.metric_id];
    if (delta === null || treatment === null) return { ...base, status: "inconclusive" };
    if (rule.budget.kind === "maximum" && treatment > (rule.budget.value ?? -1)) {
      budgetExceeded = true;
    }
    if (delta > rule.tolerance) costHarmed = true;
    if (delta < -rule.tolerance) costImproved = true;
  }

  const improved = qualityImproved || (!qualityImproved && !qualityHarmed && costImproved);
  const harmed =
    qualityHarmed || budgetExceeded || (!qualityImproved && !qualityHarmed && costHarmed);

  return {
    ...base,
    status:
      improved && harmed
        ? "mixed"
        : improved
          ? "improvement_observed"
          : harmed
            ? "harm_observed"
            : "no_observed_difference",
  };
}
