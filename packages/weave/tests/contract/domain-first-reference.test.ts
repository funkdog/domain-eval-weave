import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse, stringify } from "yaml";

import { canonicalJsonDigest, sha256Hex } from "../../src/canonical-json.js";

const referenceRoot = new URL("../../examples/commerce-landscape/", import.meta.url);

interface AuthorityFixture {
  readonly kind: string;
  readonly source_id: string;
}

interface ClaimFixture {
  readonly claim_id: string;
  readonly kind: string;
  readonly epistemic_state: string;
  readonly observability: string;
  readonly source_ids: readonly string[];
  readonly authority_assertions: readonly AuthorityFixture[];
  readonly valid_time: { readonly from: string };
  readonly recorded_at: string;
}

interface ModuleFixture {
  readonly module_id: string;
  readonly release: { readonly version: string };
  readonly claims: readonly ClaimFixture[];
  readonly evolutions?: readonly {
    readonly evolution_id: string;
    readonly kind: string;
    readonly predecessor_ref: string;
    readonly successor_refs: readonly string[];
    readonly source_ids: readonly string[];
    readonly recorded_at: string;
    readonly impact: {
      readonly affected_mapping_ids: readonly string[];
      readonly affected_landscape_ids: readonly string[];
    };
  }[];
}

interface LandscapeFixture {
  readonly landscape_id: string;
  readonly release: { readonly version: string };
  readonly module_releases: readonly {
    readonly module_id: string;
    readonly version: string;
    readonly path: string;
    readonly content_sha256: string;
  }[];
  readonly mappings: readonly {
    readonly mapping_id: string;
    readonly relation: string;
    readonly from_ref: string;
    readonly to_ref: string;
  }[];
}

interface SourceFixture {
  readonly sources: readonly {
    readonly source_id: string;
    readonly kind: string;
    readonly title: string;
    readonly path: string;
    readonly content_sha256: string;
    readonly recorded_at: string;
    readonly license: string;
    readonly provenance: string;
    readonly authority_scopes: readonly string[];
  }[];
}

interface ScopeFixture {
  readonly coverage_statuses: readonly string[];
  readonly anti_truncation: {
    readonly concept_ref: string;
    readonly remains_in_scope_when_unobservable: boolean;
  };
}

interface ViewFixture {
  readonly preserve_epistemic_states: readonly string[];
  readonly preserve_observability_states: readonly string[];
}

interface ProductContractsFixture {
  readonly product_contracts: readonly {
    readonly contract_id: string;
    readonly authority: { readonly kind: string };
    readonly commitments: readonly {
      readonly commitment_id: string;
      readonly deadline?: { readonly value: number; readonly unit: string };
      readonly required?: boolean;
    }[];
  }[];
}

interface EvaluationFixture {
  readonly episode: {
    readonly identities: Readonly<Record<string, string>>;
  };
  readonly projections: readonly { readonly projection_id: string }[];
  readonly observation_profiles: readonly {
    readonly observation_profile_id: string;
    readonly time_semantics: {
      readonly business_time_field: string;
      readonly observation_time_field: string;
      readonly allowed_lateness: { readonly value: number; readonly unit: string };
    };
    readonly absence_semantics: {
      readonly complete_channel_absence: string;
      readonly unavailable_channel_absence: string;
    };
  }[];
  readonly closure_expectations: readonly {
    readonly closure_id: string;
    readonly expected_status: string;
    readonly expected_blocker?: string;
    readonly blocker_ref?: string;
  }[];
  readonly verdict_policy: {
    readonly preserve_atomic_vector: boolean;
    readonly precedence: readonly string[];
  };
  readonly grade_atoms: readonly {
    readonly grade_id: string;
    readonly utility_claim: string;
    readonly estimator: { readonly predicate_id: string; readonly input_fields: readonly string[] };
    readonly validity_bounds: readonly string[];
    readonly consumer: { readonly role: string; readonly action: string };
    readonly calibration_plan: {
      readonly development_cohort_ref: string;
      readonly calibration_cohort_ref: string;
      readonly validation_cohort_ref: string;
    };
    readonly repeatability_contract: {
      readonly mode: string;
      readonly allowed_variance: string;
      readonly frozen_inputs: readonly string[];
    };
  }[];
  readonly validation_cohort_plan: {
    readonly development: CohortReference;
    readonly calibration: CohortReference;
    readonly validation: CohortReference;
    readonly cohorts_must_be_disjoint: boolean;
  };
  readonly qualification_protocol: {
    readonly candidate_freeze_schema: string;
    readonly curator_freeze_schema: string;
    readonly execution_schema: string;
    readonly unseal_schema: string;
    readonly independent_curator_required: boolean;
    readonly retired_holdout_observation_digests: readonly string[];
  };
}

interface CohortReference {
  readonly cohort_id: string;
  readonly cases_path: string;
  readonly expectations_path: string;
  readonly content_sha256: string;
}

interface CohortCasesFixture {
  readonly cohort_id: string;
  readonly cases: readonly {
    readonly case_id: string;
    readonly kind: string;
    readonly observations: Readonly<Record<string, boolean | null | number | string>>;
  }[];
}

interface CohortExpectationsFixture {
  readonly cohort_id: string;
  readonly authored_independently?: boolean;
  readonly reference_expectations?: boolean;
  readonly expectations: readonly {
    readonly case_id: string;
    readonly atoms: Readonly<Record<string, string>>;
    readonly overall: string;
  }[];
}

interface NegativeCasesFixture {
  readonly negative_cases: readonly {
    readonly case_id: string;
    readonly expected_error: string;
  }[];
}

interface CompiledDomainLandscape {
  readonly landscapeId: string;
  readonly version: string;
  readonly digest: string;
  readonly moduleReleaseCount: number;
  readonly mappingCount: number;
  readonly sourceSnapshotCount: number;
  readonly sourceDigests: Readonly<Record<string, string>>;
  readonly sourceSnapshots: readonly {
    readonly sourceId: string;
    readonly kind: string;
    readonly title: string;
    readonly path: string;
    readonly contentSha256: string;
    readonly recordedAt: string;
    readonly license: string;
    readonly provenance: string;
    readonly authorityScopes: readonly string[];
  }[];
  readonly moduleReleaseDigests: Readonly<Record<string, string>>;
  readonly modules: readonly {
    readonly moduleId: string;
    readonly version: string;
    readonly contentSha256: string;
    readonly maintainerIds: readonly string[];
    readonly concepts: readonly { readonly conceptRef: string }[];
  }[];
  readonly mappings: readonly {
    readonly mappingId: string;
    readonly version: string;
    readonly fromRef: string;
    readonly relation: string;
    readonly toRef: string;
    readonly scope: string;
    readonly required: boolean;
    readonly reviewerIds: readonly string[];
  }[];
  readonly authorityKinds: readonly string[];
  readonly claims: readonly {
    readonly claimRef: string;
    readonly subjectRef: string;
    readonly kind: string;
    readonly epistemicState: string;
    readonly observability: string;
    readonly authorityKinds: readonly string[];
    readonly sourceIds: readonly string[];
    readonly authorityAssertions: readonly {
      readonly authorityId: string;
      readonly kind: string;
      readonly sourceId: string;
      readonly scope: string;
    }[];
    readonly applicability: Readonly<Record<string, boolean | number | string>>;
    readonly validTime: { readonly from: string; readonly to?: string };
    readonly recordedAt: string;
  }[];
  readonly evolutions: readonly {
    readonly evolutionRef: string;
    readonly kind: string;
    readonly predecessorRef: string;
    readonly successorRefs: readonly string[];
    readonly sourceIds: readonly string[];
    readonly recordedAt: string;
    readonly affectedMappingIds: readonly string[];
    readonly affectedLandscapeIds: readonly string[];
  }[];
}

interface DomainCoverageReport {
  readonly scopeId: string;
  readonly entries: readonly {
    readonly conceptRef: string;
    readonly inScope: boolean;
    readonly semanticStatus: string;
    readonly epistemicStatus: string;
    readonly observabilityStatus: string;
    readonly evaluationStatus: string;
  }[];
}

interface DomainClaimSelection {
  readonly claimRefs: readonly string[];
}

interface EvaluationClosureResult {
  readonly closureId: string;
  readonly digest: string;
  readonly status: "complete" | "refused";
  readonly blockers: readonly {
    readonly code: string;
    readonly ref: string;
  }[];
}

interface GraderValidationResult {
  readonly status: "validated" | "invalid";
  readonly closureDigest: string;
  readonly graderDigest: string;
  readonly cohortDigests: {
    readonly development: string;
    readonly calibration: string;
    readonly validation: string;
  };
  readonly evidenceDigest: string;
  readonly caseEvidence: readonly {
    readonly caseId: string;
    readonly cohort: "development" | "calibration" | "validation";
    readonly observationDigest: string;
    readonly expectedAtoms: Readonly<Record<string, string>>;
    readonly observedAtoms: Readonly<Record<string, string>>;
    readonly expectedOverall: string;
    readonly observedOverall: string;
  }[];
}

interface StoredDomainValidationRun {
  readonly runId: string;
  readonly runPath: string;
  readonly result: GraderValidationResult;
}

interface StoredQualificationArtifact {
  readonly digest: string;
  readonly path: string;
}

interface CuratorAuthorityVerificationRequestFixture {
  readonly provider: "cat-cafe";
  readonly candidateDigest: string;
  readonly authorId: string;
  readonly curatorId: string;
  readonly assignmentMessageId: string;
  readonly acceptanceMessageId: string;
}

interface DomainQualificationResult {
  readonly status: "qualified" | "unqualified";
  readonly freezeDigest: string;
  readonly curatorId: string;
  readonly curatorAttestation: {
    readonly schemaVersion: string;
    readonly attestationDigest: string;
    readonly provider: string;
    readonly candidateDigest: string;
    readonly curatorId: string;
    readonly assignmentMessageId: string;
    readonly acceptanceMessageId: string;
  };
  readonly evidenceDigest: string;
}

interface StoredIndependentQualificationRun extends StoredQualificationArtifact {
  readonly result: DomainQualificationResult;
}

interface DomainFirstCompiler {
  readonly compileDomainLandscapeDirectory: (root: string) => Promise<CompiledDomainLandscape>;
  readonly deriveDomainCoverageDirectory: (
    root: string,
    input: { readonly projectionId: string; readonly observationProfileId: string },
  ) => Promise<DomainCoverageReport>;
  readonly selectDomainClaimsDirectory: (
    root: string,
    input: { readonly validAt: string; readonly recordedAt: string },
  ) => Promise<DomainClaimSelection>;
  readonly compileEvaluationClosureDirectory: (
    root: string,
    input: { readonly closureId: string },
  ) => Promise<EvaluationClosureResult>;
  readonly validateDomainGraderDirectory: (root: string) => Promise<GraderValidationResult>;
  readonly writeDomainValidationRunDirectory: (
    root: string,
    outputRoot: string,
  ) => Promise<StoredDomainValidationRun>;
  readonly replayDomainValidationRunFile: (runPath: string) => Promise<GraderValidationResult>;
  readonly freezeDomainQualificationCandidateDirectory: (
    root: string,
    outputRoot: string,
    identity: { readonly authorId: string; readonly sourceRevision: string },
  ) => Promise<StoredQualificationArtifact>;
  readonly freezeIndependentQualificationCasesFile: (
    candidatePath: string,
    casesPath: string,
    outputRoot: string,
    verifier?: (request: CuratorAuthorityVerificationRequestFixture) => Promise<unknown>,
  ) => Promise<StoredQualificationArtifact>;
  readonly executeIndependentQualificationHoldout: (
    candidatePath: string,
    casesPath: string,
    freezePath: string,
    outputRoot: string,
  ) => Promise<StoredQualificationArtifact>;
  readonly unsealIndependentQualificationExpectationsFile: (
    executionPath: string,
    expectationsPath: string,
    outputRoot: string,
  ) => Promise<StoredQualificationArtifact>;
  readonly admitIndependentQualificationRun: (
    candidatePath: string,
    casesPath: string,
    freezePath: string,
    executionPath: string,
    expectationsPath: string,
    unsealPath: string,
    outputRoot: string,
    verifier?: (request: CuratorAuthorityVerificationRequestFixture) => Promise<unknown>,
  ) => Promise<StoredIndependentQualificationRun>;
  readonly replayIndependentQualificationRunFile: (
    runPath: string,
  ) => Promise<DomainQualificationResult>;
}

async function readYaml<T>(relativePath: string): Promise<T> {
  return parse(await readFile(new URL(relativePath, referenceRoot), "utf8")) as T;
}

async function readYamlFromDirectory<T>(root: string, relativePath: string): Promise<T> {
  return parse(await readFile(join(root, relativePath), "utf8")) as T;
}

async function readCohort(reference: CohortReference): Promise<{
  readonly cases: CohortCasesFixture;
  readonly expectations: CohortExpectationsFixture;
  readonly digest: string;
}> {
  const cases = await readYaml<CohortCasesFixture>(reference.cases_path);
  const expectations = await readYaml<CohortExpectationsFixture>(reference.expectations_path);
  return { cases, expectations, digest: canonicalJsonDigest({ cases, expectations }) };
}

async function expectedLandscapeClosure(root: string): Promise<{
  readonly digest: string;
  readonly sourceDigests: Readonly<Record<string, string>>;
  readonly moduleReleaseDigests: Readonly<Record<string, string>>;
}> {
  const landscape = await readYamlFromDirectory<LandscapeFixture>(root, "landscape.yaml");
  const sources = await readYamlFromDirectory<SourceFixture>(root, "sources/index.yaml");
  const modules = await Promise.all(
    landscape.module_releases.map((release) =>
      readYamlFromDirectory<ModuleFixture>(root, release.path),
    ),
  );
  const referencedSourceIds = new Set(
    modules.flatMap((module) => [
      ...module.claims.flatMap((claim) => [
        ...claim.source_ids,
        ...claim.authority_assertions.map((authority) => authority.source_id),
      ]),
      ...(module.evolutions ?? []).flatMap((evolution) => evolution.source_ids),
    ]),
  );
  const referencedSources = sources.sources.filter((source) =>
    referencedSourceIds.has(source.source_id),
  );
  const sourceDigests = Object.fromEntries(
    [...referencedSources]
      .sort((left, right) => left.source_id.localeCompare(right.source_id))
      .map((source) => [source.source_id, source.content_sha256]),
  );
  const moduleReleaseDigests = Object.fromEntries(
    [...landscape.module_releases]
      .sort((left, right) => left.module_id.localeCompare(right.module_id))
      .map((release) => [release.module_id, release.content_sha256]),
  );
  const digest = canonicalJsonDigest({
    landscape,
    moduleReleaseDigests,
    sourceSnapshots: [...referencedSources]
      .sort((left, right) => left.source_id.localeCompare(right.source_id))
      .map((source) => ({
        sourceId: source.source_id,
        kind: source.kind,
        title: source.title,
        path: source.path,
        contentSha256: source.content_sha256,
        recordedAt: source.recorded_at,
        license: source.license,
        provenance: source.provenance,
        authorityScopes: source.authority_scopes,
      })),
  });
  return { digest, sourceDigests, moduleReleaseDigests };
}

async function loadCompiler(): Promise<DomainFirstCompiler> {
  const compilerPath = "../../src/domain/index.js";
  return (await import(compilerPath)) as DomainFirstCompiler;
}

async function withReferenceCopy(run: (root: string) => Promise<void>): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), "domain-first-m0-"));
  const root = join(parent, "commerce-landscape");
  try {
    await cp(fileURLToPath(referenceRoot), root, { recursive: true });
    await run(root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function mutateYaml<T>(
  root: string,
  relativePath: string,
  mutate: (value: T) => void,
): Promise<void> {
  const path = join(root, relativePath);
  const value = parse(await readFile(path, "utf8")) as T;
  mutate(value);
  await writeFile(path, stringify(value, { lineWidth: 0 }), "utf8");
}

async function assertDomainError(run: Promise<unknown>, expectedCode: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { readonly code?: string }).code, expectedCode);
    return true;
  });
}

interface MutableModuleFixture {
  module_id: string;
  claims: {
    claim_id: string;
    statement: string;
    observability?: string;
    source_ids: string[];
    authority_assertions: { kind: string; source_id: string; scope: string }[];
    valid_time: { from: string; to?: string };
    recorded_at: string;
  }[];
  evolutions?: {
    evolution_id: string;
    impact: { affected_mapping_ids: string[]; affected_landscape_ids: string[] };
  }[];
}

interface MutableLandscapeFixture {
  module_releases: {
    module_id: string;
    version: string;
    path: string;
    content_sha256: string;
  }[];
  mappings: {
    mapping_id: string;
    from_ref: string;
    reviewers: string[];
  }[];
}

interface MutableProductContractsFixture {
  product_contracts: {
    contract_id: string;
    product: { jurisdiction: string };
    authority: { source_id: string; scope: string };
  }[];
}

interface MutableViewFixture {
  context: {
    jurisdiction: string;
    fulfillment_state: string;
  };
  selected_claim_refs: string[];
}

interface MutableEvaluationFixture {
  closure_expectations: {
    closure_id: string;
    expected_status: string;
    expected_blocker?: string;
    blocker_ref?: string;
  }[];
  observation_profiles: {
    observation_profile_id: string;
    bindings: { concept_ref: string; completeness: string; covers_refs: string[] }[];
  }[];
  validation_cohort_plan: Record<
    "development" | "calibration" | "validation",
    {
      cohort_id: string;
      cases_path: string;
      expectations_path: string;
      content_sha256: string;
    }
  >;
}

interface MutableCohortExpectationsFixture {
  expectations: {
    case_id: string;
    atoms: Record<string, string>;
    overall: string;
  }[];
}

interface MutableSourcesFixture {
  sources: {
    source_id: string;
    kind: string;
    path: string;
    content_sha256: string;
    recorded_at: string;
    license: string;
    provenance: string;
    authority_scopes: string[];
  }[];
}

async function refreshModuleDigest(root: string, modulePath: string): Promise<void> {
  const module = parse(await readFile(join(root, modulePath), "utf8")) as unknown;
  await mutateYaml<MutableLandscapeFixture>(root, "landscape.yaml", (landscape) => {
    const release = landscape.module_releases.find((entry) => entry.path === modulePath);
    assert.ok(release);
    release.content_sha256 = canonicalJsonDigest(module);
  });
}

async function refreshCohortDigest(
  root: string,
  cohortName: "development" | "calibration" | "validation",
): Promise<void> {
  const evaluation = await readYamlFromDirectory<MutableEvaluationFixture>(root, "evaluation.yaml");
  const reference = evaluation.validation_cohort_plan[cohortName];
  const cases = await readYamlFromDirectory<unknown>(root, reference.cases_path);
  const expectations = await readYamlFromDirectory<unknown>(root, reference.expectations_path);
  const digest = canonicalJsonDigest({ cases, expectations });
  await mutateYaml<MutableEvaluationFixture>(root, "evaluation.yaml", (fixture) => {
    fixture.validation_cohort_plan[cohortName].content_sha256 = digest;
  });
}

async function assertNegativeCaseDeclared(caseId: string, expectedError: string): Promise<void> {
  const fixtures = await readYaml<NegativeCasesFixture>("negative-cases.yaml");
  const fixture = fixtures.negative_cases.find((entry) => entry.case_id === caseId);
  assert.ok(fixture, caseId);
  assert.equal(fixture.expected_error, expectedError, caseId);
}

test("M0 Commerce reference corpus closes the approved semantic scenarios", async () => {
  const moduleFiles = (await readdir(new URL("modules/", referenceRoot))).sort();
  assert.deepEqual(moduleFiles, [
    "commerce.orders.yaml",
    "consumer.remedies.cn.yaml",
    "finance.ledger.yaml",
    "payments.disputes.yaml",
    "payments.refunds.yaml",
    "promotions.coupons.yaml",
    "provider-x.payments.refunds.yaml",
  ]);

  const modules = await Promise.all(
    moduleFiles.map((name) => readYaml<ModuleFixture>(`modules/${name}`)),
  );
  assert.deepEqual(modules.map((module) => module.module_id).sort(), [
    "commerce.orders",
    "consumer.remedies.cn",
    "finance.ledger",
    "payments.disputes",
    "payments.refunds",
    "promotions.coupons",
    "provider-x.payments.refunds",
  ]);

  const sources = await readYaml<SourceFixture>("sources/index.yaml");
  assert.equal(new Set(sources.sources.map((source) => source.source_id)).size, 10);
  assert.equal(new Set(sources.sources.map((source) => source.path)).size, 10);
  for (const source of sources.sources) {
    const bytes = await readFile(new URL(`sources/${source.path}`, referenceRoot));
    assert.equal(sha256Hex(bytes), source.content_sha256, source.source_id);
    assert.ok(Number.isFinite(Date.parse(source.recorded_at)), source.source_id);
  }

  const landscape = await readYaml<LandscapeFixture>("landscape.yaml");
  assert.equal(landscape.landscape_id, "commerce-reference-cn");
  assert.equal(landscape.module_releases.length, modules.length);
  for (const release of landscape.module_releases) {
    const module = await readYaml<ModuleFixture>(release.path);
    assert.equal(module.module_id, release.module_id);
    assert.equal(module.release.version, release.version);
    assert.equal(canonicalJsonDigest(module), release.content_sha256);
  }

  assert.ok(
    landscape.mappings.some(
      (mapping) =>
        mapping.from_ref === "provider-x.payments.refunds#PayoutAttempt" &&
        mapping.relation === "realizes" &&
        mapping.to_ref === "payments.refunds#RefundExecution",
    ),
  );
  assert.ok(
    landscape.mappings.some(
      (mapping) =>
        mapping.from_ref === "payments.disputes#Chargeback" &&
        mapping.relation === "distinct_from" &&
        mapping.to_ref === "payments.refunds#CashRefund",
    ),
  );

  const claims = modules.flatMap((module) => module.claims);
  assert.ok(
    claims.some(
      (claim) => claim.epistemic_state === "confirmed" && claim.observability === "unobservable",
    ),
  );
  assert.ok(
    claims.some(
      (claim) => claim.epistemic_state === "contested" && claim.observability === "observable",
    ),
  );
  assert.ok(claims.some((claim) => claim.epistemic_state === "unknown"));

  const couponModule = modules.find((module) => module.module_id === "promotions.coupons");
  assert.ok(couponModule);
  assert.deepEqual(couponModule.evolutions, [
    {
      evolution_id: "coupon-restoration-semantics-split",
      kind: "split",
      predecessor_ref: "CouponRestorationLegacy",
      successor_refs: ["CouponRestoration", "CouponEligibilityReassessment"],
      source_ids: ["coupon-practice-original-expiry", "coupon-practice-current-eligibility"],
      recorded_at: "2026-08-31T00:00:00Z",
      impact: {
        affected_mapping_ids: ["cancellation-to-coupon-restoration"],
        affected_landscape_ids: ["commerce-reference-cn"],
      },
    },
  ]);

  const authorityKinds = new Set(
    claims.flatMap((claim) => claim.authority_assertions.map((authority) => authority.kind)),
  );
  assert.ok(authorityKinds.has("regulator"));
  assert.ok(authorityKinds.has("service_provider"));

  const lateClaim = claims.find((claim) => claim.claim_id === "legal-refund-deadline");
  assert.ok(lateClaim);
  assert.ok(Date.parse(lateClaim.valid_time.from) < Date.parse(lateClaim.recorded_at));
  const lateSource = sources.sources.find((source) => source.source_id === "cn-refund-regulation");
  assert.ok(lateSource);
  assert.equal(lateSource.recorded_at, lateClaim.recorded_at);
  assert.match(
    await readFile(new URL(`sources/${lateSource.path}`, referenceRoot), "utf8"),
    /Effective 2026-01-01/,
  );

  const scope = await readYaml<ScopeFixture>("scope.yaml");
  assert.deepEqual(scope.coverage_statuses, [
    "missing",
    "unknown",
    "contested",
    "unobservable",
    "out_of_scope",
  ]);
  assert.deepEqual(scope.anti_truncation, {
    concept_ref: "promotions.coupons#CouponRestoration",
    remains_in_scope_when_unobservable: true,
  });

  const view = await readYaml<ViewFixture>("view.yaml");
  assert.deepEqual(view.preserve_epistemic_states, ["unknown", "contested"]);
  assert.deepEqual(view.preserve_observability_states, ["partially_observable", "unobservable"]);

  const contracts = await readYaml<ProductContractsFixture>("product-contracts.yaml");
  assert.deepEqual(
    contracts.product_contracts.map((contract) => contract.contract_id),
    ["acme-cn-order-cancellation", "bravo-cn-order-cancellation"],
  );
  assert.ok(
    contracts.product_contracts.every((contract) => contract.authority.kind === "product_owner"),
  );
  assert.deepEqual(contracts.product_contracts[0]?.commitments[0]?.deadline, {
    value: 24,
    unit: "hour",
  });
  assert.equal(contracts.product_contracts[0]?.commitments[1]?.required, true);
  assert.deepEqual(contracts.product_contracts[1]?.commitments[0]?.deadline, {
    value: 3,
    unit: "business_day",
  });
  assert.equal(contracts.product_contracts[1]?.commitments[1]?.required, false);

  const evaluation = await readYaml<EvaluationFixture>("evaluation.yaml");
  assert.deepEqual(evaluation.episode.identities, {
    order_id: "order-100",
    refund_instruction_id: "refund-instruction-100",
    provider_refund_id: "provider-refund-100",
    coupon_entitlement_id: "coupon-entitlement-100",
    ledger_reconciliation_id: "ledger-reconciliation-100",
  });
  assert.deepEqual(
    evaluation.projections.map((projection) => projection.projection_id),
    ["acme-full-value-restoration", "acme-cash-refund-only"],
  );
  assert.deepEqual(
    evaluation.grade_atoms.map((grade) => grade.grade_id),
    [
      "cash-amount-and-original-tender",
      "cash-refund-timeliness",
      "coupon-entitlement-restoration",
      "economic-effect-exactly-once",
      "ledger-reconciliation",
    ],
  );
  assert.ok(
    evaluation.grade_atoms.every(
      (grade) =>
        grade.utility_claim.length > 0 &&
        grade.estimator.predicate_id.length > 0 &&
        grade.estimator.input_fields.length > 0 &&
        grade.validity_bounds.length > 0 &&
        grade.consumer.role.length > 0 &&
        grade.consumer.action.length > 0 &&
        grade.calibration_plan.development_cohort_ref === "domain-first-development" &&
        grade.calibration_plan.calibration_cohort_ref === "domain-first-calibration" &&
        grade.calibration_plan.validation_cohort_ref === "domain-first-public-validation" &&
        grade.repeatability_contract.mode === "artifact-only" &&
        grade.repeatability_contract.allowed_variance === "zero" &&
        grade.repeatability_contract.frozen_inputs.length > 0,
    ),
  );
  assert.ok(
    evaluation.observation_profiles.every(
      (profile) =>
        profile.time_semantics.business_time_field === "settled_after_hours" &&
        profile.time_semantics.observation_time_field === "recorded_after_hours" &&
        profile.time_semantics.allowed_lateness.value === 24 &&
        profile.time_semantics.allowed_lateness.unit === "hour" &&
        profile.absence_semantics.complete_channel_absence === "fail" &&
        profile.absence_semantics.unavailable_channel_absence === "insufficient_evidence",
    ),
  );
  assert.deepEqual(evaluation.verdict_policy, {
    preserve_atomic_vector: true,
    precedence: ["fail", "indeterminate", "insufficient_evidence", "pass", "not_applicable"],
  });
  assert.ok(
    evaluation.closure_expectations.some((closure) => closure.expected_status === "complete"),
  );
  assert.ok(
    evaluation.closure_expectations.some(
      (closure) =>
        closure.expected_status === "refused" &&
        closure.expected_blocker === "observation_completeness_gap" &&
        closure.blocker_ref === "promotions.coupons#CouponRestoration",
    ),
  );
  assert.equal(evaluation.validation_cohort_plan.cohorts_must_be_disjoint, true);
  const { retired_holdout_observation_digests: retiredDigests, ...qualificationProtocol } =
    evaluation.qualification_protocol;
  assert.deepEqual(qualificationProtocol, {
    candidate_freeze_schema: "domain-first-qualification-candidate-v0",
    curator_freeze_schema: "domain-first-holdout-freeze-v0",
    execution_schema: "domain-first-holdout-execution-v0",
    unseal_schema: "domain-first-holdout-unseal-v0",
    independent_curator_required: true,
  });
  assert.equal(retiredDigests.length, 12);
  assert.equal(new Set(retiredDigests).size, 12);
  assert.ok(retiredDigests.every((digest) => /^[0-9a-f]{64}$/.test(digest)));
  const cohortReferences = [
    ["development", evaluation.validation_cohort_plan.development],
    ["calibration", evaluation.validation_cohort_plan.calibration],
    ["validation", evaluation.validation_cohort_plan.validation],
  ] as const;
  assert.equal(new Set(cohortReferences.map(([, cohort]) => cohort.cohort_id)).size, 3);
  const cohortCaseIds = new Set<string>();
  for (const [cohortName, cohortReference] of cohortReferences) {
    const cohort = await readCohort(cohortReference);
    assert.equal(cohort.cases.cohort_id, cohortReference.cohort_id);
    assert.equal(cohort.expectations.cohort_id, cohortReference.cohort_id);
    if (cohortName === "validation") {
      assert.equal(cohort.expectations.reference_expectations, true);
      assert.equal(cohort.expectations.authored_independently, undefined);
    } else {
      assert.equal(cohort.expectations.authored_independently, true);
    }
    assert.equal(cohort.digest, cohortReference.content_sha256);
    assert.deepEqual(
      cohort.expectations.expectations.map((entry) => entry.case_id).sort(),
      cohort.cases.cases.map((entry) => entry.case_id).sort(),
    );
    for (const entry of cohort.cases.cases) {
      assert.equal(cohortCaseIds.has(entry.case_id), false, entry.case_id);
      cohortCaseIds.add(entry.case_id);
    }
  }
  const calibration = await readCohort(evaluation.validation_cohort_plan.calibration);
  assert.ok(
    calibration.cases.cases.some(
      (entry) =>
        entry.kind === "equivalent" &&
        entry.observations.provider_attempts === 3 &&
        entry.observations.successful_economic_effects === 1,
    ),
  );
  assert.ok(
    calibration.expectations.expectations.some(
      (entry) =>
        entry.case_id === "calibration-mutant-double-refund" &&
        entry.atoms["economic-effect-exactly-once"] === "fail",
    ),
  );

  const negatives = await readYaml<NegativeCasesFixture>("negative-cases.yaml");
  assert.deepEqual(
    new Set(negatives.negative_cases.map((entry) => entry.expected_error)),
    new Set([
      "authority_scope_mismatch",
      "claim_axes_incomplete",
      "module_identity_mismatch",
      "floating_release_reference",
      "projection_scope_truncation",
      "insufficient_evidence_required",
    ]),
  );
});

test("internal Domain-First compiler consumes the exact M0 reference Landscape", async () => {
  const compiler = await loadCompiler();
  const root = fileURLToPath(referenceRoot);
  const compiled = await compiler.compileDomainLandscapeDirectory(root);
  const repeated = await compiler.compileDomainLandscapeDirectory(root);
  const expectedClosure = await expectedLandscapeClosure(root);
  assert.equal(compiled.landscapeId, "commerce-reference-cn");
  assert.equal(compiled.version, "0.1.0");
  assert.equal(compiled.digest, expectedClosure.digest);
  assert.equal(repeated.digest, compiled.digest);
  assert.equal(compiled.moduleReleaseCount, 7);
  assert.equal(compiled.mappingCount, 6);
  assert.equal(compiled.sourceSnapshotCount, 8);
  assert.deepEqual(compiled.sourceDigests, expectedClosure.sourceDigests);
  assert.equal(compiled.sourceSnapshots.length, 8);
  assert.ok(
    compiled.sourceSnapshots.every(
      (source) =>
        source.provenance === "repository-authored synthetic source" &&
        source.license === "CC0-1.0",
    ),
  );
  assert.deepEqual(compiled.moduleReleaseDigests, expectedClosure.moduleReleaseDigests);
  assert.equal(compiled.modules.length, 7);
  const compiledCouponModule = compiled.modules.find(
    (module) => module.moduleId === "promotions.coupons",
  );
  assert.ok(compiledCouponModule);
  assert.equal(
    compiledCouponModule.contentSha256,
    expectedClosure.moduleReleaseDigests["promotions.coupons"],
  );
  assert.ok(
    compiledCouponModule.concepts.some(
      (concept) => concept.conceptRef === "promotions.coupons#CouponEligibilityReassessment",
    ),
  );
  assert.deepEqual(
    compiled.mappings.find(
      (mapping) => mapping.mappingId === "provider-attempt-realizes-refund-execution",
    ),
    {
      mappingId: "provider-attempt-realizes-refund-execution",
      version: "1.0.0",
      fromRef: "provider-x.payments.refunds#PayoutAttempt",
      relation: "realizes",
      toRef: "payments.refunds#RefundExecution",
      scope: "Provider X API v3",
      required: true,
      reviewerIds: ["provider-x", "payments-community"],
    },
  );
  assert.deepEqual(compiled.authorityKinds, [
    "industry_expert",
    "industry_standard",
    "internal_finance_owner",
    "payment_network",
    "regulator",
    "service_provider",
  ]);
  assert.ok(
    compiled.claims.some(
      (claim) => claim.epistemicState === "confirmed" && claim.observability === "unobservable",
    ),
  );
  assert.ok(
    compiled.claims.some(
      (claim) => claim.epistemicState === "contested" && claim.observability === "observable",
    ),
  );
  assert.ok(
    compiled.claims.some((claim) => {
      if (claim.claimRef !== "consumer.remedies.cn#legal-refund-deadline") return false;
      assert.deepEqual(claim.sourceIds, ["cn-refund-regulation"]);
      assert.deepEqual(claim.validTime, { from: "2026-01-01T00:00:00Z" });
      assert.equal(claim.recordedAt, "2026-02-01T00:00:00Z");
      assert.deepEqual(claim.applicability, { jurisdiction: "CN", customer_type: "consumer" });
      assert.deepEqual(claim.authorityAssertions, [
        {
          authorityId: "cn-regulator-authority",
          kind: "regulator",
          sourceId: "cn-refund-regulation",
          scope: "cn.consumer-refund-duty",
        },
      ]);
      return claim.authorityKinds.includes("regulator");
    }),
  );
  assert.ok(
    compiled.claims.some(
      (claim) =>
        claim.claimRef === "provider-x.payments.refunds#provider-x-idempotent-economic-effect" &&
        claim.authorityKinds.includes("service_provider"),
    ),
  );
  assert.deepEqual(compiled.evolutions, [
    {
      evolutionRef: "promotions.coupons#coupon-restoration-semantics-split",
      kind: "split",
      predecessorRef: "promotions.coupons#CouponRestorationLegacy",
      successorRefs: [
        "promotions.coupons#CouponRestoration",
        "promotions.coupons#CouponEligibilityReassessment",
      ],
      sourceIds: ["coupon-practice-original-expiry", "coupon-practice-current-eligibility"],
      recordedAt: "2026-08-31T00:00:00Z",
      affectedMappingIds: ["cancellation-to-coupon-restoration"],
      affectedLandscapeIds: ["commerce-reference-cn"],
    },
  ]);

  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { readonly exports?: Readonly<Record<string, unknown>> };
  assert.equal(manifest.exports?.["./domain"], undefined);
  const typesConfig = JSON.parse(
    await readFile(new URL("../../tsconfig.types.json", import.meta.url), "utf8"),
  ) as { readonly exclude?: readonly string[] };
  assert.deepEqual(typesConfig.exclude, ["src/domain/**/*.ts"]);
  const buildSource = await readFile(new URL("../../build.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(buildSource, /["']domain["']\s*:/);

  await withReferenceCopy(async (root) => {
    await rm(join(root, "product-contracts.yaml"));
    const upstreamOnly = await compiler.compileDomainLandscapeDirectory(root);
    assert.equal(upstreamOnly.digest, compiled.digest);
  });
});

test("M1 binds source snapshots, Claim references and module release pins", async () => {
  const compiler = await loadCompiler();

  await withReferenceCopy(async (root) => {
    const path = join(root, "sources/provider-x-contract.md");
    await writeFile(path, `${await readFile(path, "utf8")}\nDrifted bytes.\n`, "utf8");
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "source_content_digest_mismatch",
    );
  });

  await withReferenceCopy(async (root) => {
    const modulePath = "modules/commerce.orders.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find(
        (entry) => entry.claim_id === "pre-handoff-cancellation-eligibility",
      );
      assert.ok(claim);
      claim.source_ids.push("missing-source");
    });
    await refreshModuleDigest(root, modulePath);
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "unknown_source_reference",
    );
  });

  await withReferenceCopy(async (root) => {
    const modulePath = "modules/provider-x.payments.refunds.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find(
        (entry) => entry.claim_id === "provider-x-idempotent-economic-effect",
      );
      assert.ok(claim?.authority_assertions[0]);
      claim.authority_assertions[0].source_id = "missing-authority-source";
    });
    await refreshModuleDigest(root, modulePath);
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "unknown_authority_source_reference",
    );
  });

  await withReferenceCopy(async (root) => {
    const modulePath = "modules/payments.refunds.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find((entry) => entry.claim_id === "cash-refund-original-tender");
      assert.ok(claim);
      claim.statement = `${claim.statement} Drifted.`;
    });
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "module_content_digest_mismatch",
    );
  });
});

test("M1 closure digest is stable and changes with governed source or module content", async () => {
  const compiler = await loadCompiler();
  const baseline = await compiler.compileDomainLandscapeDirectory(fileURLToPath(referenceRoot));

  await withReferenceCopy(async (root) => {
    const sourcePath = join(root, "sources/provider-x-contract.md");
    await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\nClarified.\n`, "utf8");
    const sourceDigest = sha256Hex(await readFile(sourcePath));
    await mutateYaml<MutableSourcesFixture>(root, "sources/index.yaml", (sources) => {
      const source = sources.sources.find((entry) => entry.source_id === "provider-x-contract");
      assert.ok(source);
      source.content_sha256 = sourceDigest;
    });
    const changed = await compiler.compileDomainLandscapeDirectory(root);
    assert.notEqual(changed.digest, baseline.digest);
    assert.equal(changed.digest, (await expectedLandscapeClosure(root)).digest);
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableSourcesFixture>(root, "sources/index.yaml", (sources) => {
      const source = sources.sources.find((entry) => entry.source_id === "provider-x-contract");
      assert.ok(source);
      source.license = "MIT";
    });
    const changedMetadata = await compiler.compileDomainLandscapeDirectory(root);
    assert.notEqual(changedMetadata.digest, baseline.digest);
    assert.equal(changedMetadata.digest, (await expectedLandscapeClosure(root)).digest);
  });

  await withReferenceCopy(async (root) => {
    const modulePath = "modules/payments.refunds.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find((entry) => entry.claim_id === "cash-refund-original-tender");
      assert.ok(claim);
      claim.statement = `${claim.statement} Clarified.`;
    });
    await refreshModuleDigest(root, modulePath);
    const changed = await compiler.compileDomainLandscapeDirectory(root);
    assert.notEqual(changed.digest, baseline.digest);
    assert.equal(changed.digest, (await expectedLandscapeClosure(root)).digest);
  });

  await withReferenceCopy(async (root) => {
    const sourcePath = join(root, "sources/acme-policy.md");
    await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\nClarified.\n`, "utf8");
    const sourceDigest = sha256Hex(await readFile(sourcePath));
    await mutateYaml<MutableSourcesFixture>(root, "sources/index.yaml", (sources) => {
      const source = sources.sources.find((entry) => entry.source_id === "acme-policy");
      assert.ok(source);
      source.content_sha256 = sourceDigest;
    });
    const changedProductPolicy = await compiler.compileDomainLandscapeDirectory(root);
    assert.equal(changedProductPolicy.digest, baseline.digest);
    assert.equal(changedProductPolicy.sourceDigests["acme-policy"], undefined);
  });
});

test("M1 rejects scoped authority substitution and incomplete Claim axes", async () => {
  const compiler = await loadCompiler();

  for (const [caseId, authorityKind] of [
    ["provider-authority-cannot-confirm-law", "service_provider"],
    ["product-owner-cannot-confirm-law", "product_owner"],
  ] as const) {
    await assertNegativeCaseDeclared(caseId, "authority_scope_mismatch");
    await withReferenceCopy(async (root) => {
      const modulePath = "modules/consumer.remedies.cn.yaml";
      await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
        const claim = module.claims.find((entry) => entry.claim_id === "legal-refund-deadline");
        assert.ok(claim?.authority_assertions[0]);
        claim.authority_assertions[0].kind = authorityKind;
      });
      await refreshModuleDigest(root, modulePath);
      await assertDomainError(
        compiler.compileDomainLandscapeDirectory(root),
        "authority_scope_mismatch",
      );
    });
  }

  await assertNegativeCaseDeclared("claim-axes-must-remain-independent", "claim_axes_incomplete");
  await withReferenceCopy(async (root) => {
    const modulePath = "modules/finance.ledger.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find((entry) => entry.claim_id === "settled-refund-reconciled");
      assert.ok(claim);
      delete claim.observability;
    });
    await refreshModuleDigest(root, modulePath);
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "claim_axes_incomplete",
    );
  });

  await withReferenceCopy(async (root) => {
    const modulePath = "modules/payments.refunds.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find((entry) => entry.claim_id === "cash-refund-original-tender");
      assert.ok(claim?.authority_assertions[0]);
      claim.authority_assertions[0].scope = "ungranted.payments.scope";
    });
    await refreshModuleDigest(root, modulePath);
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "authority_scope_mismatch",
    );
  });
});

test("M1 represents implementation artifacts with maintainer-scoped authority", async () => {
  const compiler = await loadCompiler();
  const sourceId = "provider-x-contract";
  const modulePath = "modules/provider-x.payments.refunds.yaml";
  const claimId = "provider-x-idempotent-economic-effect";

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableSourcesFixture>(root, "sources/index.yaml", (sources) => {
      const source = sources.sources.find((entry) => entry.source_id === sourceId);
      assert.ok(source);
      source.kind = "implementation_artifact";
    });
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find((entry) => entry.claim_id === claimId);
      assert.ok(claim?.authority_assertions[0]);
      claim.authority_assertions[0].kind = "implementation_maintainer";
    });
    await refreshModuleDigest(root, modulePath);

    const compiled = await compiler.compileDomainLandscapeDirectory(root);
    assert.equal(compiled.digest, (await expectedLandscapeClosure(root)).digest);
    assert.ok(compiled.authorityKinds.includes("implementation_maintainer"));
    assert.equal(
      compiled.sourceSnapshots.find((source) => source.sourceId === sourceId)?.kind,
      "implementation_artifact",
    );
    assert.deepEqual(
      compiled.claims.find((claim) => claim.claimRef === `provider-x.payments.refunds#${claimId}`)
        ?.authorityKinds,
      ["implementation_maintainer"],
    );
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableSourcesFixture>(root, "sources/index.yaml", (sources) => {
      const source = sources.sources.find((entry) => entry.source_id === sourceId);
      assert.ok(source);
      source.kind = "implementation_artifact";
    });
    await refreshModuleDigest(root, modulePath);

    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "authority_scope_mismatch",
    );
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find((entry) => entry.claim_id === claimId);
      assert.ok(claim?.authority_assertions[0]);
      claim.authority_assertions[0].kind = "implementation_maintainer";
    });
    await refreshModuleDigest(root, modulePath);

    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "authority_scope_mismatch",
    );
  });
});

test("M1 binds Claim valid and recorded time to source and Release evidence", async () => {
  const compiler = await loadCompiler();

  await withReferenceCopy(async (root) => {
    const modulePath = "modules/provider-x.payments.refunds.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find(
        (entry) => entry.claim_id === "provider-x-idempotent-economic-effect",
      );
      assert.ok(claim);
      claim.recorded_at = "2026-08-30T00:00:00Z";
    });
    await refreshModuleDigest(root, modulePath);
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "claim_precedes_source_evidence",
    );
  });

  await withReferenceCopy(async (root) => {
    const modulePath = "modules/payments.refunds.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const claim = module.claims.find((entry) => entry.claim_id === "cash-refund-original-tender");
      assert.ok(claim);
      claim.valid_time.to = "2025-12-31T00:00:00Z";
    });
    await refreshModuleDigest(root, modulePath);
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "invalid_claim_valid_time",
    );
  });
});

test("M1 rejects identity collapse and floating releases", async () => {
  const compiler = await loadCompiler();

  await assertNegativeCaseDeclared(
    "provider-and-community-identities-must-not-collapse",
    "module_identity_mismatch",
  );
  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableLandscapeFixture>(root, "landscape.yaml", (landscape) => {
      const provider = landscape.module_releases.find(
        (entry) => entry.module_id === "provider-x.payments.refunds",
      );
      assert.ok(provider);
      provider.module_id = "payments.refunds";
    });
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "module_identity_mismatch",
    );
  });

  await assertNegativeCaseDeclared(
    "floating-module-release-is-forbidden",
    "floating_release_reference",
  );
  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableLandscapeFixture>(root, "landscape.yaml", (landscape) => {
      const refunds = landscape.module_releases.find(
        (entry) => entry.module_id === "payments.refunds",
      );
      assert.ok(refunds);
      refunds.version = "latest";
    });
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "floating_release_reference",
    );
  });
});

test("M1 retains explicit evolution lineage and validates its downstream impact", async () => {
  const compiler = await loadCompiler();
  await withReferenceCopy(async (root) => {
    const modulePath = "modules/promotions.coupons.yaml";
    await mutateYaml<MutableModuleFixture>(root, modulePath, (module) => {
      const evolution = module.evolutions?.find(
        (entry) => entry.evolution_id === "coupon-restoration-semantics-split",
      );
      assert.ok(evolution);
      evolution.impact.affected_mapping_ids = [];
    });
    await refreshModuleDigest(root, modulePath);
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "evolution_impact_mismatch",
    );
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableLandscapeFixture>(root, "landscape.yaml", (landscape) => {
      const mapping = landscape.mappings.find(
        (entry) => entry.mapping_id === "cancellation-to-coupon-restoration",
      );
      assert.ok(mapping);
      mapping.from_ref = "commerce.orders#MissingConcept";
    });
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "unresolved_required_mapping",
    );
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableLandscapeFixture>(root, "landscape.yaml", (landscape) => {
      const mapping = landscape.mappings.find(
        (entry) => entry.mapping_id === "cancellation-to-coupon-restoration",
      );
      assert.ok(mapping);
      mapping.reviewers = ["unrelated-actor"];
    });
    await assertDomainError(
      compiler.compileDomainLandscapeDirectory(root),
      "mapping_reviewer_scope_mismatch",
    );
  });
});

test("M2 Coverage cannot be improved by narrowing an Eval Projection", async () => {
  await assertNegativeCaseDeclared(
    "projection-cannot-truncate-domain-coverage",
    "projection_scope_truncation",
  );
  const compiler = await loadCompiler();
  const coverage = await compiler.deriveDomainCoverageDirectory(fileURLToPath(referenceRoot), {
    projectionId: "acme-cash-refund-only",
    observationProfileId: "coupon-observation-gap",
  });
  assert.equal(coverage.scopeId, "paid-unshipped-order-cancellation");
  const coupon = coverage.entries.find(
    (entry) => entry.conceptRef === "promotions.coupons#CouponRestoration",
  );
  assert.ok(coupon);
  assert.equal(coupon.inScope, true);
  assert.equal(coupon.semanticStatus, "described");
  assert.equal(coupon.epistemicStatus, "contested");
  assert.equal(coupon.observabilityStatus, "unobservable");
  assert.equal(coupon.evaluationStatus, "excluded");
  const missing = coverage.entries.find(
    (entry) => entry.conceptRef === "payments.refunds#RefundReceipt",
  );
  assert.ok(missing);
  assert.equal(missing.inScope, true);
  assert.equal(missing.semanticStatus, "missing");
  assert.equal(missing.epistemicStatus, "unknown");
  const describedUnknown = coverage.entries.find(
    (entry) => entry.conceptRef === "commerce.orders#Order",
  );
  assert.ok(describedUnknown);
  assert.equal(describedUnknown.semanticStatus, "described");
  assert.equal(describedUnknown.epistemicStatus, "unknown");
  assert.ok(
    coverage.entries.some(
      (entry) =>
        entry.conceptRef === "fraud-investigation" &&
        entry.semanticStatus === "out_of_scope" &&
        entry.inScope === false,
    ),
  );
});

test("M2 bitemporal replay separates valid time from recorded knowledge", async () => {
  const compiler = await loadCompiler();
  const beforeRecord = await compiler.selectDomainClaimsDirectory(fileURLToPath(referenceRoot), {
    validAt: "2026-01-15T00:00:00Z",
    recordedAt: "2026-01-15T00:00:00Z",
  });
  assert.equal(
    beforeRecord.claimRefs.includes("consumer.remedies.cn#legal-refund-deadline"),
    false,
  );

  const afterRecord = await compiler.selectDomainClaimsDirectory(fileURLToPath(referenceRoot), {
    validAt: "2026-01-15T00:00:00Z",
    recordedAt: "2026-02-02T00:00:00Z",
  });
  assert.equal(afterRecord.claimRefs.includes("consumer.remedies.cn#legal-refund-deadline"), true);
});

test("M3 Closure distinguishes unavailable observation from missing binding", async () => {
  await assertNegativeCaseDeclared(
    "absent-coupon-record-is-not-failure-with-gap",
    "insufficient_evidence_required",
  );
  const compiler = await loadCompiler();
  const complete = await compiler.compileEvaluationClosureDirectory(fileURLToPath(referenceRoot), {
    closureId: "acme-full-value-complete",
  });
  assert.equal(complete.status, "complete");
  assert.match(complete.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(complete.blockers, []);

  const refused = await compiler.compileEvaluationClosureDirectory(fileURLToPath(referenceRoot), {
    closureId: "acme-full-value-coupon-gap",
  });
  assert.equal(refused.status, "refused");
  assert.match(refused.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(refused.blockers, [
    {
      code: "observation_completeness_gap",
      ref: "promotions.coupons#CouponRestoration",
    },
  ]);

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableEvaluationFixture>(root, "evaluation.yaml", (evaluation) => {
      const profile = evaluation.observation_profiles.find(
        (entry) => entry.observation_profile_id === "complete-reference-observation",
      );
      assert.ok(profile);
      profile.bindings = profile.bindings.filter(
        (binding) => binding.concept_ref !== "promotions.coupons#CouponRestoration",
      );
      const declaration = evaluation.closure_expectations.find(
        (entry) => entry.closure_id === "acme-full-value-complete",
      );
      assert.ok(declaration);
      declaration.expected_status = "refused";
      declaration.expected_blocker = "observation_binding_missing";
      declaration.blocker_ref = "promotions.coupons#CouponRestoration";
    });
    const missingBinding = await compiler.compileEvaluationClosureDirectory(root, {
      closureId: "acme-full-value-complete",
    });
    assert.equal(missingBinding.status, "refused");
    assert.deepEqual(missingBinding.blockers, [
      {
        code: "observation_binding_missing",
        ref: "promotions.coupons#CouponRestoration",
      },
    ]);
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableEvaluationFixture>(root, "evaluation.yaml", (evaluation) => {
      const profile = evaluation.observation_profiles.find(
        (entry) => entry.observation_profile_id === "complete-reference-observation",
      );
      const financeBinding = profile?.bindings.find(
        (binding) => binding.concept_ref === "finance.ledger#LedgerReconciliation",
      );
      assert.ok(financeBinding);
      financeBinding.covers_refs.push("promotions.coupons#CouponRestoration");
    });
    await assertDomainError(
      compiler.compileEvaluationClosureDirectory(root, {
        closureId: "acme-full-value-complete",
      }),
      "invalid_domain_evaluation",
    );
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableEvaluationFixture>(root, "evaluation.yaml", (evaluation) => {
      const declaration = evaluation.closure_expectations.find(
        (entry) => entry.closure_id === "acme-full-value-complete",
      );
      assert.ok(declaration);
      declaration.expected_status = "refused";
      declaration.expected_blocker = "invented_blocker";
      declaration.blocker_ref = "promotions.coupons#CouponRestoration";
    });
    await assertDomainError(
      compiler.compileEvaluationClosureDirectory(root, {
        closureId: "acme-full-value-complete",
      }),
      "closure_expectation_mismatch",
    );
  });

  await withReferenceCopy(async (root) => {
    const sourcePath = join(root, "sources/acme-policy.md");
    await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\nClarified.\n`, "utf8");
    const sourceDigest = sha256Hex(await readFile(sourcePath));
    await mutateYaml<MutableSourcesFixture>(root, "sources/index.yaml", (sources) => {
      const source = sources.sources.find((entry) => entry.source_id === "acme-policy");
      assert.ok(source);
      source.content_sha256 = sourceDigest;
    });
    const changedProductClosure = await compiler.compileEvaluationClosureDirectory(root, {
      closureId: "acme-full-value-complete",
    });
    assert.notEqual(changedProductClosure.digest, complete.digest);
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableProductContractsFixture>(
      root,
      "product-contracts.yaml",
      (contracts) => {
        const contract = contracts.product_contracts.find(
          (entry) => entry.contract_id === "acme-cn-order-cancellation",
        );
        assert.ok(contract);
        contract.authority.source_id = "missing-product-authority-source";
      },
    );
    await assertDomainError(
      compiler.compileEvaluationClosureDirectory(root, {
        closureId: "acme-full-value-complete",
      }),
      "unknown_authority_source_reference",
    );
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableProductContractsFixture>(
      root,
      "product-contracts.yaml",
      (contracts) => {
        const contract = contracts.product_contracts.find(
          (entry) => entry.contract_id === "acme-cn-order-cancellation",
        );
        assert.ok(contract);
        contract.product.jurisdiction = "US";
      },
    );
    await assertDomainError(
      compiler.compileEvaluationClosureDirectory(root, {
        closureId: "acme-full-value-complete",
      }),
      "product_contract_context_mismatch",
    );
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableViewFixture>(root, "view.yaml", (view) => {
      view.context.fulfillment_state = "after_handoff";
    });
    await assertDomainError(
      compiler.compileEvaluationClosureDirectory(root, {
        closureId: "acme-full-value-complete",
      }),
      "view_claim_applicability_mismatch",
    );
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableViewFixture>(root, "view.yaml", (view) => {
      view.selected_claim_refs = view.selected_claim_refs.filter(
        (claimRef) => claimRef !== "commerce.orders#cancellation-reason-copy",
      );
    });
    await assertDomainError(
      compiler.compileEvaluationClosureDirectory(root, {
        closureId: "acme-full-value-complete",
      }),
      "view_preservation_mismatch",
    );
  });
});

test("M4 public validation produces evidence from three disjoint visible cohorts", async () => {
  const compiler = await loadCompiler();
  const root = fileURLToPath(referenceRoot);
  const evaluation = await readYaml<EvaluationFixture>("evaluation.yaml");
  const completeClosure = await compiler.compileEvaluationClosureDirectory(root, {
    closureId: "acme-full-value-complete",
  });
  const validated = await compiler.validateDomainGraderDirectory(root);
  const replayed = await compiler.validateDomainGraderDirectory(root);
  assert.equal(validated.status, "validated");
  assert.equal(validated.closureDigest, completeClosure.digest);
  assert.equal(validated.graderDigest, canonicalJsonDigest(evaluation.grade_atoms));
  assert.deepEqual(replayed, validated);

  const cohortEntries = [
    ["development", evaluation.validation_cohort_plan.development],
    ["calibration", evaluation.validation_cohort_plan.calibration],
    ["validation", evaluation.validation_cohort_plan.validation],
  ] as const;
  const expectedCaseIds = new Set<string>();
  for (const [cohortName, reference] of cohortEntries) {
    const cohort = await readCohort(reference);
    assert.equal(validated.cohortDigests[cohortName], cohort.digest);
    for (const fixtureCase of cohort.cases.cases) {
      expectedCaseIds.add(fixtureCase.case_id);
      const expectation = cohort.expectations.expectations.find(
        (entry) => entry.case_id === fixtureCase.case_id,
      );
      assert.ok(expectation);
      const evidence = validated.caseEvidence.find((entry) => entry.caseId === fixtureCase.case_id);
      assert.ok(evidence);
      assert.equal(evidence.cohort, cohortName);
      assert.equal(evidence.observationDigest, canonicalJsonDigest(fixtureCase.observations));
      assert.deepEqual(evidence.expectedAtoms, expectation.atoms);
      assert.deepEqual(evidence.observedAtoms, expectation.atoms);
      assert.equal(evidence.expectedOverall, expectation.overall);
      assert.equal(evidence.observedOverall, expectation.overall);
    }
  }
  const completeButAbsentCoupon = validated.caseEvidence.find(
    (entry) => entry.caseId === "calibration-mutant-missing-coupon-record",
  );
  assert.ok(completeButAbsentCoupon);
  assert.equal(completeButAbsentCoupon.observedAtoms["coupon-entitlement-restoration"], "fail");
  const completeButAbsentCash = validated.caseEvidence.find(
    (entry) => entry.caseId === "calibration-mutant-missing-cash-record",
  );
  assert.ok(completeButAbsentCash);
  assert.equal(completeButAbsentCash.observedAtoms["cash-amount-and-original-tender"], "fail");
  const unavailableCoupon = validated.caseEvidence.find(
    (entry) => entry.caseId === "development-coupon-observation-gap",
  );
  assert.ok(unavailableCoupon);
  assert.equal(
    unavailableCoupon.observedAtoms["coupon-entitlement-restoration"],
    "insufficient_evidence",
  );
  assert.equal(validated.caseEvidence.length, expectedCaseIds.size);
  assert.deepEqual(new Set(validated.caseEvidence.map((entry) => entry.caseId)), expectedCaseIds);
  assert.equal(
    validated.evidenceDigest,
    canonicalJsonDigest({
      closureDigest: validated.closureDigest,
      graderDigest: validated.graderDigest,
      cohortDigests: validated.cohortDigests,
      caseEvidence: validated.caseEvidence,
    }),
  );

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableCohortExpectationsFixture>(
      root,
      "cohorts/calibration/expectations.yaml",
      (expectations) => {
        const mutant = expectations.expectations.find(
          (entry) => entry.case_id === "calibration-mutant-double-refund",
        );
        assert.ok(mutant);
        mutant.atoms = Object.fromEntries(
          Object.keys(mutant.atoms).map((gradeId) => [gradeId, "pass"]),
        );
        mutant.overall = "pass";
      },
    );
    await refreshCohortDigest(root, "calibration");
    const invalid = await compiler.validateDomainGraderDirectory(root);
    assert.equal(invalid.status, "invalid");
    const mutantEvidence = invalid.caseEvidence.find(
      (entry) => entry.caseId === "calibration-mutant-double-refund",
    );
    assert.ok(mutantEvidence);
    assert.equal(mutantEvidence.expectedOverall, "pass");
    assert.equal(mutantEvidence.observedOverall, "fail");
  });

  await withReferenceCopy(async (root) => {
    await mutateYaml<MutableCohortExpectationsFixture>(
      root,
      "cohorts/development/expectations.yaml",
      (expectations) => {
        const development = expectations.expectations.find(
          (entry) => entry.case_id === "development-happy-path",
        );
        assert.ok(development);
        development.atoms = Object.fromEntries(
          Object.keys(development.atoms).map((gradeId) => [gradeId, "fail"]),
        );
        development.overall = "fail";
      },
    );
    await refreshCohortDigest(root, "development");
    const developmentCannotAdmit = await compiler.validateDomainGraderDirectory(root);
    assert.equal(developmentCannotAdmit.status, "validated");
    const developmentEvidence = developmentCannotAdmit.caseEvidence.find(
      (entry) => entry.caseId === "development-happy-path",
    );
    assert.ok(developmentEvidence);
    assert.equal(developmentEvidence.expectedOverall, "fail");
    assert.equal(developmentEvidence.observedOverall, "pass");
  });
});

test("M4 persists and replays an immutable validation Run without source artifacts", async () => {
  const compiler = await loadCompiler();
  const fixtureParent = await mkdtemp(join(tmpdir(), "domain-first-run-input-"));
  const fixtureRoot = join(fixtureParent, "commerce-landscape");
  const outputRoot = await mkdtemp(join(tmpdir(), "domain-first-run-output-"));
  try {
    await cp(fileURLToPath(referenceRoot), fixtureRoot, { recursive: true });
    const stored = await compiler.writeDomainValidationRunDirectory(fixtureRoot, outputRoot);
    assert.match(stored.runId, /^[0-9a-f]{64}$/);
    assert.equal(stored.result.status, "validated");
    await rm(fixtureParent, { recursive: true, force: true });

    const replayed = await compiler.replayDomainValidationRunFile(stored.runPath);
    assert.deepEqual(replayed, stored.result);

    const tampered = JSON.parse(await readFile(stored.runPath, "utf8")) as {
      result: { status: string };
    };
    tampered.result.status = "invalid";
    await writeFile(stored.runPath, JSON.stringify(tampered), "utf8");
    await assertDomainError(
      compiler.replayDomainValidationRunFile(stored.runPath),
      "validation_run_digest_mismatch",
    );
  } finally {
    await rm(fixtureParent, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("M4 independent qualification protocol binds freeze, execution and later label unseal", async () => {
  const compiler = await loadCompiler();
  const fixtureParent = await mkdtemp(join(tmpdir(), "domain-first-qualification-input-"));
  const fixtureRoot = join(fixtureParent, "commerce-landscape");
  const curatorRoot = await mkdtemp(join(tmpdir(), "domain-first-curator-"));
  const artifactRoot = await mkdtemp(join(tmpdir(), "domain-first-qualification-artifacts-"));
  const replayRoot = await mkdtemp(join(tmpdir(), "domain-first-qualification-replay-"));
  const casesPath = join(curatorRoot, "cases.yaml");
  const expectationsPath = join(curatorRoot, "expectations.yaml");
  try {
    await cp(fileURLToPath(referenceRoot), fixtureRoot, { recursive: true });
    const candidate = await compiler.freezeDomainQualificationCandidateDirectory(
      fixtureRoot,
      artifactRoot,
      { authorId: "domain-grader-author", sourceRevision: "a".repeat(40) },
    );
    const verifier = async (request: CuratorAuthorityVerificationRequestFixture) => {
      if (
        request.assignmentMessageId.startsWith("nonexistent") ||
        request.acceptanceMessageId.startsWith("nonexistent")
      ) {
        throw new Error("message not found");
      }
      const payload = {
        schemaVersion: "domain-first-curator-attestation-v0",
        provider: "cat-cafe",
        candidateDigest: request.candidateDigest,
        curatorId: request.curatorId,
        assignmentMessageId: request.assignmentMessageId,
        acceptanceMessageId: request.acceptanceMessageId,
      };
      return { ...payload, attestationDigest: canonicalJsonDigest(payload) };
    };
    const cases = {
      schema_version: "domain-first-internal-v0",
      cohort_id: "independent-holdout",
      role: "qualification",
      curator_id: "independent-curator",
      curator_authority: {
        provider: "cat-cafe",
        assignment_message_id: "test-operator-assignment",
        acceptance_message_id: "test-curator-acceptance",
      },
      cases: [
        {
          case_id: "holdout-gold",
          kind: "gold",
          observations: {
            cash_amount: 80,
            original_tender: true,
            settled_after_hours: 20,
            recorded_after_hours: 101,
            provider_attempts: 1,
            successful_economic_effects: 1,
            coupon_restored: true,
            coupon_observation_complete: true,
            ledger_reconciled: true,
          },
        },
        {
          case_id: "holdout-equivalent-retries",
          kind: "equivalent",
          observations: {
            cash_amount: 80,
            original_tender: true,
            settled_after_hours: 20,
            recorded_after_hours: 102,
            provider_attempts: 5,
            successful_economic_effects: 1,
            coupon_restored: true,
            coupon_observation_complete: true,
            ledger_reconciled: true,
          },
        },
        {
          case_id: "holdout-mutant-late-settlement",
          kind: "mutant",
          observations: {
            cash_amount: 80,
            original_tender: true,
            settled_after_hours: 30,
            recorded_after_hours: 103,
            provider_attempts: 1,
            successful_economic_effects: 1,
            coupon_restored: true,
            coupon_observation_complete: true,
            ledger_reconciled: true,
          },
        },
      ],
    };
    await writeFile(casesPath, stringify(cases, { lineWidth: 0 }), "utf8");

    await assertDomainError(
      compiler.freezeIndependentQualificationCasesFile(candidate.path, casesPath, artifactRoot),
      "qualification_authority_verifier_required",
    );

    const invalidAuthorityPath = join(curatorRoot, "invalid-authority-cases.yaml");
    await writeFile(
      invalidAuthorityPath,
      stringify(
        {
          ...cases,
          curator_authority: {
            provider: "cat-cafe",
            assignment_message_id: "nonexistent-assignment",
            acceptance_message_id: "nonexistent-acceptance",
          },
        },
        { lineWidth: 0 },
      ),
      "utf8",
    );
    await assertDomainError(
      compiler.freezeIndependentQualificationCasesFile(
        candidate.path,
        invalidAuthorityPath,
        artifactRoot,
        verifier,
      ),
      "qualification_authority_verification_failed",
    );

    const sameAuthorCasesPath = join(curatorRoot, "same-author-cases.yaml");
    await writeFile(
      sameAuthorCasesPath,
      stringify({ ...cases, curator_id: "domain-grader-author" }, { lineWidth: 0 }),
      "utf8",
    );
    await assertDomainError(
      compiler.freezeIndependentQualificationCasesFile(
        candidate.path,
        sameAuthorCasesPath,
        artifactRoot,
        verifier,
      ),
      "qualification_curator_not_independent",
    );

    for (const [visibleCaseId, kind] of [
      ["calibration-gold-complete", "gold"],
      ["calibration-equivalent-provider-retries", "equivalent"],
      ["calibration-mutant-double-refund", "mutant"],
    ] as const) {
      const overlapPath = join(curatorRoot, `overlap-${kind}.yaml`);
      await writeFile(
        overlapPath,
        stringify(
          {
            ...cases,
            cohort_id: `overlap-${kind}`,
            cases: [{ ...cases.cases[0], case_id: visibleCaseId, kind }],
          },
          { lineWidth: 0 },
        ),
        "utf8",
      );
      await assertDomainError(
        compiler.freezeIndependentQualificationCasesFile(
          candidate.path,
          overlapPath,
          artifactRoot,
          verifier,
        ),
        "qualification_case_reuses_visible_identity",
      );
    }

    const publicCalibration = await readYaml<CohortCasesFixture>("cohorts/calibration/cases.yaml");
    for (const [index, kind] of ["gold", "equivalent", "mutant"].entries()) {
      const publicCase = publicCalibration.cases[index];
      assert.ok(publicCase);
      const overlapPath = join(curatorRoot, `observation-overlap-${kind}.yaml`);
      await writeFile(
        overlapPath,
        stringify(
          {
            ...cases,
            cohort_id: `observation-overlap-${kind}`,
            cases: [
              {
                case_id: `new-id-reusing-public-${kind}`,
                kind,
                observations: publicCase.observations,
              },
            ],
          },
          { lineWidth: 0 },
        ),
        "utf8",
      );
      await assertDomainError(
        compiler.freezeIndependentQualificationCasesFile(
          candidate.path,
          overlapPath,
          artifactRoot,
          verifier,
        ),
        "qualification_case_reuses_visible_observation",
      );
    }

    const freeze = await compiler.freezeIndependentQualificationCasesFile(
      candidate.path,
      casesPath,
      artifactRoot,
      verifier,
    );
    const execution = await compiler.executeIndependentQualificationHoldout(
      candidate.path,
      casesPath,
      freeze.path,
      artifactRoot,
    );

    const passAtoms = {
      "cash-amount-and-original-tender": "pass",
      "cash-refund-timeliness": "pass",
      "coupon-entitlement-restoration": "pass",
      "economic-effect-exactly-once": "pass",
      "ledger-reconciliation": "pass",
    };
    await writeFile(
      expectationsPath,
      stringify(
        {
          schema_version: "domain-first-internal-v0",
          cohort_id: "independent-holdout",
          curator_id: "independent-curator",
          expectations: [
            { case_id: "holdout-gold", atoms: passAtoms, overall: "pass" },
            {
              case_id: "holdout-equivalent-retries",
              atoms: passAtoms,
              overall: "pass",
            },
            {
              case_id: "holdout-mutant-late-settlement",
              atoms: { ...passAtoms, "cash-refund-timeliness": "fail" },
              overall: "fail",
            },
          ],
        },
        { lineWidth: 0 },
      ),
      "utf8",
    );
    const unseal = await compiler.unsealIndependentQualificationExpectationsFile(
      execution.path,
      expectationsPath,
      artifactRoot,
    );
    await assertDomainError(
      compiler.admitIndependentQualificationRun(
        candidate.path,
        casesPath,
        freeze.path,
        execution.path,
        expectationsPath,
        unseal.path,
        artifactRoot,
      ),
      "qualification_authority_verifier_required",
    );
    await assertDomainError(
      compiler.admitIndependentQualificationRun(
        candidate.path,
        casesPath,
        join(curatorRoot, "missing-freeze.json"),
        execution.path,
        expectationsPath,
        unseal.path,
        artifactRoot,
        verifier,
      ),
      "invalid_holdout_freeze",
    );
    const admitted = await compiler.admitIndependentQualificationRun(
      candidate.path,
      casesPath,
      freeze.path,
      execution.path,
      expectationsPath,
      unseal.path,
      artifactRoot,
      verifier,
    );
    assert.equal(admitted.result.status, "qualified");
    assert.equal(admitted.result.freezeDigest, freeze.digest);
    assert.equal(admitted.result.curatorId, "independent-curator");
    assert.equal(admitted.result.curatorAttestation.provider, "cat-cafe");
    assert.equal(
      admitted.result.curatorAttestation.assignmentMessageId,
      cases.curator_authority.assignment_message_id,
    );
    assert.match(admitted.result.evidenceDigest, /^[0-9a-f]{64}$/);

    const replayPath = join(replayRoot, "qualification-run.json");
    await cp(admitted.path, replayPath);
    await rm(fixtureParent, { recursive: true, force: true });
    await rm(curatorRoot, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
    assert.deepEqual(
      await compiler.replayIndependentQualificationRunFile(replayPath),
      admitted.result,
    );
  } finally {
    await rm(fixtureParent, { recursive: true, force: true });
    await rm(curatorRoot, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
    await rm(replayRoot, { recursive: true, force: true });
  }
});

test("Domain-First compiler chain cannot import Evaluator or Harness implementation", async () => {
  const domainRoot = new URL("../../src/domain/", import.meta.url);
  const entries = (await readdir(domainRoot, { recursive: true }))
    .filter((entry) => entry.endsWith(".ts"))
    .sort();
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    const source = await readFile(new URL(entry, domainRoot), "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*(?:evaluator|harness)[^"']*["']/i, entry);
  }
});
