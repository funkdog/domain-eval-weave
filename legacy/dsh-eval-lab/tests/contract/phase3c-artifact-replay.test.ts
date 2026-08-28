import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";

import {
  persistPhase3cEvaluation,
  replayPhase3cEvaluation,
  TDD_SKILL_BINDING,
} from "../../src/phase3c/index.js";
import { PHASE3C_PUBLIC_OBSERVATION_CATALOG } from "../../src/phase3c/vocabulary.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import {
  validPhase3cAuthorityMap,
  validPhase3cBoundary,
  validPhase3cCodeQualityAdmission,
  validPhase3cCodeQualityAggregate,
  validPhase3cCodeQualityContract,
  validPhase3cCodeQualityRunReceipts,
  validPhase3cCodeQualityRuns,
  validPhase3cDeterministicResult,
  validPhase3cHarnessEffectContract,
  validPhase3cReport,
  validPhase3cSemanticAdmission,
  validPhase3cSemanticAggregate,
  validPhase3cSemanticContract,
  validPhase3cSemanticRunReceipts,
  validPhase3cSemanticRuns,
  validPhase3cTaskRegistry,
} from "../helpers/phase3c-fixtures.js";

test("Phase 3C primary artifacts persist and replay without invoking a Judge", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/phase3c-artifacts-`);
  try {
    const persisted = await persistPhase3cEvaluation({
      campaignRoot: root,
      publicObservationCatalog: PHASE3C_PUBLIC_OBSERVATION_CATALOG,
      observationAuthorityMap: validPhase3cAuthorityMap,
      observationBoundary: validPhase3cBoundary,
      deterministicObservations: validPhase3cDeterministicResult,
      claimAxes: { "claim-cancel": "requirement_delta" },
      semanticJudgeContract: validPhase3cSemanticContract,
      semanticJudgeAdmission: validPhase3cSemanticAdmission,
      semanticJudgeResult: validPhase3cSemanticAggregate,
      semanticJudgeRuns: validPhase3cSemanticRuns,
      semanticJudgeRunReceipts: validPhase3cSemanticRunReceipts,
      codeQualityJudgeContract: validPhase3cCodeQualityContract,
      codeQualityJudgeAdmission: validPhase3cCodeQualityAdmission,
      codeQualityJudgeResult: validPhase3cCodeQualityAggregate,
      codeQualityJudgeRuns: validPhase3cCodeQualityRuns,
      codeQualityJudgeRunReceipts: validPhase3cCodeQualityRunReceipts,
      tddSkillBinding: TDD_SKILL_BINDING,
      taskRegistry: validPhase3cTaskRegistry,
      harnessEffectContract: validPhase3cHarnessEffectContract,
      deliveryReport: validPhase3cReport,
    });
    const replayed = await replayPhase3cEvaluation({
      campaignRoot: root,
      manifestPointer: persisted.manifestPointer,
    });
    assert.deepEqual(replayed.report, validPhase3cReport);
    assert.equal(persisted.reportPointer.sha256, persisted.manifest.delivery_report.sha256);

    await assert.rejects(() =>
      replayPhase3cEvaluation({
        campaignRoot: root,
        manifestPointer: { ...persisted.manifestPointer, sha256: "0".repeat(64) },
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
