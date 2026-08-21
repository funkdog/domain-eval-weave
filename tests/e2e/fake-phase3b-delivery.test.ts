import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runPairedCampaign } from "../../src/campaign/coordinator.js";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { parseExperimentSpec } from "../../src/contracts/parsers.js";
import { buildGraderAdmission } from "../../src/delivery/admission.js";
import {
  persistDeliveryEvaluation,
  replayDeliveryEvaluation,
} from "../../src/delivery/artifacts.js";
import { compileValidatedDeterministicGrader } from "../../src/delivery/compiler.js";
import { validateDomainPack } from "../../src/domain/pack.js";
import { fingerprintEvalDeployment } from "../../src/fingerprint/deployment.js";
import { calibrateLedgerPackDetailed } from "../../src/oracle/calibration.js";
import { LedgerOracle } from "../../src/oracle/ledger.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import {
  digestTaskPack,
  loadObservationCatalog,
  loadTaskPackIdentity,
} from "../../src/task-pack/loader.js";
import {
  validCalibrationEvidence,
  validControlVariant,
  validExperiment,
  validTreatmentVariant,
} from "../helpers/fixtures.js";
import { writeSyntheticReservationDomainPack } from "../helpers/phase3b-domain-pack.js";
import { syntheticSessionLog } from "../helpers/session.js";

const taskPackRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-ledger-v1", import.meta.url),
);

test("domain truth compiles, admits, evaluates a synthetic Agent delivery, and replays", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const projectRoot = await mkdtemp(`${parent}/phase3b-vertical-`);
  try {
    const domain = await writeSyntheticReservationDomainPack(projectRoot);
    const pack = await validateDomainPack(projectRoot, "domain-eval", domain.manifestRef, {
      confirmationLedger: domain.confirmationLedger,
    });
    const [catalog, taskPackIdentity, taskPackDigest] = await Promise.all([
      loadObservationCatalog(taskPackRoot),
      loadTaskPackIdentity(taskPackRoot),
      digestTaskPack(taskPackRoot),
    ]);
    const compiled = compileValidatedDeterministicGrader({
      pack,
      requirementId: "implement-reservation-ledger",
      taskPackDigest,
      catalog,
    });
    const oracle = new LedgerOracle({
      runner: new StrictProcessRunner(),
      oracleRunnerPath: `${taskPackRoot}/oracle/runner.mjs`,
    });
    const detailedCalibration = await calibrateLedgerPackDetailed({
      oracle,
      packRoot: taskPackRoot,
      scratchRoot: `${projectRoot}/calibration`,
      seed: 1729,
    });
    const admission = buildGraderAdmission({
      oraclePlan: compiled.oraclePlan,
      catalog,
      calibration: detailedCalibration,
      seed: 1729,
      evalPackageDigest: validControlVariant.eval_package_sha256,
    });
    assert.equal(admission.status, "admitted");

    const publicTask = await readFile(`${taskPackRoot}/public-task.md`, "utf8");
    const deploymentDigest = fingerprintEvalDeployment({
      control: validControlVariant.resolved_config_sha256,
      treatment: validTreatmentVariant.resolved_config_sha256,
      task_pack: taskPackDigest,
      model: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "xhigh" },
      dsh_package_tree: validControlVariant.dsh_package_tree_sha256,
      codex_connect_package: validControlVariant.codex_connect_package_sha256,
      eval_package: validControlVariant.eval_package_sha256,
      common_patch: validControlVariant.common_patch_sha256,
    });
    const experiment = parseExperimentSpec({
      ...validExperiment,
      campaign_id: "campaign-phase3b-synthetic",
      task_pack_digest: taskPackDigest,
      deployment: {
        ...validExperiment.deployment,
        digest: deploymentDigest,
        qualification: {
          ...validExperiment.deployment.qualification,
          deployment_digest: deploymentDigest,
        },
        calibration: {
          ...validCalibrationEvidence,
          task_pack_digest: taskPackDigest,
          calibration_digest: taskPackIdentity.pack.calibration_digest,
        },
      },
    });
    const campaignRoot = `${projectRoot}/delivery-eval/campaign-phase3b-synthetic`;
    const workspaces = {
      control: `${projectRoot}/workspaces/control`,
      treatment: `${projectRoot}/workspaces/treatment`,
    } as const;
    await Promise.all([
      cp(`${taskPackRoot}/base`, workspaces.control, { recursive: true }),
      cp(`${taskPackRoot}/calibration/gold-equivalent`, workspaces.treatment, {
        recursive: true,
      }),
    ]);
    const trees = { control: "1".repeat(40), treatment: "2".repeat(40) } as const;
    const campaign = await runPairedCampaign({
      campaignRoot,
      experiment,
      variants: { control: validControlVariant, treatment: validTreatmentVariant },
      taskPackIdentity,
      publicTask,
      executeArm: async (arm) => ({
        sessionId: `session-phase3b-${arm}`,
        sessionLog: syntheticSessionLog({
          arm,
          publicTask,
          sessionId: `session-phase3b-${arm}`,
        }),
        candidateTree: trees[arm],
        candidatePatch: Buffer.from(`${arm}-synthetic-agent-patch`, "utf8"),
        candidateArchive: Buffer.from(`${arm}-synthetic-agent-archive`, "utf8"),
        candidateChangedPaths: ["src/ledger.ts"],
        candidateUnauthorizedPaths: [],
        candidateForbiddenEntries: [],
        workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
        process: {
          started_at: "2026-08-21T00:30:00.000Z",
          ended_at: "2026-08-21T00:31:00.000Z",
          exit_code: 0,
          signal: null,
          timed_out: false,
        },
        elapsedMs: arm === "control" ? 60_000 : 65_000,
      }),
      evaluateArm: async (arm) => ({
        behavior: await oracle.evaluateDirectory(
          workspaces[arm],
          1729,
          `${projectRoot}/oracle/${arm}`,
        ),
        candidateTreeAfterOracle: trees[arm],
        oracleSeed: { schema_version: 1, seed: 1729, oracle_version: "ledger-oracle-v3" },
      }),
    });
    const persisted = await persistDeliveryEvaluation({
      campaignRoot,
      evaluationId: "delivery-implement-reservation-ledger-v1",
      claimIr: compiled.claimIr,
      oraclePlan: compiled.oraclePlan,
      admission,
      pairedEvaluation: campaign.pairedEvaluation,
      pairedReport: campaign.report,
      pairedEvaluationPointer: campaign.pointers.evaluation,
      pairedReportPointer: campaign.pointers.report,
    });
    assert.equal(persisted.report.verdict, "accept");
    assert.deepEqual(persisted.report.axes.harness_impact.changed_behaviors, [
      ...compiled.oraclePlan.checks.map((check) => check.behavior_id),
    ]);
    const replayed = await replayDeliveryEvaluation({
      campaignRoot,
      reportPointer: persisted.reportPointer,
    });
    assert.equal(replayed.reportPointer.sha256, persisted.reportPointer.sha256);
    assert.equal(canonicalJsonDigest(replayed.report), canonicalJsonDigest(persisted.report));

    const mutantExperiment = parseExperimentSpec({
      ...experiment,
      campaign_id: "campaign-phase3b-mutant-no-lock",
    });
    const mutantCampaignRoot = `${projectRoot}/delivery-eval/campaign-phase3b-mutant-no-lock`;
    const mutantWorkspaces = {
      control: `${projectRoot}/workspaces/mutant-control`,
      treatment: `${projectRoot}/workspaces/mutant-treatment`,
    } as const;
    await Promise.all([
      cp(`${taskPackRoot}/base`, mutantWorkspaces.control, { recursive: true }),
      cp(`${taskPackRoot}/calibration/mutant-no-lock`, mutantWorkspaces.treatment, {
        recursive: true,
      }),
    ]);
    const mutantTrees = { control: "3".repeat(40), treatment: "4".repeat(40) } as const;
    const mutantCampaign = await runPairedCampaign({
      campaignRoot: mutantCampaignRoot,
      experiment: mutantExperiment,
      variants: { control: validControlVariant, treatment: validTreatmentVariant },
      taskPackIdentity,
      publicTask,
      executeArm: async (arm) => ({
        sessionId: `session-phase3b-mutant-${arm}`,
        sessionLog: syntheticSessionLog({
          arm,
          publicTask,
          sessionId: `session-phase3b-mutant-${arm}`,
        }),
        candidateTree: mutantTrees[arm],
        candidatePatch: Buffer.from(`${arm}-mutant-agent-patch`, "utf8"),
        candidateArchive: Buffer.from(`${arm}-mutant-agent-archive`, "utf8"),
        candidateChangedPaths: ["src/ledger.ts"],
        candidateUnauthorizedPaths: [],
        candidateForbiddenEntries: [],
        workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
        process: {
          started_at: "2026-08-21T00:40:00.000Z",
          ended_at: "2026-08-21T00:41:00.000Z",
          exit_code: 0,
          signal: null,
          timed_out: false,
        },
        elapsedMs: arm === "control" ? 60_000 : 62_000,
      }),
      evaluateArm: async (arm) => ({
        behavior: await oracle.evaluateDirectory(
          mutantWorkspaces[arm],
          1729,
          `${projectRoot}/oracle/mutant-${arm}`,
        ),
        candidateTreeAfterOracle: mutantTrees[arm],
        oracleSeed: { schema_version: 1, seed: 1729, oracle_version: "ledger-oracle-v3" },
      }),
    });
    const mutantPersisted = await persistDeliveryEvaluation({
      campaignRoot: mutantCampaignRoot,
      evaluationId: "delivery-implement-reservation-ledger-mutant-no-lock",
      claimIr: compiled.claimIr,
      oraclePlan: compiled.oraclePlan,
      admission,
      pairedEvaluation: mutantCampaign.pairedEvaluation,
      pairedReport: mutantCampaign.report,
      pairedEvaluationPointer: mutantCampaign.pointers.evaluation,
      pairedReportPointer: mutantCampaign.pointers.report,
    });
    assert.equal(mutantPersisted.report.verdict, "reject");
    assert.equal(mutantPersisted.report.axes.domain_preservation.status, "fail");

    const treatmentSession = await readFile(`${campaignRoot}/arms/treatment/session.jsonl`, "utf8");
    for (const hiddenText of [
      "reservation-command-contract",
      "claim-observation-catalog",
      "owner-reservation-command-contract",
    ]) {
      assert.equal(treatmentSession.includes(hiddenText), false);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
