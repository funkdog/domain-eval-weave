import {
  type CompiledDomainClaim,
  type CompiledDomainLandscape,
  compileDomainLandscapeDirectory,
  readDomainYaml,
  resolveDomainRoot,
} from "./compiler.js";
import {
  type DomainEvaluation,
  type DomainScope,
  domainEvaluationSchema,
  domainScopeSchema,
} from "./contracts.js";
import { DomainCompilerError } from "./errors.js";

export interface DomainCoverageEntry {
  readonly conceptRef: string;
  readonly inScope: boolean;
  readonly semanticStatus: string;
  readonly epistemicStatus: string;
  readonly observabilityStatus: string;
  readonly evaluationStatus: string;
}

export interface DomainCoverageReport {
  readonly scopeId: string;
  readonly entries: readonly DomainCoverageEntry[];
}

export interface DomainClaimSelection {
  readonly claimRefs: readonly string[];
}

function exactReference(id: string, version: string): string {
  return `${id}@${version}`;
}

const timeSelectorSchema = z.string().datetime({ offset: true });

function requireTimestamp(value: string, locator: string): number {
  const parsed = timeSelectorSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainCompilerError("invalid_time_selector", "Time selector is invalid", locator);
  }
  return Date.parse(parsed.data);
}

function validateScopeLandscape(scope: DomainScope, landscape: CompiledDomainLandscape): void {
  if (scope.landscape_ref !== exactReference(landscape.landscapeId, landscape.version)) {
    throw new DomainCompilerError(
      "scope_landscape_mismatch",
      "Scope must pin the compiled Landscape Release",
      scope.scope_id,
    );
  }
}

function epistemicStatus(claims: readonly CompiledDomainClaim[]): string {
  const states = new Set(claims.map((claim) => claim.epistemicState));
  for (const state of [
    "conflicted",
    "contested",
    "unknown",
    "proposed",
    "grounded",
    "confirmed",
    "retired",
  ]) {
    if (states.has(state as CompiledDomainClaim["epistemicState"])) return state;
  }
  return "unknown";
}

function claimObservability(claims: readonly CompiledDomainClaim[]): string {
  const states = new Set(claims.map((claim) => claim.observability));
  for (const state of ["unobservable", "unknown", "partially_observable", "observable"]) {
    if (states.has(state as CompiledDomainClaim["observability"])) return state;
  }
  return "unknown";
}

function effectiveObservability(
  claims: readonly CompiledDomainClaim[],
  bindingCompleteness: "complete" | "partial" | "unavailable" | undefined,
): string {
  if (bindingCompleteness === "unavailable") return "unobservable";
  const claimStatus = claimObservability(claims);
  if (claimStatus === "unobservable" || claimStatus === "unknown") return claimStatus;
  if (bindingCompleteness === "partial" || claimStatus === "partially_observable") {
    return "partially_observable";
  }
  return claimStatus;
}

function coverageEntry(
  conceptRef: string,
  inScope: boolean,
  landscape: CompiledDomainLandscape,
  projection: DomainEvaluation["projections"][number],
  observationProfile: DomainEvaluation["observation_profiles"][number],
): DomainCoverageEntry {
  const described = landscape.modules.some((module) =>
    module.concepts.some((concept) => concept.conceptRef === conceptRef),
  );
  const directClaims = landscape.claims.filter((claim) => claim.subjectRef === conceptRef);
  const binding = observationProfile.bindings.find((entry) =>
    entry.covers_refs.includes(conceptRef),
  );
  const excluded = projection.exclusions.some((entry) => entry.concept_ref === conceptRef);
  return {
    conceptRef,
    inScope,
    semanticStatus: described ? "described" : inScope ? "missing" : "out_of_scope",
    epistemicStatus: epistemicStatus(directClaims),
    observabilityStatus: effectiveObservability(directClaims, binding?.completeness),
    evaluationStatus: projection.selected_refs.includes(conceptRef)
      ? "selected"
      : excluded
        ? "excluded"
        : "not_selected",
  };
}

export async function deriveDomainCoverageDirectory(
  inputRoot: string,
  input: { readonly projectionId: string; readonly observationProfileId: string },
): Promise<DomainCoverageReport> {
  const root = await resolveDomainRoot(inputRoot);
  const [landscape, scopeInput, evaluationInput] = await Promise.all([
    compileDomainLandscapeDirectory(root),
    readDomainYaml(root, "scope.yaml", domainScopeSchema, "invalid_domain_scope"),
    readDomainYaml(root, "evaluation.yaml", domainEvaluationSchema, "invalid_domain_evaluation"),
  ]);
  const scope = scopeInput.value;
  const evaluation = evaluationInput.value;
  validateScopeLandscape(scope, landscape);
  const projection = evaluation.projections.find(
    (candidate) => candidate.projection_id === input.projectionId,
  );
  if (projection === undefined) {
    throw new DomainCompilerError(
      "unknown_projection",
      "Coverage request references an unknown Eval Projection",
      input.projectionId,
    );
  }
  const observationProfile = evaluation.observation_profiles.find(
    (candidate) => candidate.observation_profile_id === input.observationProfileId,
  );
  if (observationProfile === undefined) {
    throw new DomainCompilerError(
      "unknown_observation_profile",
      "Coverage request references an unknown observation profile",
      input.observationProfileId,
    );
  }

  const entries = [
    ...scope.included.map((conceptRef) =>
      coverageEntry(conceptRef, true, landscape, projection, observationProfile),
    ),
    ...scope.adjacent.map((conceptRef) =>
      coverageEntry(conceptRef, false, landscape, projection, observationProfile),
    ),
    ...scope.out_of_scope.map((conceptRef) => ({
      conceptRef,
      inScope: false,
      semanticStatus: "out_of_scope",
      epistemicStatus: "out_of_scope",
      observabilityStatus: "out_of_scope",
      evaluationStatus: "out_of_scope",
    })),
  ];
  return { scopeId: scope.scope_id, entries };
}

export async function selectDomainClaimsDirectory(
  inputRoot: string,
  input: { readonly validAt: string; readonly recordedAt: string },
): Promise<DomainClaimSelection> {
  const validAt = requireTimestamp(input.validAt, "validAt");
  const recordedAt = requireTimestamp(input.recordedAt, "recordedAt");
  const landscape = await compileDomainLandscapeDirectory(inputRoot);
  const claimRefs = landscape.claims
    .filter((claim) => {
      const validFrom = requireTimestamp(claim.validTime.from, `${claim.claimRef}.validTime.from`);
      const validTo =
        claim.validTime.to === undefined
          ? undefined
          : requireTimestamp(claim.validTime.to, `${claim.claimRef}.validTime.to`);
      const learnedAt = requireTimestamp(claim.recordedAt, `${claim.claimRef}.recordedAt`);
      return (
        validFrom <= validAt &&
        (validTo === undefined || validAt < validTo) &&
        learnedAt <= recordedAt
      );
    })
    .map((claim) => claim.claimRef)
    .sort();
  return { claimRefs };
}

import { z } from "zod";
