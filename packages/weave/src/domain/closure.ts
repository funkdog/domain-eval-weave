import { canonicalJsonDigest } from "../canonical-json.js";
import {
  type CompiledDomainClaim,
  compileDomainLandscapeDirectory,
  readDomainYaml,
  resolveDomainRoot,
  validateSourceAuthority,
} from "./compiler.js";
import {
  domainEvaluationSchema,
  domainScopeSchema,
  domainViewSchema,
  productContractsSchema,
  sourceIndexSchema,
} from "./contracts.js";
import { selectDomainClaimsDirectory } from "./coverage.js";
import { DomainCompilerError } from "./errors.js";

export interface EvaluationClosureBlocker {
  readonly code: string;
  readonly ref: string;
}

export interface EvaluationClosureResult {
  readonly closureId: string;
  readonly digest: string;
  readonly status: "complete" | "refused";
  readonly blockers: readonly EvaluationClosureBlocker[];
}

function exactReference(id: string, version: string): string {
  return `${id}@${version}`;
}

function splitVersionedReference(reference: string): readonly [string, string] {
  const separator = reference.lastIndexOf("@");
  if (separator <= 0 || separator === reference.length - 1) {
    throw new DomainCompilerError(
      "invalid_versioned_reference",
      "Reference must bind one exact version",
      reference,
    );
  }
  return [reference.slice(0, separator), reference.slice(separator + 1)];
}

function claimMatchesViewContext(
  claim: CompiledDomainClaim,
  context: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(claim.applicability).every(([key, value]) => {
    const contextValue = context[key];
    return contextValue === undefined || contextValue === value;
  });
}

export async function compileEvaluationClosureDirectory(
  inputRoot: string,
  input: { readonly closureId: string },
): Promise<EvaluationClosureResult> {
  const root = await resolveDomainRoot(inputRoot);
  const [landscape, scopeInput, viewInput, contractsInput, evaluationInput, sourcesInput] =
    await Promise.all([
      compileDomainLandscapeDirectory(root),
      readDomainYaml(root, "scope.yaml", domainScopeSchema, "invalid_domain_scope"),
      readDomainYaml(root, "view.yaml", domainViewSchema, "invalid_domain_view"),
      readDomainYaml(
        root,
        "product-contracts.yaml",
        productContractsSchema,
        "invalid_product_contracts",
      ),
      readDomainYaml(root, "evaluation.yaml", domainEvaluationSchema, "invalid_domain_evaluation"),
      readDomainYaml(root, "sources/index.yaml", sourceIndexSchema, "invalid_source_index"),
    ]);
  const scope = scopeInput.value;
  const view = viewInput.value;
  const contracts = contractsInput.value;
  const evaluation = evaluationInput.value;

  if (
    scope.landscape_ref !== exactReference(landscape.landscapeId, landscape.version) ||
    view.landscape_ref !== exactReference(landscape.landscapeId, landscape.version) ||
    view.scope_ref !== exactReference(scope.scope_id, scope.version)
  ) {
    throw new DomainCompilerError(
      "view_input_mismatch",
      "Scope and View must pin the compiled Landscape and Scope",
      view.view_id,
    );
  }

  const closureRequest = evaluation.closure_expectations.find(
    (candidate) => candidate.closure_id === input.closureId,
  );
  if (closureRequest === undefined) {
    throw new DomainCompilerError(
      "unknown_closure",
      "Closure request does not exist",
      input.closureId,
    );
  }
  const [projectionId, projectionVersion] = splitVersionedReference(closureRequest.projection_ref);
  const projection = evaluation.projections.find(
    (candidate) =>
      candidate.projection_id === projectionId && candidate.version === projectionVersion,
  );
  if (projection === undefined) {
    throw new DomainCompilerError(
      "unknown_projection",
      "Closure references an unknown exact Eval Projection",
      closureRequest.projection_ref,
    );
  }
  const observationProfile = evaluation.observation_profiles.find(
    (candidate) => candidate.observation_profile_id === closureRequest.observation_profile_ref,
  );
  if (observationProfile === undefined) {
    throw new DomainCompilerError(
      "unknown_observation_profile",
      "Closure references an unknown observation profile",
      closureRequest.observation_profile_ref,
    );
  }
  if (projection.domain_view_ref !== exactReference(view.view_id, view.version)) {
    throw new DomainCompilerError(
      "projection_view_mismatch",
      "Eval Projection must pin the compiled Domain View",
      projection.projection_id,
    );
  }
  const [contractId, contractVersion] = splitVersionedReference(projection.product_contract_ref);
  const productContract = contracts.product_contracts.find(
    (candidate) => candidate.contract_id === contractId && candidate.version === contractVersion,
  );
  if (
    productContract === undefined ||
    productContract.domain_view_ref !== exactReference(view.view_id, view.version)
  ) {
    throw new DomainCompilerError(
      "projection_contract_mismatch",
      "Eval Projection must pin a Product Contract over the exact Domain View",
      projection.product_contract_ref,
    );
  }
  if (productContract.product.jurisdiction !== view.context.jurisdiction) {
    throw new DomainCompilerError(
      "product_contract_context_mismatch",
      "Product Contract jurisdiction must equal the Domain View context",
      productContract.contract_id,
    );
  }

  const availableClaims = await selectDomainClaimsDirectory(root, {
    validAt: view.context.valid_at,
    recordedAt: view.context.knowledge_recorded_at,
  });
  const availableClaimRefs = new Set(availableClaims.claimRefs);
  for (const claimRef of view.selected_claim_refs) {
    if (!availableClaimRefs.has(claimRef)) {
      throw new DomainCompilerError(
        "view_claim_unavailable",
        "Domain View selected a Claim outside its valid or recorded-time window",
        claimRef,
      );
    }
  }
  const selectedClaims = landscape.claims
    .filter((claim) => view.selected_claim_refs.includes(claim.claimRef))
    .sort((left, right) => left.claimRef.localeCompare(right.claimRef));
  for (const claim of selectedClaims) {
    if (!claimMatchesViewContext(claim, view.context)) {
      throw new DomainCompilerError(
        "view_claim_applicability_mismatch",
        "Domain View selected a Claim that contradicts its context",
        claim.claimRef,
      );
    }
  }
  const selectedClaimRefs = new Set(selectedClaims.map((claim) => claim.claimRef));
  for (const claim of selectedClaims) {
    for (const conflictRef of claim.conflictsWith) {
      const qualifiedConflict = `${claim.claimRef.slice(0, claim.claimRef.indexOf("#"))}#${conflictRef}`;
      if (availableClaimRefs.has(qualifiedConflict) && !selectedClaimRefs.has(qualifiedConflict)) {
        throw new DomainCompilerError(
          "view_conflict_erasure",
          "Domain View must preserve applicable conflicting Claims",
          claim.claimRef,
        );
      }
    }
  }
  const preservableClaims = landscape.claims.filter(
    (claim) =>
      availableClaimRefs.has(claim.claimRef) &&
      scope.included.includes(claim.subjectRef) &&
      claimMatchesViewContext(claim, view.context) &&
      (view.preserve_epistemic_states.includes(claim.epistemicState) ||
        view.preserve_observability_states.includes(claim.observability)),
  );
  for (const claim of preservableClaims) {
    if (!selectedClaimRefs.has(claim.claimRef)) {
      throw new DomainCompilerError(
        "view_preservation_mismatch",
        "Domain View omitted an applicable Claim whose state must be preserved",
        claim.claimRef,
      );
    }
  }

  const conceptRefs = new Set(
    landscape.modules.flatMap((module) => module.concepts.map((concept) => concept.conceptRef)),
  );
  for (const commitment of productContract.commitments) {
    if (!conceptRefs.has(commitment.target_ref)) {
      throw new DomainCompilerError(
        "unknown_product_commitment_target",
        "Product Contract commitment references an unknown Concept",
        `${productContract.contract_id}#${commitment.commitment_id}`,
      );
    }
  }
  for (const selectedRef of projection.selected_refs) {
    if (!conceptRefs.has(selectedRef) || !scope.included.includes(selectedRef)) {
      throw new DomainCompilerError(
        "projection_scope_mismatch",
        "Eval Projection selected a Concept outside the exact Scope or Landscape",
        selectedRef,
      );
    }
  }
  for (const exclusion of projection.exclusions) {
    if (
      !conceptRefs.has(exclusion.concept_ref) ||
      projection.selected_refs.includes(exclusion.concept_ref)
    ) {
      throw new DomainCompilerError(
        "projection_exclusion_mismatch",
        "Eval Projection exclusion must name a known, non-selected Concept",
        exclusion.concept_ref,
      );
    }
  }

  const blockers: EvaluationClosureBlocker[] = [];
  for (const conceptRef of projection.selected_refs) {
    const binding = observationProfile.bindings.find((candidate) =>
      candidate.covers_refs.includes(conceptRef),
    );
    if (binding === undefined) {
      blockers.push({ code: "observation_binding_missing", ref: conceptRef });
    } else if (binding.completeness !== "complete") {
      blockers.push({ code: "observation_completeness_gap", ref: conceptRef });
    }
  }
  blockers.sort((left, right) => left.ref.localeCompare(right.ref));

  const productAuthoritySource = sourcesInput.value.sources.find(
    (source) => source.source_id === productContract.authority.source_id,
  );
  if (productAuthoritySource === undefined) {
    throw new DomainCompilerError(
      "unknown_authority_source_reference",
      "Product Contract authority source is unavailable",
      productContract.contract_id,
    );
  }
  validateSourceAuthority(
    productContract.authority,
    new Map(sourcesInput.value.sources.map((source) => [source.source_id, source])),
    "unknown_authority_source_reference",
    productContract.contract_id,
  );
  const status = blockers.length === 0 ? "complete" : "refused";
  const declaredBlockers =
    closureRequest.expected_status === "refused"
      ? [{ code: closureRequest.expected_blocker, ref: closureRequest.blocker_ref }]
      : [];
  if (
    status !== closureRequest.expected_status ||
    canonicalJsonDigest(blockers) !== canonicalJsonDigest(declaredBlockers)
  ) {
    throw new DomainCompilerError(
      "closure_expectation_mismatch",
      "Compiled Closure status and blockers must match the declared reference matrix",
      closureRequest.closure_id,
    );
  }
  const digest = canonicalJsonDigest({
    closureId: closureRequest.closure_id,
    landscapeDigest: landscape.digest,
    scope,
    view,
    productContract,
    productAuthoritySource: {
      sourceId: productAuthoritySource.source_id,
      kind: productAuthoritySource.kind,
      title: productAuthoritySource.title,
      path: productAuthoritySource.path,
      contentSha256: productAuthoritySource.content_sha256,
      recordedAt: productAuthoritySource.recorded_at,
      license: productAuthoritySource.license,
      provenance: productAuthoritySource.provenance,
      authorityScopes: productAuthoritySource.authority_scopes,
    },
    projection,
    observationProfile,
    episode: evaluation.episode,
    verdictPolicy: evaluation.verdict_policy,
    selectedClaims,
    status,
    blockers,
  });
  return { closureId: closureRequest.closure_id, digest, status, blockers };
}
