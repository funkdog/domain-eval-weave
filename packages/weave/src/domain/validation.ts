import { canonicalJsonDigest } from "../canonical-json.js";
import { compileEvaluationClosureDirectory } from "./closure.js";
import {
  type CompiledDomainLandscape,
  compileDomainLandscapeDirectory,
  readDomainYaml,
  resolveDomainRoot,
} from "./compiler.js";
import {
  type CohortCases,
  type CohortExpectations,
  cohortCasesSchema,
  cohortExpectationsSchema,
  type DomainEvaluation,
  domainEvaluationSchema,
  domainViewSchema,
  productContractsSchema,
} from "./contracts.js";
import { DomainCompilerError } from "./errors.js";

export type GradeOutcome =
  | "pass"
  | "fail"
  | "not_applicable"
  | "insufficient_evidence"
  | "indeterminate";
type CohortName = "development" | "calibration" | "validation";
export type Observation = CohortCases["cases"][number]["observations"];
export type GradeAtom = DomainEvaluation["grade_atoms"][number];

export interface GraderCaseEvidence {
  readonly caseId: string;
  readonly cohort: CohortName;
  readonly observationDigest: string;
  readonly expectedAtoms: Readonly<Record<string, GradeOutcome>>;
  readonly observedAtoms: Readonly<Record<string, GradeOutcome>>;
  readonly expectedOverall: GradeOutcome;
  readonly observedOverall: GradeOutcome;
}

export interface GraderValidationResult {
  readonly status: "validated" | "invalid";
  readonly closureDigest: string;
  readonly graderDigest: string;
  readonly cohortDigests: Readonly<Record<CohortName, string>>;
  readonly evidenceDigest: string;
  readonly caseEvidence: readonly GraderCaseEvidence[];
}

export interface GraderContext {
  readonly expectedCash: number;
  readonly settlementDeadlineHours: number;
  readonly expectedEconomicEffects: number;
  readonly expectedLedgerBalanced: boolean;
  readonly completeChannelAbsence: GradeOutcome;
  readonly unavailableChannelAbsence: GradeOutcome;
}

interface LoadedCohort {
  readonly name: CohortName;
  readonly cases: CohortCases;
  readonly expectations: CohortExpectations;
  readonly digest: string;
}

const ALL_OUTCOMES = new Set<GradeOutcome>([
  "pass",
  "fail",
  "not_applicable",
  "insufficient_evidence",
  "indeterminate",
]);

const PREDICATE_INPUTS: Readonly<Record<string, readonly string[]>> = {
  "expected-cash-on-original-tender": ["cash_amount", "original_tender"],
  "settlement-within-24-hours": ["settled_after_hours"],
  "coupon-restored-with-complete-observation": ["coupon_restored", "coupon_observation_complete"],
  "one-successful-economic-effect": ["successful_economic_effects"],
  "ledger-reconciled": ["ledger_reconciled"],
};

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

function evaluateAtom(
  atom: GradeAtom,
  observations: Observation,
  context: GraderContext,
): GradeOutcome {
  if (observations.eligible === false) return "not_applicable";
  switch (atom.estimator.predicate_id) {
    case "expected-cash-on-original-tender": {
      if (!("cash_amount" in observations) || !("original_tender" in observations)) {
        return context.completeChannelAbsence;
      }
      const cashAmount = observations.cash_amount;
      const originalTender = observations.original_tender;
      if (typeof cashAmount !== "number" || typeof originalTender !== "boolean") {
        return "indeterminate";
      }
      return cashAmount === context.expectedCash && originalTender ? "pass" : "fail";
    }
    case "settlement-within-24-hours": {
      if (!("settled_after_hours" in observations)) return context.completeChannelAbsence;
      const settledAfterHours = observations.settled_after_hours;
      if (typeof settledAfterHours !== "number") return "indeterminate";
      return settledAfterHours <= context.settlementDeadlineHours ? "pass" : "fail";
    }
    case "coupon-restored-with-complete-observation": {
      const complete = observations.coupon_observation_complete;
      const restored = observations.coupon_restored;
      if (complete === false) return context.unavailableChannelAbsence;
      if (!("coupon_restored" in observations) || restored === null) {
        return context.completeChannelAbsence;
      }
      if (complete !== true) return "indeterminate";
      if (typeof restored !== "boolean") return "indeterminate";
      return restored ? "pass" : "fail";
    }
    case "one-successful-economic-effect": {
      if (!("successful_economic_effects" in observations)) {
        return context.completeChannelAbsence;
      }
      const effects = observations.successful_economic_effects;
      if (typeof effects !== "number") return "indeterminate";
      return effects === context.expectedEconomicEffects ? "pass" : "fail";
    }
    case "ledger-reconciled": {
      if (!("ledger_reconciled" in observations)) return context.completeChannelAbsence;
      const reconciled = observations.ledger_reconciled;
      if (typeof reconciled !== "boolean") return "indeterminate";
      return reconciled === context.expectedLedgerBalanced ? "pass" : "fail";
    }
    default:
      throw new DomainCompilerError(
        "unknown_grade_predicate",
        "Grade Atom references an unsupported deterministic predicate",
        atom.grade_id,
      );
  }
}

function composeOutcomes(
  outcomes: readonly GradeOutcome[],
  precedence: readonly GradeOutcome[],
): GradeOutcome {
  const result = precedence.find((outcome) => outcomes.includes(outcome));
  if (result === undefined) {
    throw new DomainCompilerError(
      "empty_grade_vector",
      "Grade composition requires at least one atomic outcome",
    );
  }
  return result;
}

export function executeGradeVector(
  gradeAtoms: readonly GradeAtom[],
  observations: Observation,
  context: GraderContext,
  precedence: readonly GradeOutcome[],
): {
  readonly atoms: Readonly<Record<string, GradeOutcome>>;
  readonly overall: GradeOutcome;
} {
  const atoms = Object.fromEntries(
    gradeAtoms.map((atom) => [atom.grade_id, evaluateAtom(atom, observations, context)]),
  ) as Readonly<Record<string, GradeOutcome>>;
  return { atoms, overall: composeOutcomes(Object.values(atoms), precedence) };
}

async function loadCohort(
  root: string,
  name: CohortName,
  reference: DomainEvaluation["validation_cohort_plan"][CohortName],
): Promise<LoadedCohort> {
  const [casesInput, expectationsInput] = await Promise.all([
    readDomainYaml(root, reference.cases_path, cohortCasesSchema, "invalid_cohort_cases"),
    readDomainYaml(
      root,
      reference.expectations_path,
      cohortExpectationsSchema,
      "invalid_cohort_expectations",
    ),
  ]);
  const cases = casesInput.value;
  const expectations = expectationsInput.value;
  if (
    cases.cohort_id !== reference.cohort_id ||
    expectations.cohort_id !== reference.cohort_id ||
    cases.role !== name
  ) {
    throw new DomainCompilerError(
      "cohort_identity_mismatch",
      "Cohort files must match the pinned identity and role",
      reference.cohort_id,
    );
  }
  if (
    (name === "development" || name === "calibration") &&
    expectations.authored_independently !== true
  ) {
    throw new DomainCompilerError(
      "cohort_expectations_not_independent",
      "Development and calibration expectations must be independently authored",
      reference.cohort_id,
    );
  }
  if (name === "validation" && expectations.reference_expectations !== true) {
    throw new DomainCompilerError(
      "validation_expectations_not_declared",
      "Public validation expectations must be explicitly marked as reference labels",
      reference.cohort_id,
    );
  }
  const caseIds = cases.cases.map((fixtureCase) => fixtureCase.case_id).sort();
  const expectationIds = expectations.expectations.map((expectation) => expectation.case_id).sort();
  if (canonicalJsonDigest(caseIds) !== canonicalJsonDigest(expectationIds)) {
    throw new DomainCompilerError(
      "cohort_expectation_mismatch",
      "Every Cohort case must have exactly one independent expectation",
      reference.cohort_id,
    );
  }
  const digest = canonicalJsonDigest({
    cases: casesInput.raw,
    expectations: expectationsInput.raw,
  });
  if (digest !== reference.content_sha256) {
    throw new DomainCompilerError(
      "cohort_content_digest_mismatch",
      "Cohort content does not match the validation plan pin",
      reference.cohort_id,
    );
  }
  return { name, cases, expectations, digest };
}

function validateGradeAtoms(evaluation: DomainEvaluation, cohorts: readonly LoadedCohort[]): void {
  const cohortIds = Object.fromEntries(
    cohorts.map((cohort) => [cohort.name, cohort.cases.cohort_id]),
  );
  for (const atom of evaluation.grade_atoms) {
    const expectedInputs = PREDICATE_INPUTS[atom.estimator.predicate_id];
    if (
      expectedInputs === undefined ||
      canonicalJsonDigest([...atom.estimator.input_fields].sort()) !==
        canonicalJsonDigest([...expectedInputs].sort()) ||
      atom.expected_outcomes.length !== ALL_OUTCOMES.size ||
      new Set(atom.expected_outcomes).size !== ALL_OUTCOMES.size ||
      atom.expected_outcomes.some((outcome) => !ALL_OUTCOMES.has(outcome)) ||
      atom.calibration_plan.development_cohort_ref !== cohortIds.development ||
      atom.calibration_plan.calibration_cohort_ref !== cohortIds.calibration ||
      atom.calibration_plan.validation_cohort_ref !== cohortIds.validation
    ) {
      throw new DomainCompilerError(
        "invalid_grade_atom_contract",
        "Grade Atom must bind all outcomes and the three disjoint calibration cohorts",
        atom.grade_id,
      );
    }
  }
}

function validateCohortSeparation(cohorts: readonly LoadedCohort[]): void {
  const cohortIds = new Set<string>();
  const caseIds = new Set<string>();
  for (const cohort of cohorts) {
    if (cohortIds.has(cohort.cases.cohort_id)) {
      throw new DomainCompilerError(
        "cohort_identity_collision",
        "Qualification cohorts must have distinct identities",
        cohort.cases.cohort_id,
      );
    }
    cohortIds.add(cohort.cases.cohort_id);
    for (const fixtureCase of cohort.cases.cases) {
      if (caseIds.has(fixtureCase.case_id)) {
        throw new DomainCompilerError(
          "cohort_case_overlap",
          "Development, calibration and validation cases must be disjoint",
          fixtureCase.case_id,
        );
      }
      caseIds.add(fixtureCase.case_id);
    }
  }
}

export function buildGraderContext(
  evaluation: DomainEvaluation,
  productContracts: ReturnType<typeof productContractsSchema.parse>,
  completeClosureRequest: DomainEvaluation["closure_expectations"][number],
): GraderContext {
  const [projectionId, projectionVersion] = splitVersionedReference(
    completeClosureRequest.projection_ref,
  );
  const projection = evaluation.projections.find(
    (candidate) =>
      candidate.projection_id === projectionId && candidate.version === projectionVersion,
  );
  if (projection === undefined) {
    throw new DomainCompilerError("unknown_projection", "Qualification projection is unavailable");
  }
  const [contractId, contractVersion] = splitVersionedReference(projection.product_contract_ref);
  const productContract = productContracts.product_contracts.find(
    (candidate) => candidate.contract_id === contractId && candidate.version === contractVersion,
  );
  const deadline = productContract?.commitments.find(
    (commitment) => commitment.commitment_id === "acme-cash-refund-24h",
  )?.deadline;
  if (deadline === undefined || deadline.unit !== "hour") {
    throw new DomainCompilerError(
      "unsupported_deadline_contract",
      "Reference grader requires one hour-based cash-refund deadline",
      contractId,
    );
  }
  const observationProfile = evaluation.observation_profiles.find(
    (profile) => profile.observation_profile_id === completeClosureRequest.observation_profile_ref,
  );
  if (observationProfile === undefined) {
    throw new DomainCompilerError(
      "unknown_observation_profile",
      "Qualification observation profile is unavailable",
      completeClosureRequest.observation_profile_ref,
    );
  }
  return {
    expectedCash: evaluation.episode.expected_consequence.cash_to_original_tender,
    settlementDeadlineHours: deadline.value,
    expectedEconomicEffects:
      evaluation.episode.expected_consequence.successful_economic_refund_count,
    expectedLedgerBalanced: evaluation.episode.expected_consequence.ledger_balanced,
    completeChannelAbsence: observationProfile.absence_semantics.complete_channel_absence,
    unavailableChannelAbsence: observationProfile.absence_semantics.unavailable_channel_absence,
  };
}

function validateGradeTargets(
  evaluation: DomainEvaluation,
  landscape: CompiledDomainLandscape,
  selectedViewClaimRefs: readonly string[],
  productContracts: ReturnType<typeof productContractsSchema.parse>,
  completeClosureRequest: DomainEvaluation["closure_expectations"][number],
): void {
  const [projectionId, projectionVersion] = splitVersionedReference(
    completeClosureRequest.projection_ref,
  );
  const projection = evaluation.projections.find(
    (candidate) =>
      candidate.projection_id === projectionId && candidate.version === projectionVersion,
  );
  if (projection === undefined) {
    throw new DomainCompilerError("unknown_projection", "Qualification projection is unavailable");
  }
  const [contractId, contractVersion] = splitVersionedReference(projection.product_contract_ref);
  const productContract = productContracts.product_contracts.find(
    (candidate) => candidate.contract_id === contractId && candidate.version === contractVersion,
  );
  if (productContract === undefined) {
    throw new DomainCompilerError(
      "projection_contract_mismatch",
      "Qualification Product Contract is unavailable",
      projection.product_contract_ref,
    );
  }
  const validTargets = new Set([
    ...landscape.claims
      .filter((claim) => selectedViewClaimRefs.includes(claim.claimRef))
      .map((claim) => claim.claimRef),
    ...productContract.commitments.map(
      (commitment) => `${productContract.contract_id}#${commitment.commitment_id}`,
    ),
  ]);
  for (const atom of evaluation.grade_atoms) {
    if (!validTargets.has(atom.target_claim_ref)) {
      throw new DomainCompilerError(
        "grade_atom_target_outside_closure",
        "Grade Atom must target a Claim or commitment selected by the complete Closure",
        atom.grade_id,
      );
    }
  }
}

export async function validateDomainGraderDirectory(
  inputRoot: string,
): Promise<GraderValidationResult> {
  const root = await resolveDomainRoot(inputRoot);
  const [evaluationInput, contractsInput, viewInput, landscape] = await Promise.all([
    readDomainYaml(root, "evaluation.yaml", domainEvaluationSchema, "invalid_domain_evaluation"),
    readDomainYaml(
      root,
      "product-contracts.yaml",
      productContractsSchema,
      "invalid_product_contracts",
    ),
    readDomainYaml(root, "view.yaml", domainViewSchema, "invalid_domain_view"),
    compileDomainLandscapeDirectory(root),
  ]);
  const evaluation = evaluationInput.value;
  const cohortPlan = evaluation.validation_cohort_plan;
  const cohorts = await Promise.all([
    loadCohort(root, "development", cohortPlan.development),
    loadCohort(root, "calibration", cohortPlan.calibration),
    loadCohort(root, "validation", cohortPlan.validation),
  ]);
  validateCohortSeparation(cohorts);
  validateGradeAtoms(evaluation, cohorts);

  const closureResults = await Promise.all(
    evaluation.closure_expectations.map(async (closureRequest) => ({
      request: closureRequest,
      result: await compileEvaluationClosureDirectory(root, {
        closureId: closureRequest.closure_id,
      }),
    })),
  );
  const completeClosures = closureResults.filter(({ result }) => result.status === "complete");
  if (completeClosures.length !== 1) {
    throw new DomainCompilerError(
      "complete_closure_missing",
      "Qualification requires exactly one actually complete Closure",
    );
  }
  const completeClosure = completeClosures[0];
  if (completeClosure === undefined) {
    throw new DomainCompilerError("complete_closure_missing", "Complete Closure disappeared");
  }
  const closure = completeClosure.result;
  const completeClosureRequest = completeClosure.request;

  validateGradeTargets(
    evaluation,
    landscape,
    viewInput.value.selected_claim_refs,
    contractsInput.value,
    completeClosureRequest,
  );
  const context = buildGraderContext(evaluation, contractsInput.value, completeClosureRequest);
  const gradeIds = evaluation.grade_atoms.map((atom) => atom.grade_id).sort();
  const caseEvidence: GraderCaseEvidence[] = [];
  let matchesValidationExpectations = true;
  let acceptsRequiredCases = true;
  for (const cohort of cohorts) {
    for (const fixtureCase of cohort.cases.cases) {
      const expected = cohort.expectations.expectations.find(
        (candidate) => candidate.case_id === fixtureCase.case_id,
      );
      if (expected === undefined) {
        throw new DomainCompilerError(
          "cohort_expectation_mismatch",
          "Case expectation disappeared after validation",
          fixtureCase.case_id,
        );
      }
      if (
        canonicalJsonDigest(Object.keys(expected.atoms).sort()) !== canonicalJsonDigest(gradeIds)
      ) {
        throw new DomainCompilerError(
          "grade_atom_expectation_mismatch",
          "Case expectation must cover the exact Grade Atom vector",
          fixtureCase.case_id,
        );
      }
      const observed = executeGradeVector(
        evaluation.grade_atoms,
        fixtureCase.observations,
        context,
        evaluation.verdict_policy.precedence,
      );
      const observedAtoms = observed.atoms;
      const observedOverall = observed.overall;
      if (cohort.name !== "development") {
        matchesValidationExpectations &&=
          canonicalJsonDigest(observedAtoms) === canonicalJsonDigest(expected.atoms) &&
          observedOverall === expected.overall;
        if (fixtureCase.kind === "mutant") acceptsRequiredCases &&= observedOverall === "fail";
        if (fixtureCase.kind === "gold" || fixtureCase.kind === "equivalent") {
          acceptsRequiredCases &&= observedOverall === "pass";
        }
      }
      caseEvidence.push({
        caseId: fixtureCase.case_id,
        cohort: cohort.name,
        observationDigest: canonicalJsonDigest(fixtureCase.observations),
        expectedAtoms: expected.atoms,
        observedAtoms,
        expectedOverall: expected.overall,
        observedOverall,
      });
    }
  }

  const graderDigest = canonicalJsonDigest(evaluation.grade_atoms);
  const cohortDigests: Readonly<Record<CohortName, string>> = {
    development: cohorts[0].digest,
    calibration: cohorts[1].digest,
    validation: cohorts[2].digest,
  };
  const status = matchesValidationExpectations && acceptsRequiredCases ? "validated" : "invalid";
  const evidenceDigest = canonicalJsonDigest({
    closureDigest: closure.digest,
    graderDigest,
    cohortDigests,
    caseEvidence,
  });
  return {
    status,
    closureDigest: closure.digest,
    graderDigest,
    cohortDigests,
    evidenceDigest,
    caseEvidence,
  };
}
