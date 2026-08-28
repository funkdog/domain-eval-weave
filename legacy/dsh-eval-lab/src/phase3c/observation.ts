import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type DomainObservationNormalForm,
  type ExpectedValue,
  type ObservationAuthorityMap,
  type ObservationBoundarySpec,
  type ObservationExpression,
  parseObservationAuthorityMap,
  parseObservationBoundarySpec,
} from "./contracts.js";
import {
  EFFECT_DIMENSION,
  OPERATION_DIMENSION,
  PHASE3C_DIMENSIONS,
  PHASE3C_EFFECT_DIMENSIONS,
  PHASE3C_PUBLIC_OBSERVATION_CATALOG,
  type Phase3cDimension,
  type Phase3cNormalFormSlot,
  type Phase3cOperation,
  type Phase3cStimulus,
  type Phase3cStimulusField,
  STATE_DIMENSION,
} from "./vocabulary.js";

const dimensionOrder = new Map(PHASE3C_DIMENSIONS.map((dimension, index) => [dimension, index]));

function canonicalDimensions(values: Iterable<Phase3cDimension>): Phase3cDimension[] {
  return [...new Set(values)].sort(
    (left, right) =>
      (dimensionOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (dimensionOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function deriveExpressionDimensions(expression: ObservationExpression): Phase3cDimension[] {
  switch (expression.type) {
    case "all_of":
    case "any_of":
      return canonicalDimensions(expression.children.flatMap(deriveExpressionDimensions));
    case "operation_status_is":
      return [OPERATION_DIMENSION[expression.operation_id]];
    case "state_field_compare":
      return [STATE_DIMENSION[expression.field_id]];
    case "effect_count_is":
    case "effect_attributes_compare":
      return [EFFECT_DIMENSION[expression.effect_id]];
    case "multiset_compare":
      return expression.effect_id === "all"
        ? [...PHASE3C_EFFECT_DIMENSIONS]
        : [EFFECT_DIMENSION[expression.effect_id]];
    case "relation_holds":
      return [expression.relation_id];
    case "retention_window_compare":
      return ["retention_window"];
  }
}

function expressionShape(expression: ObservationExpression): {
  readonly depth: number;
  readonly nodes: number;
} {
  if (expression.type !== "all_of" && expression.type !== "any_of") return { depth: 1, nodes: 1 };
  const children = expression.children.map(expressionShape);
  return {
    depth: 1 + Math.max(...children.map((child) => child.depth)),
    nodes: 1 + children.reduce((total, child) => total + child.nodes, 0),
  };
}

export function validateObservationBoundary(input: {
  readonly boundary: unknown;
  readonly authorityMap: unknown;
  readonly claimAxes: Readonly<Record<string, "requirement_delta" | "domain_preservation">>;
}): {
  readonly boundary: ObservationBoundarySpec;
  readonly authorityMap: ObservationAuthorityMap;
  readonly derivedDimensions: readonly Phase3cDimension[];
} {
  const boundary = parseObservationBoundarySpec(input.boundary);
  const authorityMap = parseObservationAuthorityMap(input.authorityMap);
  if (
    boundary.public_observation_catalog_sha256 !==
      canonicalJsonDigest(PHASE3C_PUBLIC_OBSERVATION_CATALOG) ||
    authorityMap.catalog_sha256 !== boundary.public_observation_catalog_sha256 ||
    boundary.authority_map_sha256 !== canonicalJsonDigest(authorityMap) ||
    boundary.source.claim_ir.sha256 !== authorityMap.claim_ir_sha256
  ) {
    throw new Error("Observation Boundary source closure drifted");
  }
  const authority = new Map(authorityMap.dimensions.map((entry) => [entry.dimension_id, entry]));
  const observations = new Set<string>();
  const allDerived: Phase3cDimension[] = [];
  for (const binding of boundary.bindings) {
    if (observations.has(binding.observation_id)) throw new Error("Observation ids must be unique");
    observations.add(binding.observation_id);
    const shape = expressionShape(binding.expression);
    if (shape.depth > 8 || shape.nodes > 128)
      throw new Error("Observation expression exceeds bounded complexity");
    const derived = deriveExpressionDimensions(binding.expression);
    if (canonicalJson(binding.dimension_ids) !== canonicalJson(derived)) {
      throw new Error("Binding dimension ids do not match the derived dimension set");
    }
    const claimAxis = input.claimAxes[binding.claim_id];
    if (claimAxis === undefined || claimAxis !== binding.axis) {
      throw new Error("Observation binding Claim axis does not match Claim IR");
    }
    for (const dimension of derived) {
      const entry = authority.get(dimension);
      if (entry?.disposition !== "deterministic" || !entry.claim_ids.includes(binding.claim_id)) {
        throw new Error(
          "Observation binding references a non-deterministic or unauthorized dimension",
        );
      }
    }
    allDerived.push(...derived);
  }
  const derivedDimensions = canonicalDimensions(allDerived);
  const deterministic = authorityMap.dimensions
    .filter((entry) => entry.disposition === "deterministic")
    .map((entry) => entry.dimension_id);
  if (canonicalJson(derivedDimensions) !== canonicalJson(deterministic)) {
    throw new Error("Observation Boundary does not cover the complete deterministic dimension set");
  }
  return { boundary, authorityMap, derivedDimensions };
}

export function normalizeOperationTransport(input: {
  readonly kind: "throw" | "typed_rejection" | "success" | "unavailable";
}): "accepted" | "rejected" | "unavailable" {
  if (input.kind === "throw" || input.kind === "typed_rejection") return "rejected";
  return input.kind === "success" ? "accepted" : "unavailable";
}

type Scalar = string | number | boolean | null;
export interface ObservationContext {
  readonly operations: Partial<Record<Phase3cOperation, "accepted" | "rejected" | "unavailable">>;
  readonly normalForms: Partial<Record<Phase3cNormalFormSlot, DomainObservationNormalForm>>;
  readonly stimuli: Partial<Record<Phase3cStimulus, Partial<Record<Phase3cStimulusField, Scalar>>>>;
  readonly retentionAgeMs: Partial<Record<"retention_clock", number>>;
}

function stateValue(
  form: DomainObservationNormalForm | undefined,
  fieldId: string,
): Scalar | undefined {
  return form?.state.find((field) => field.field_id === fieldId)?.value.scalar;
}

function effects(form: DomainObservationNormalForm | undefined, effectId?: string) {
  return (
    form?.effects.filter((effect) => effectId === undefined || effect.effect_id === effectId) ?? []
  );
}

function resolveExpected(value: ExpectedValue, context: ObservationContext): Scalar | undefined {
  if (value.type === "scalar_literal") return value.value;
  if (value.type === "stimulus_value") return context.stimuli[value.stimulus_id]?.[value.field_id];
  if (value.type === "state_value")
    return stateValue(context.normalForms[value.slot], value.field_id);
  const effect = effects(context.normalForms[value.slot], value.effect_id)[0];
  return [...(effect?.identity ?? []), ...(effect?.attributes ?? [])].find(
    (field) => field.field_id === value.field_id,
  )?.value;
}

function resolveExpectedValues(
  values: readonly ExpectedValue[],
  context: ObservationContext,
): Scalar[] | undefined {
  const resolved = values.map((value) => resolveExpected(value, context));
  return resolved.some((value) => value === undefined) ? undefined : (resolved as Scalar[]);
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function compare(
  value: Scalar | undefined,
  comparator: "equals" | "not_equals" | "one_of",
  expected: readonly Scalar[],
): boolean {
  if (value === undefined) return false;
  const included = expected.some((entry) => equal(value, entry));
  return comparator === "not_equals" ? !included : included;
}

function canonicalEffects(
  form: DomainObservationNormalForm | undefined,
  effectId: string | "all",
): string {
  const selected = effects(form, effectId === "all" ? undefined : effectId)
    .map((effect) => canonicalJson(effect))
    .sort();
  return canonicalJson(selected);
}

export function evaluateObservationExpression(
  expression: ObservationExpression,
  context: ObservationContext,
): boolean {
  switch (expression.type) {
    case "all_of":
      return expression.children.every((child) => evaluateObservationExpression(child, context));
    case "any_of":
      return expression.children.some((child) => evaluateObservationExpression(child, context));
    case "operation_status_is":
      return context.operations[expression.operation_id] === expression.expected_status;
    case "state_field_compare": {
      const current = stateValue(context.normalForms[expression.slot], expression.field_id);
      if (expression.comparator === "unchanged") {
        return equal(current, stateValue(context.normalForms.before, expression.field_id));
      }
      const expected = resolveExpectedValues(expression.expected_values, context);
      return expected !== undefined && compare(current, expression.comparator, expected);
    }
    case "effect_count_is": {
      const count = effects(context.normalForms[expression.slot], expression.effect_id).length;
      if (expression.cardinality.mode === "exactly") return count === expression.cardinality.value;
      if (expression.cardinality.mode === "at_least") return count >= expression.cardinality.value;
      return count <= expression.cardinality.value;
    }
    case "effect_attributes_compare": {
      const expected = resolveExpectedValues(expression.expected_values, context);
      if (expected === undefined) return false;
      const values = effects(context.normalForms[expression.slot], expression.effect_id).map(
        (effect) =>
          [...effect.identity, ...effect.attributes].find(
            (field) => field.field_id === expression.field_id,
          )?.value,
      );
      return (
        values.length > 0 &&
        values.every((value) => compare(value, expression.comparator, expected))
      );
    }
    case "multiset_compare":
      return (
        canonicalEffects(context.normalForms[expression.left], expression.effect_id) ===
        canonicalEffects(context.normalForms[expression.right], expression.effect_id)
      );
    case "relation_holds":
      return Object.values(context.normalForms).some((form) =>
        form?.relations.some(
          (relation) => relation.relation_id === expression.relation_id && relation.status,
        ),
      );
    case "retention_window_compare": {
      const age = context.retentionAgeMs[expression.clock_stimulus_id];
      return age !== undefined && age <= expression.window_ms;
    }
  }
}
