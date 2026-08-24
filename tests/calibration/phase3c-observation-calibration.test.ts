import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256Hex } from "../../src/contracts/canonical-json.js";
import {
  COMMERCE_CALIBRATION_CANDIDATES,
  materializeCommerceCalibrationCandidate,
} from "../../src/oracle/commerce-calibration-v2.js";
import {
  CommerceObservationExecutor,
  deriveExpressionDimensions,
  evaluateObservationExpression,
  expectedPhase3cObservationFailures,
  materializePhase3cEquivalentCandidate,
  PHASE3C_OBSERVATION_CALIBRATION,
  PHASE3C_SCENARIOS,
  type Phase3cCalibrationCandidateId,
  phase3cScenarioObservationId,
} from "../../src/phase3c/index.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v3/", import.meta.url),
);
const runnerPath = `${packRoot}/oracle/runner.mjs`;
const requirementDeltaClaims = new Set([
  "CLM-COMMERCE-R01",
  "CLM-COMMERCE-R02",
  "CLM-COMMERCE-R07",
  "CLM-COMMERCE-D01",
  "CLM-COMMERCE-D02",
]);

async function sourceForCandidate(
  candidateId: Phase3cCalibrationCandidateId,
  scratchRoot: string,
): Promise<string> {
  if (candidateId === "red") return `${packRoot}/base`;
  if (candidateId === "gold" || candidateId === "gold-repeat" || candidateId === "gold-next-seed") {
    return `${packRoot}/calibration/gold-equivalent`;
  }
  if (
    candidateId === "equivalent-typed-rejection" ||
    candidateId === "equivalent-reason-variation" ||
    candidateId === "equivalent-persistence-layout" ||
    candidateId === "relaxation-malformed-refund-effect"
  ) {
    return materializePhase3cEquivalentCandidate({
      candidateId,
      packRoot,
      scratchRoot,
    });
  }
  const candidate = COMMERCE_CALIBRATION_CANDIDATES.find((entry) => entry === candidateId);
  if (candidate === undefined || !candidate.startsWith("mutant-")) {
    throw new Error(`Phase 3C mutant is not in the frozen Commerce corpus: ${candidateId}`);
  }
  return materializeCommerceCalibrationCandidate({
    candidate,
    packRoot,
    scratchRoot,
  });
}

test("Phase 3C Observation Boundary has exact Gold/equivalent/mutant calibration vectors", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/phase3c-observation-calibration-`);
  const runnerSha256 = sha256Hex(await readFile(runnerPath));
  try {
    for (const calibration of PHASE3C_OBSERVATION_CALIBRATION) {
      const candidateRoot = await sourceForCandidate(
        calibration.candidateId,
        `${root}/materialized`,
      );
      const campaignRoot = `${root}/campaigns/${calibration.candidateId}`;
      await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
      const executor = new CommerceObservationExecutor({
        runner: new StrictProcessRunner(),
        runnerPath,
        runnerSha256,
        candidateRoot,
        scratchRoot: `${root}/scratch/${calibration.candidateId}`,
        campaignRoot,
        seed: 1729 + ("seedOffset" in calibration ? calibration.seedOffset : 0),
      });
      const failed: string[] = [];
      for (const scenario of PHASE3C_SCENARIOS) {
        const observationId = phase3cScenarioObservationId(scenario);
        const claimId = scenario.claimIds[0];
        if (claimId === undefined) throw new Error("Phase 3C scenario lost its Claim authority");
        const evidence = await executor.execute({
          observation_id: observationId,
          claim_id: claimId,
          axis: requirementDeltaClaims.has(claimId) ? "requirement_delta" : "domain_preservation",
          dimension_ids: deriveExpressionDimensions(scenario.expression),
          stimulus_id: scenario.stimulusId,
          expression: scenario.expression,
        });
        if (!evaluateObservationExpression(scenario.expression, evidence.context)) {
          failed.push(observationId);
        }
      }
      assert.deepEqual(
        failed,
        expectedPhase3cObservationFailures(calibration.candidateId),
        calibration.candidateId,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
