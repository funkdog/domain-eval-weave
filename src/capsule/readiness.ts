import { findCalibrationReports } from "../evaluator/calibration.js";
import type { LoadedCapsule } from "./loader.js";
import { evaluatorReference, findEvaluator } from "./loader.js";
import { previewCapsuleRelease } from "./release.js";

export type CapsuleReadinessStage = "draft" | "runnable" | "qualified" | "publishable";

export interface CapsuleReadinessAction {
  readonly code:
    | "ADD_SOURCE"
    | "ADD_CLAIM"
    | "ADD_REQUIREMENT"
    | "ADD_EVALUATOR"
    | "ADD_CANDIDATE"
    | "CONFIRM_REQUIRED_CLAIM"
    | "ADD_REQUIRED_CHECK"
    | "ADD_CALIBRATION_CASE"
    | "CALIBRATE_EVALUATOR"
    | "COMPLETE_SOURCE_PROVENANCE";
  readonly message: string;
  readonly locator?: string;
}

export interface CapsuleReadiness {
  readonly schema_version: 1;
  readonly capsule_id: string;
  readonly stage: CapsuleReadinessStage;
  readonly truth: {
    readonly claims: Readonly<Record<LoadedCapsule["domain"]["claims"][number]["status"], number>>;
    readonly required_claim_blockers: readonly string[];
    readonly source_provenance_blockers: readonly string[];
  };
  readonly evaluation: {
    readonly requirements: number;
    readonly evaluators: number;
    readonly candidates: number;
    readonly cases: number;
    readonly runnable_evaluator_refs: readonly string[];
    readonly qualified_evaluator_refs: readonly string[];
  };
  readonly release: {
    readonly sha256: string;
    readonly calibration_refs: readonly string[];
  };
  readonly next_actions: readonly CapsuleReadinessAction[];
}

function action(
  code: CapsuleReadinessAction["code"],
  message: string,
  locator?: string,
): CapsuleReadinessAction {
  return locator === undefined ? { code, message } : { code, message, locator };
}

export async function inspectCapsuleReadiness(
  capsule: LoadedCapsule,
  evaluatorRef?: string,
): Promise<CapsuleReadiness> {
  if (evaluatorRef !== undefined) findEvaluator(capsule, evaluatorRef);
  const claimsById = new Map(capsule.domain.claims.map((claim) => [claim.claim_id, claim]));
  const requiredClaimBlockers = capsule.requirements
    .flatMap((requirement) =>
      requirement.edges
        .filter((edge) => edge.required)
        .flatMap((edge) => {
          const claim = claimsById.get(edge.claim_id);
          return claim?.status === "confirmed"
            ? []
            : [`${requirement.requirement_id}:${edge.claim_id}:${claim?.status ?? "missing"}`];
        }),
    )
    .sort();
  const sourceProvenanceBlockers = capsule.manifest.sources
    .filter((source) => source.license === undefined || source.description === undefined)
    .map((source) => source.source_id)
    .sort();
  const runnableEvaluatorRefs = capsule.evaluators
    .filter((evaluator) => {
      const requirement = capsule.requirements.find(
        (entry) => entry.requirement_id === evaluator.requirement_id,
      );
      if (requirement === undefined) return false;
      const checked = new Set(evaluator.checks.map((check) => check.claim_id));
      return requirement.edges
        .filter((edge) => edge.required)
        .every(
          (edge) =>
            claimsById.get(edge.claim_id)?.status === "confirmed" && checked.has(edge.claim_id),
        );
    })
    .map(evaluatorReference)
    .filter((ref) => evaluatorRef === undefined || ref === evaluatorRef)
    .sort();
  const released = await previewCapsuleRelease(capsule);
  const persisted = await findCalibrationReports({
    capsule,
    releaseSha256: released.sha256,
    ...(evaluatorRef === undefined ? {} : { evaluatorRef }),
  });
  const qualifiedEvaluatorRefs = [
    ...new Set(
      persisted
        .filter((entry) => entry.report.qualified)
        .map((entry) => evaluatorReference(entry.report.evaluator)),
    ),
  ].sort();
  const runnable =
    capsule.requirements.length > 0 &&
    capsule.evaluators.length > 0 &&
    capsule.manifest.candidates.length > 0 &&
    requiredClaimBlockers.length === 0 &&
    runnableEvaluatorRefs.length > 0;
  const qualified = runnable && qualifiedEvaluatorRefs.length > 0;
  const publishable = qualified && sourceProvenanceBlockers.length === 0;
  const stage: CapsuleReadinessStage = publishable
    ? "publishable"
    : qualified
      ? "qualified"
      : runnable
        ? "runnable"
        : "draft";

  const nextActions: CapsuleReadinessAction[] = [];
  if (capsule.manifest.sources.length === 0)
    nextActions.push(
      action("ADD_SOURCE", "Add at least one provenance-bound source", "capsule.yaml#sources"),
    );
  if (capsule.domain.claims.length === 0)
    nextActions.push(
      action("ADD_CLAIM", "Add proposed Claims grounded in sources", capsule.paths.domain),
    );
  if (capsule.requirements.length === 0)
    nextActions.push(action("ADD_REQUIREMENT", "Add a Requirement Delta", "requirements/"));
  if (capsule.evaluators.length === 0)
    nextActions.push(action("ADD_EVALUATOR", "Add a versioned Evaluator", "evaluators/"));
  if (capsule.manifest.candidates.length === 0)
    nextActions.push(
      action("ADD_CANDIDATE", "Add a Candidate command closure", "capsule.yaml#candidates"),
    );
  if (requiredClaimBlockers.length > 0)
    nextActions.push(
      action(
        "CONFIRM_REQUIRED_CLAIM",
        "Confirm or remove every required non-confirmed Claim",
        requiredClaimBlockers[0],
      ),
    );
  if (
    capsule.evaluators.length > 0 &&
    capsule.requirements.length > 0 &&
    runnableEvaluatorRefs.length === 0 &&
    requiredClaimBlockers.length === 0
  ) {
    nextActions.push(
      action("ADD_REQUIRED_CHECK", "Bind checks for every required confirmed Claim", "evaluators/"),
    );
  }
  if (runnable && capsule.cases.length === 0)
    nextActions.push(
      action("ADD_CALIBRATION_CASE", "Add Gold, equivalent and mutant calibration cases", "cases/"),
    );
  if (runnable && !qualified)
    nextActions.push(
      action(
        "CALIBRATE_EVALUATOR",
        "Persist a qualified calibration for the exact Capsule release",
        evaluatorRef ?? runnableEvaluatorRefs[0],
      ),
    );
  if (qualified && sourceProvenanceBlockers.length > 0)
    nextActions.push(
      action(
        "COMPLETE_SOURCE_PROVENANCE",
        "Add description and license for every published source",
        sourceProvenanceBlockers[0],
      ),
    );

  const claims = {
    confirmed: 0,
    proposed: 0,
    unresolved: 0,
    conflicted: 0,
    observability_gap: 0,
  };
  for (const claim of capsule.domain.claims) claims[claim.status] += 1;
  return {
    schema_version: 1,
    capsule_id: capsule.manifest.capsule_id,
    stage,
    truth: {
      claims,
      required_claim_blockers: requiredClaimBlockers,
      source_provenance_blockers: sourceProvenanceBlockers,
    },
    evaluation: {
      requirements: capsule.requirements.length,
      evaluators: capsule.evaluators.length,
      candidates: capsule.manifest.candidates.length,
      cases: capsule.cases.length,
      runnable_evaluator_refs: runnableEvaluatorRefs,
      qualified_evaluator_refs: qualifiedEvaluatorRefs,
    },
    release: {
      sha256: released.sha256,
      calibration_refs: persisted.map((entry) => entry.ref),
    },
    next_actions: nextActions,
  };
}

export function renderCapsuleSummary(capsule: LoadedCapsule, readiness: CapsuleReadiness): string {
  const rows = [
    ["Confirmed", readiness.truth.claims.confirmed],
    ["Proposed", readiness.truth.claims.proposed],
    ["Unresolved", readiness.truth.claims.unresolved],
    ["Conflicted", readiness.truth.claims.conflicted],
    ["Observability gap", readiness.truth.claims.observability_gap],
  ];
  return [
    `# Capsule: ${capsule.manifest.capsule_id}`,
    "",
    `Title: ${capsule.manifest.title}`,
    `Version: ${capsule.manifest.version}`,
    `Readiness: ${readiness.stage}`,
    "",
    "## Truth",
    "",
    "| Claim status | Count |",
    "| --- | ---: |",
    ...rows.map(([label, count]) => `| ${label} | ${count} |`),
    "",
    "## Evaluation",
    "",
    `- Requirements: ${readiness.evaluation.requirements}`,
    `- Evaluators: ${readiness.evaluation.evaluators}`,
    `- Candidates: ${readiness.evaluation.candidates}`,
    `- Calibration cases: ${readiness.evaluation.cases}`,
    `- Qualified evaluators: ${readiness.evaluation.qualified_evaluator_refs.join(", ") || "none"}`,
    "",
    "## Next actions",
    "",
    ...(readiness.next_actions.length === 0
      ? ["- None. Capsule is publishable."]
      : readiness.next_actions.map((entry) => `- ${entry.code}: ${entry.message}`)),
    "",
  ].join("\n");
}
