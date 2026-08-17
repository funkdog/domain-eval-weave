import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalJson,
  canonicalJsonDigest,
  sha256Hex,
} from "../../src/contracts/canonical-json.js";
import { parseExperimentSpec, type VariantSpec } from "../../src/contracts/parsers.js";
import {
  SuiteArtifactIntegrityError,
  writeCanonicalSuiteArtifact,
} from "../../src/contracts/suite-artifacts.js";
import { ExposureLedger } from "../../src/exposure/ledger.js";
import { fingerprintEvalDeployment } from "../../src/fingerprint/deployment.js";
import type { BehaviorVector } from "../../src/oracle/ledger.js";
import { loadStaticEvalBinding } from "../../src/registry/loader.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import {
  rebuildSuiteReport,
  writeSuiteMeasurementInvalidEnvelope,
} from "../../src/suite/recovery.js";
import { reconstructSuiteReport, replaySuiteReport } from "../../src/suite/replay.js";
import { runPhase2Suite } from "../../src/suite/run.js";
import { runPhase2TaskCampaign } from "../../src/suite/task-campaign.js";
import { parseTaskPackIdentity } from "../../src/task-pack/loader.js";
import {
  validCalibrationEvidence,
  validControlVariant,
  validEvaluation,
  validExperiment,
  validTreatmentVariant,
} from "../helpers/fixtures.js";
import { syntheticSessionLog } from "../helpers/session.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const variants = {
  control: validControlVariant,
  treatment: validTreatmentVariant,
} as const satisfies Record<"control" | "treatment", VariantSpec>;
const behavior = validEvaluation.outcome.behavior_vector as BehaviorVector;

test("fake six-Episode Suite semantically replays from frozen primary evidence", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/fake-phase2-suite-`);
  const instanceRoot = `${scratch}/instance`;
  await mkdir(instanceRoot, { mode: 0o700 });
  await mkdir(`${instanceRoot}/campaigns`, { mode: 0o700 });
  const binding = await loadStaticEvalBinding(PACKAGE_ROOT);
  const ledger = new ExposureLedger(instanceRoot);
  try {
    const result = await runPhase2Suite({
      instanceRoot,
      binding,
      suiteId: "suite-fake-six",
      createdAt: "2026-08-18T01:00:00.000Z",
      deploymentDigest: validExperiment.deployment.digest,
      timeoutMsPerArm: 2_700_000,
      triggerFirst: true,
      campaignIdForTask: (task) => `campaign-${task.task_id}`,
      exposureLedger: ledger,
      beforeTasks: async () => validExperiment.deployment.qualification,
      runCampaign: async (plan) => {
        const campaignRoot = `${instanceRoot}/campaigns/${plan.campaignId}`;
        await mkdir(campaignRoot, { mode: 0o700 });
        const publicTask = await readFile(
          `${binding.packageRoot}/${plan.task.public_task_ref}`,
          "utf8",
        );
        const taskPackIdentity = parseTaskPackIdentity({
          schema_version: 1,
          pack: {
            schema_version: 1,
            task_id: "open-coding-ts-ledger-v1",
            eval_pack_id: "open-coding-delivery-v1",
            base_tree_sha256: plan.task.effective_base_sha256,
            public_task_ref: "public-task.md",
            allowed_candidate_globs: ["src/**"],
            forbidden_entry_types: ["symlink", "submodule"],
            public_test_command: ["node", "--test", "test/public/*.test.ts"],
            oracle_version: "ledger-oracle-v2",
            calibration_digest: validCalibrationEvidence.calibration_digest,
          },
          public_task_sha256: plan.task.public_task_sha256,
          oracle_runner_sha256: plan.task.oracle.runner_sha256,
        });
        const taskPackDigest = canonicalJsonDigest(taskPackIdentity);
        const deploymentDigest = fingerprintEvalDeployment({
          control: variants.control.resolved_config_sha256,
          treatment: variants.treatment.resolved_config_sha256,
          task_pack: taskPackDigest,
          model: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "xhigh" },
          dsh_package_tree: variants.control.dsh_package_tree_sha256,
          codex_connect_package: variants.control.codex_connect_package_sha256,
          eval_package: variants.control.eval_package_sha256,
          common_patch: variants.control.common_patch_sha256,
        });
        const experiment = parseExperimentSpec({
          ...structuredClone(validExperiment),
          campaign_id: plan.campaignId,
          task_pack_digest: taskPackDigest,
          deployment: {
            ...structuredClone(validExperiment.deployment),
            digest: deploymentDigest,
            qualification: {
              ...structuredClone(validExperiment.deployment.qualification),
            },
            qualification_projection: {
              source_deployment_digest: validExperiment.deployment.qualification.deployment_digest,
              projected_deployment_digest: deploymentDigest,
              source_qualification_sha256: canonicalJsonDigest(
                validExperiment.deployment.qualification,
              ),
            },
            calibration: {
              ...structuredClone(validExperiment.deployment.calibration),
              task_pack_digest: taskPackDigest,
              calibration_digest: taskPackIdentity.pack.calibration_digest,
            },
          },
        });
        return runPhase2TaskCampaign({
          suiteId: "suite-fake-six",
          campaignRoot,
          experiment,
          variants,
          task: plan.task,
          taskPackIdentity,
          publicTask,
          registryDigest: binding.digests.registry,
          bindingDigest: binding.digests.harness,
          exposureLedger: ledger,
          executeArm: async (arm) => {
            const sessionId = `session-${plan.task.task_id}-${arm}`;
            return {
              sessionId,
              sessionLog: syntheticSessionLog({
                arm,
                sessionId,
                publicTask,
                goalActivated: arm === "treatment" && plan.task.bucket === "trigger",
              }),
              candidateTree: sha256Hex(`${plan.task.task_id}-${arm}`).slice(0, 40),
              candidatePatch: Buffer.from(`${plan.task.task_id}-${arm}-patch`),
              candidateArchive: Buffer.from(`${plan.task.task_id}-${arm}-archive`),
              candidateChangedPaths: ["src/ledger.ts"],
              candidateUnauthorizedPaths: [],
              candidateForbiddenEntries: [],
              workspaceBaseDigest: plan.task.effective_base_sha256,
              process: {
                started_at: "2026-08-18T01:00:00.000Z",
                ended_at: "2026-08-18T01:01:00.000Z",
                exit_code: 0,
                signal: null,
                timed_out: false,
              },
              elapsedMs: 60_000,
            };
          },
          evaluateArm: async (_arm, output) => ({
            behavior,
            candidateTreeAfterOracle: output.candidateTree,
            oracleSeed: { schema_version: 1, seed: 1729, oracle_version: "ledger-oracle-v2" },
          }),
        });
      },
    });

    assert.equal((await ledger.list()).length, 6);
    assert.equal(result.report.measurement_validity, "valid");
    assert.equal(result.report.summary.trigger_activation, true);
    assert.equal(result.report.summary.non_trigger_guardrail, "pass");
    assert.equal(result.report.summary.holdout_activation_observed, false);
    assert.equal(result.report.recommendation.action, "keep");
    const replay = await replaySuiteReport(instanceRoot, result.suiteRoot, result.pointers.report, {
      markdownPointer: result.pointers.markdown,
    });
    assert.deepEqual(replay.reconstructed_report, result.report);

    const externalExposure = `${instanceRoot}/exposures/suite-fake-six--ledger-full-v1--control.json`;
    const externalExposureBytes = await readFile(externalExposure);
    await rm(externalExposure);
    await assert.rejects(
      reconstructSuiteReport(instanceRoot, result.suiteRoot),
      (error: unknown) =>
        error instanceof SuiteArtifactIntegrityError &&
        error.code === "SUITE_ARTIFACT_CROSS_REFERENCE_INVALID",
    );
    await assert.rejects(readFile(externalExposure), { code: "ENOENT" });
    await writeFile(externalExposure, externalExposureBytes, { flag: "wx", mode: 0o600 });

    const triggerCampaignRoot = `${instanceRoot}/campaigns/campaign-ledger-full-v1`;
    const activationPath = `${triggerCampaignRoot}/arms/treatment/activation.json`;
    const campaignPointerPath = `${result.suiteRoot}/tasks/ledger-full-v1/campaign-pointer.json`;
    const [activationBytes, campaignPointerBytes] = await Promise.all([
      readFile(activationPath),
      readFile(campaignPointerPath),
    ]);
    const alteredActivation = JSON.parse(activationBytes.toString("utf8")) as {
      events: { timestamp: string }[];
    };
    assert.ok(alteredActivation.events[0]);
    alteredActivation.events[0].timestamp = "2026-08-18T01:00:01.000Z";
    const alteredActivationBytes = canonicalJson(alteredActivation);
    const alteredCampaignPointer = JSON.parse(campaignPointerBytes.toString("utf8")) as {
      activation: { treatment: { sha256: string } };
    };
    alteredCampaignPointer.activation.treatment.sha256 = sha256Hex(alteredActivationBytes);
    await Promise.all([
      writeFile(activationPath, alteredActivationBytes),
      writeFile(campaignPointerPath, canonicalJson(alteredCampaignPointer)),
    ]);
    await assert.rejects(
      reconstructSuiteReport(instanceRoot, result.suiteRoot),
      (error: unknown) =>
        error instanceof SuiteArtifactIntegrityError &&
        error.code === "SUITE_ARTIFACT_CROSS_REFERENCE_INVALID",
    );
    await Promise.all([
      writeFile(activationPath, activationBytes),
      writeFile(campaignPointerPath, campaignPointerBytes),
    ]);
    await reconstructSuiteReport(instanceRoot, result.suiteRoot);

    const tamperedEvaluation = {
      ...replay.evaluation,
      summary: { ...replay.evaluation.summary, non_trigger_guardrail: "fail" as const },
    };
    const tamperedEvaluationPointer = await writeCanonicalSuiteArtifact(
      result.suiteRoot,
      "artifact://suite/evaluation-tampered.json",
      tamperedEvaluation,
    );
    const tamperedReportPointer = await writeCanonicalSuiteArtifact(
      result.suiteRoot,
      "artifact://suite/report-tampered.json",
      {
        ...result.report,
        summary: tamperedEvaluation.summary,
        evidence: { ...result.report.evidence, evaluation: tamperedEvaluationPointer },
      },
    );
    await assert.rejects(
      replaySuiteReport(instanceRoot, result.suiteRoot, tamperedReportPointer),
      (error: unknown) =>
        error instanceof SuiteArtifactIntegrityError &&
        error.code === "SUITE_ARTIFACT_CROSS_REFERENCE_INVALID",
    );

    const unknownTaskRoot = `${result.suiteRoot}/tasks/unknown-task`;
    await mkdir(unknownTaskRoot, { mode: 0o700 });
    await writeFile(`${unknownTaskRoot}/campaign-pointer.json`, "{}", { mode: 0o600 });
    await assert.rejects(
      reconstructSuiteReport(instanceRoot, result.suiteRoot),
      (error: unknown) =>
        error instanceof SuiteArtifactIntegrityError &&
        error.code === "SUITE_ARTIFACT_CROSS_REFERENCE_INVALID",
    );
    await rm(unknownTaskRoot, { recursive: true, force: true });

    await Promise.all([
      rm(`${result.suiteRoot}/evaluation.json`),
      rm(`${result.suiteRoot}/report.json`),
      rm(`${result.suiteRoot}/report.md`),
    ]);
    const rebuilt = await rebuildSuiteReport({ instanceRoot, suiteRoot: result.suiteRoot });
    assert.deepEqual(rebuilt.report, result.report);

    await writeFile(`${result.suiteRoot}/report.json`, "{broken", { mode: 0o600 });
    await assert.rejects(rebuildSuiteReport({ instanceRoot, suiteRoot: result.suiteRoot }));
    const invalid = await writeSuiteMeasurementInvalidEnvelope({
      suiteRoot: result.suiteRoot,
      suiteId: "suite-fake-six",
    });
    assert.equal(invalid.envelope.measurement_validity, "invalid");
    assert.match(
      await readFile(`${result.suiteRoot}/measurement-invalid.md`, "utf8"),
      /semantic replay/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Suite stops after infrastructure failure and leaves an independent invalid envelope", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/failed-phase2-suite-`);
  const instanceRoot = `${scratch}/instance`;
  await mkdir(instanceRoot, { mode: 0o700 });
  const binding = await loadStaticEvalBinding(PACKAGE_ROOT);
  const ledger = new ExposureLedger(instanceRoot);
  let attempts = 0;
  try {
    await assert.rejects(
      runPhase2Suite({
        instanceRoot,
        binding,
        suiteId: "suite-failed",
        createdAt: "2026-08-18T02:00:00.000Z",
        deploymentDigest: validExperiment.deployment.digest,
        timeoutMsPerArm: 2_700_000,
        triggerFirst: true,
        campaignIdForTask: (task) => `campaign-failed-${task.task_id}`,
        exposureLedger: ledger,
        beforeTasks: async () => validExperiment.deployment.qualification,
        runCampaign: async () => {
          attempts += 1;
          throw new Error("synthetic infrastructure failure");
        },
      }),
      /synthetic infrastructure failure/,
    );
    assert.equal(attempts, 1);
    assert.match(
      await readFile(`${instanceRoot}/suites/suite-failed/measurement-invalid.json`, "utf8"),
      /ARTIFACT_INTEGRITY_FAILURE/,
    );
    await assert.rejects(readFile(`${instanceRoot}/suites/suite-failed/report.json`, "utf8"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Suite id cannot escape the instance namespace", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/phase2-suite-id-`);
  const instanceRoot = `${scratch}/instance`;
  await mkdir(instanceRoot, { mode: 0o700 });
  const binding = await loadStaticEvalBinding(PACKAGE_ROOT);
  try {
    await assert.rejects(
      runPhase2Suite({
        instanceRoot,
        binding,
        suiteId: "../escape",
        createdAt: "2026-08-18T02:00:00.000Z",
        deploymentDigest: validExperiment.deployment.digest,
        timeoutMsPerArm: 2_700_000,
        triggerFirst: true,
        campaignIdForTask: () => "unused",
        exposureLedger: new ExposureLedger(instanceRoot),
        beforeTasks: async () => validExperiment.deployment.qualification,
        runCampaign: async () => {
          throw new Error("must not run");
        },
      }),
      /Suite id is invalid/,
    );
    await assert.rejects(readFile(`${scratch}/escape/manifest.json`, "utf8"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
