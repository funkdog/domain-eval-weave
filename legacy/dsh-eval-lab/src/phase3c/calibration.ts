import { PHASE3C_SCENARIOS } from "./compiler.js";

export const phase3cScenarioObservationId = (
  scenario: (typeof PHASE3C_SCENARIOS)[number],
): string => {
  const claimId = scenario.claimIds[0];
  if (claimId === undefined) throw new Error("Phase 3C scenario lacks Claim authority");
  return `${scenario.scenarioId}-${claimId.toLowerCase()}`;
};

const ALL_OBSERVATION_IDS = PHASE3C_SCENARIOS.map(phase3cScenarioObservationId);

export const PHASE3C_OBSERVATION_CALIBRATION = [
  {
    candidateId: "red",
    caseKind: "mutant",
    expectedFailures: ALL_OBSERVATION_IDS,
  },
  { candidateId: "gold", caseKind: "gold", expectedFailures: [] },
  { candidateId: "gold-repeat", caseKind: "equivalent", expectedFailures: [] },
  { candidateId: "gold-next-seed", caseKind: "equivalent", expectedFailures: [], seedOffset: 1 },
  { candidateId: "equivalent-typed-rejection", caseKind: "equivalent", expectedFailures: [] },
  { candidateId: "equivalent-reason-variation", caseKind: "equivalent", expectedFailures: [] },
  { candidateId: "equivalent-persistence-layout", caseKind: "equivalent", expectedFailures: [] },
  {
    candidateId: "relaxation-malformed-refund-effect",
    caseKind: "relaxation_mutant",
    expectedFailures: ["paid-unstarted-clm-commerce-r03", "paid-unstarted-clm-commerce-r04"],
  },
  {
    candidateId: "mutant-handed-off-cancel",
    caseKind: "mutant",
    expectedFailures: ["handoff-rejection-clm-commerce-d01"],
  },
  {
    candidateId: "mutant-overrefund-or-currency",
    caseKind: "mutant",
    expectedFailures: ["paid-unstarted-clm-commerce-r03"],
  },
  {
    candidateId: "mutant-premature-cancel",
    caseKind: "mutant",
    expectedFailures: [
      "active-completion-clm-commerce-r07",
      "active-completion-clm-commerce-d02",
      "active-rejection-clm-commerce-d02",
      "active-failure-clm-commerce-d02",
    ],
  },
  {
    candidateId: "mutant-withdrawal-rejection-effects",
    caseKind: "mutant",
    expectedFailures: ["active-rejection-clm-commerce-d02"],
  },
  {
    candidateId: "mutant-withdrawal-failure-effects",
    caseKind: "mutant",
    expectedFailures: ["active-failure-clm-commerce-d02"],
  },
  {
    candidateId: "mutant-double-effects",
    caseKind: "mutant",
    expectedFailures: ["request-replay-clm-commerce-r06", "expired-replay-clm-commerce-d07"],
  },
  {
    candidateId: "mutant-coupon-always-restored",
    caseKind: "mutant",
    expectedFailures: ["coupon-eligibility-clm-commerce-d04"],
  },
  {
    candidateId: "mutant-no-ownership",
    caseKind: "mutant",
    expectedFailures: ["ownership-rejection-clm-commerce-r05"],
  },
  {
    candidateId: "mutant-no-persistence",
    caseKind: "mutant",
    expectedFailures: ["restart-recovery-clm-commerce-r08", "restart-recovery-clm-commerce-d08"],
  },
  {
    candidateId: "mutant-expired-replay-fresh",
    caseKind: "mutant",
    expectedFailures: ["expired-replay-clm-commerce-d07"],
  },
  {
    candidateId: "mutant-sparse-audit",
    caseKind: "mutant",
    expectedFailures: [
      "restart-recovery-clm-commerce-r08",
      "restart-recovery-clm-commerce-d08",
      "retention-policy-clm-commerce-d09",
    ],
  },
] as const;

export type Phase3cCalibrationCandidateId =
  (typeof PHASE3C_OBSERVATION_CALIBRATION)[number]["candidateId"];

export function expectedPhase3cObservationFailures(
  candidateId: Phase3cCalibrationCandidateId,
): readonly string[] {
  const entry = PHASE3C_OBSERVATION_CALIBRATION.find(
    (candidate) => candidate.candidateId === candidateId,
  );
  if (entry === undefined)
    throw new Error(`Unknown Phase 3C calibration Candidate: ${candidateId}`);
  return entry.expectedFailures;
}
