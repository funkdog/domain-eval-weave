import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { EXIT_CODE } from "../../src/app/args.js";
import { DefaultAppExecutor } from "../../src/app/default-executor.js";
import { rebuildCampaignReport, runPairedCampaign } from "../../src/campaign/coordinator.js";
import { CampaignStateStore } from "../../src/campaign/state.js";
import { canonicalJson, canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { parseExperimentSpec } from "../../src/contracts/parsers.js";
import { fingerprintEvalDeployment } from "../../src/fingerprint/deployment.js";
import { PHASE2_INSTANCE } from "../../src/instance.js";
import type { BehaviorVector } from "../../src/oracle/ledger.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { parseTaskPackIdentity } from "../../src/task-pack/loader.js";
import {
  validControlVariant,
  validEvaluation,
  validExperiment,
  validTaskPackIdentity,
  validTreatmentVariant,
} from "../helpers/fixtures.js";
import { SYNTHETIC_PUBLIC_TASK, syntheticSessionLog } from "../helpers/session.js";

const variants = { control: validControlVariant, treatment: validTreatmentVariant } as const;
const taskPackIdentity = parseTaskPackIdentity(validTaskPackIdentity);
const passingBehavior = validEvaluation.outcome.behavior_vector as BehaviorVector;
const failingBehavior = {
  ...passingBehavior,
  basic_reservation: "fail",
} as BehaviorVector;

function armTree(arm: "control" | "treatment"): string {
  return arm === "control" ? "1".repeat(40) : "2".repeat(40);
}

function execution(
  arm: "control" | "treatment",
  options: {
    readonly goalActivated?: boolean;
    readonly includeUsage?: boolean;
    readonly signal?: string | null;
  } = {},
) {
  return {
    sessionId: `session-${arm}`,
    sessionLog: syntheticSessionLog({
      arm,
      ...(options.goalActivated === undefined ? {} : { goalActivated: options.goalActivated }),
      ...(options.includeUsage === undefined ? {} : { includeUsage: options.includeUsage }),
    }),
    candidateTree: armTree(arm),
    candidatePatch: Buffer.from(`${arm}-patch`, "utf8"),
    candidateArchive: Buffer.from(`${arm}-candidate`, "utf8"),
    candidateChangedPaths: ["src/ledger.ts"],
    candidateUnauthorizedPaths: [],
    candidateForbiddenEntries: [],
    workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
    process: {
      started_at: "2026-08-17T10:00:00.000Z",
      ended_at: "2026-08-17T10:01:00.000Z",
      exit_code: 0,
      signal: options.signal ?? null,
      timed_out: false,
    },
    elapsedMs: arm === "control" ? 60_000 : 65_000,
  } as const;
}

function evaluated(arm: "control" | "treatment", behavior: BehaviorVector = passingBehavior) {
  return {
    behavior,
    candidateTreeAfterOracle: armTree(arm),
    oracleSeed: { schema_version: 1 as const, seed: 1729, oracle_version: "ledger-oracle-v3" },
  };
}

test("fake paired Campaign semantically rebuilds Session + Oracle evidence with the same digest", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/campaign-e2e-`);
  const order: string[] = [];
  const evaluationOrder: string[] = [];
  let active = false;
  const experiment = parseExperimentSpec(validExperiment);
  try {
    const result = await runPairedCampaign({
      campaignRoot,
      experiment,
      variants,
      taskPackIdentity,
      publicTask: SYNTHETIC_PUBLIC_TASK,
      executeArm: async (arm) => {
        assert.equal(active, false);
        active = true;
        order.push(arm);
        await Promise.resolve();
        active = false;
        return execution(arm);
      },
      evaluateArm: async (arm) => {
        assert.equal(order.length, 2, "Oracle must not start until both arms are frozen");
        evaluationOrder.push(arm);
        return evaluated(arm);
      },
    });
    assert.deepEqual(order, experiment.arm_order);
    assert.deepEqual(evaluationOrder, ["control", "treatment"]);
    assert.equal(result.report.effect_claim_eligible, false);
    assert.equal(result.report.claim_strength, "diagnostic");
    const frozenEvaluation = await readFile(`${campaignRoot}/evaluation.json`);
    await rm(`${campaignRoot}/evaluation.json`);
    const rebuilt = await rebuildCampaignReport({ campaignRoot, pointers: result.pointers });
    assert.equal(rebuilt.reportPointer.sha256, result.pointers.report.sha256);
    assert.equal(rebuilt.markdownPointer.sha256, result.pointers.markdown.sha256);
    assert.deepEqual(await readFile(`${campaignRoot}/evaluation.json`), frozenEvaluation);
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("an interrupted arm persists interrupted state and never reports", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/campaign-interrupted-`);
  let calls = 0;
  const experiment = parseExperimentSpec(validExperiment);
  try {
    await assert.rejects(
      runPairedCampaign({
        campaignRoot,
        experiment,
        variants,
        taskPackIdentity,
        publicTask: SYNTHETIC_PUBLIC_TASK,
        executeArm: async () => {
          calls += 1;
          throw new Error("synthetic carrier failure");
        },
        evaluateArm: async (arm) => evaluated(arm),
      }),
    );
    assert.equal(calls, 1);
    const state = await new CampaignStateStore(`${campaignRoot}/campaign-state.json`).read();
    assert.equal(state.phase, "interrupted");
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("invalid top-level report still produces an independent measurement-invalid report", async () => {
  const campaignId = `campaign-invalid-report-${randomUUID()}`;
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaignId}`;
  await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
  const experiment = parseExperimentSpec({ ...validExperiment, campaign_id: campaignId });
  try {
    await runPairedCampaign({
      campaignRoot,
      experiment,
      variants,
      taskPackIdentity,
      publicTask: SYNTHETIC_PUBLIC_TASK,
      executeArm: async (arm) => execution(arm),
      evaluateArm: async (arm) => evaluated(arm),
    });
    const corruptedReport = Buffer.from("{not-json", "utf8");
    await writeFile(`${campaignRoot}/report.json`, corruptedReport);
    let stdout = "";
    let stderr = "";
    const executor = new DefaultAppExecutor({
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
    });
    assert.equal(
      await executor.execute({ kind: "report", campaignId }),
      EXIT_CODE.ARTIFACT_INTEGRITY_FAILURE,
    );
    assert.match(stdout, /Overall: \*\*invalid\*\*/);
    assert.match(stderr, /ARTIFACT_INTEGRITY_FAILURE/);
    assert.deepEqual(await readFile(`${campaignRoot}/report.json`), corruptedReport);
    const invalid = JSON.parse(await readFile(`${campaignRoot}/measurement-invalid.json`, "utf8"));
    assert.equal(invalid.measurement_validity.overall, "invalid");
    assert.equal(invalid.recommendation.action, "run_more");
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("missing top-level report still produces the standalone invalid envelope", async () => {
  const campaignId = `campaign-missing-report-${randomUUID()}`;
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaignId}`;
  await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
  let stdout = "";
  const executor = new DefaultAppExecutor({ stdout: (text) => (stdout += text) });
  try {
    assert.equal(
      await executor.execute({ kind: "report", campaignId }),
      EXIT_CODE.ARTIFACT_INTEGRITY_FAILURE,
    );
    assert.match(stdout, /Overall: \*\*invalid\*\*/);
    const invalid = JSON.parse(await readFile(`${campaignRoot}/measurement-invalid.json`, "utf8"));
    assert.equal(invalid.campaign_id, campaignId);
    assert.equal(invalid.measurement_validity.overall, "invalid");
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("legacy fixed-root report failure remains read-only", async () => {
  const campaignId = `campaign-legacy-read-only-${randomUUID()}`;
  const campaignRoot = `${DEDICATED_RUNTIME_ROOT}/campaigns/${campaignId}`;
  await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
  const experiment = parseExperimentSpec({ ...validExperiment, campaign_id: campaignId });
  try {
    await runPairedCampaign({
      campaignRoot,
      experiment,
      variants,
      taskPackIdentity,
      publicTask: SYNTHETIC_PUBLIC_TASK,
      executeArm: async (arm) => execution(arm),
      evaluateArm: async (arm) => evaluated(arm),
    });
    await writeFile(`${campaignRoot}/report.json`, "{broken", { mode: 0o600 });
    const executor = new DefaultAppExecutor();

    assert.equal(
      await executor.execute({ kind: "report", campaignId }),
      EXIT_CODE.ARTIFACT_INTEGRITY_FAILURE,
    );
    await assert.rejects(access(`${campaignRoot}/measurement-invalid.json`));
    await assert.rejects(access(`${campaignRoot}/measurement-invalid.md`));
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("legacy Oracle-v2 Campaign remains reportable read-only", async () => {
  const campaignId = `campaign-legacy-v2-${randomUUID()}`;
  const campaignRoot = `${DEDICATED_RUNTIME_ROOT}/campaigns/${campaignId}`;
  await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
  const legacyTaskPack = parseTaskPackIdentity({
    ...validTaskPackIdentity,
    pack: { ...validTaskPackIdentity.pack, oracle_version: "ledger-oracle-v2" },
  });
  const taskPackDigest = canonicalJsonDigest(legacyTaskPack);
  const deploymentDigest = fingerprintEvalDeployment({
    control: validControlVariant.resolved_config_sha256,
    treatment: validTreatmentVariant.resolved_config_sha256,
    task_pack: taskPackDigest,
    model: {
      provider: validControlVariant.model_route.provider,
      model: validControlVariant.model_route.model,
      effort: validControlVariant.model_route.reasoning_effort,
    },
    dsh_package_tree: validControlVariant.dsh_package_tree_sha256,
    codex_connect_package: validControlVariant.codex_connect_package_sha256,
    eval_package: validControlVariant.eval_package_sha256,
    common_patch: validControlVariant.common_patch_sha256,
  });
  const experiment = parseExperimentSpec({
    ...validExperiment,
    campaign_id: campaignId,
    task_pack_digest: taskPackDigest,
    deployment: {
      ...validExperiment.deployment,
      digest: deploymentDigest,
      qualification: {
        ...validExperiment.deployment.qualification,
        deployment_digest: deploymentDigest,
      },
      calibration: {
        ...validExperiment.deployment.calibration,
        task_pack_digest: taskPackDigest,
        candidates: {
          red: validExperiment.deployment.calibration.candidates.red,
          gold: validExperiment.deployment.calibration.candidates.gold,
          no_lock_failures: validExperiment.deployment.calibration.candidates.no_lock_failures,
          no_persistence_failures:
            validExperiment.deployment.calibration.candidates.no_persistence_failures,
          corrupt_resets_failures:
            validExperiment.deployment.calibration.candidates.corrupt_resets_failures,
        },
      },
    },
  });
  try {
    await runPairedCampaign({
      campaignRoot,
      experiment,
      variants,
      taskPackIdentity: legacyTaskPack,
      publicTask: SYNTHETIC_PUBLIC_TASK,
      executeArm: async (arm) => execution(arm),
      evaluateArm: async (arm) => ({
        ...evaluated(arm),
        oracleSeed: {
          schema_version: 1 as const,
          seed: 1729,
          oracle_version: "ledger-oracle-v2",
        },
      }),
    });
    const report = JSON.parse(await readFile(`${campaignRoot}/report.json`, "utf8"));
    const evaluation = JSON.parse(await readFile(`${campaignRoot}/evaluation.json`, "utf8"));
    for (const arm of ["control", "treatment"] as const) {
      const path = `${campaignRoot}/arms/${arm}/episode.json`;
      const episode = JSON.parse(await readFile(path, "utf8"));
      delete episode.measurement;
      await writeFile(path, canonicalJson(episode));
      const pointer = {
        ref: report.evidence[`${arm}_episode`].ref,
        sha256: canonicalJsonDigest(episode),
      };
      report.evidence[`${arm}_episode`] = pointer;
      evaluation.arms[arm].episode = pointer;
    }
    await writeFile(`${campaignRoot}/evaluation.json`, canonicalJson(evaluation));
    report.evidence.evaluation.sha256 = canonicalJsonDigest(evaluation);
    await writeFile(`${campaignRoot}/report.json`, canonicalJson(report));
    const frozenReport = await readFile(`${campaignRoot}/report.json`);
    let stdout = "";
    const executor = new DefaultAppExecutor({ stdout: (text) => (stdout += text) });

    assert.equal(await executor.execute({ kind: "report", campaignId }), EXIT_CODE.OK);
    assert.match(stdout, /Overall:/);
    assert.deepEqual(await readFile(`${campaignRoot}/report.json`), frozenReport);
    await assert.rejects(access(`${campaignRoot}/measurement-invalid.json`));
    await assert.rejects(access(`${campaignRoot}/measurement-invalid.md`));
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("secret-shaped carrier output is rejected before transcript or stdout persists", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/campaign-secret-`);
  const experiment = parseExperimentSpec(validExperiment);
  try {
    await assert.rejects(
      runPairedCampaign({
        campaignRoot,
        experiment,
        variants,
        taskPackIdentity,
        publicTask: SYNTHETIC_PUBLIC_TASK,
        executeArm: async (arm) => ({
          ...execution(arm),
          sessionLog: "access_token=synthetic-forbidden\n",
          stdout: "access_token=synthetic-forbidden",
        }),
        evaluateArm: async (arm) => evaluated(arm),
      }),
      /forbidden credential/,
    );
    await assert.rejects(access(`${campaignRoot}/arms/control/session.jsonl`));
    await assert.rejects(access(`${campaignRoot}/arms/control/stdout.txt`));
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("secret scan precedes derived evaluation/report writes and emits only a generic invalid envelope", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/campaign-derived-secret-`);
  const experiment = parseExperimentSpec(validExperiment);
  try {
    await assert.rejects(
      runPairedCampaign({
        campaignRoot,
        experiment,
        variants,
        taskPackIdentity,
        publicTask: SYNTHETIC_PUBLIC_TASK,
        executeArm: async (arm) =>
          execution(arm, { signal: arm === "control" ? "access_token" : null }),
        evaluateArm: async (arm) => evaluated(arm),
      }),
      /forbidden credential/,
    );
    await assert.rejects(access(`${campaignRoot}/evaluation.json`));
    await assert.rejects(access(`${campaignRoot}/report.json`));
    const invalidBytes = await readFile(`${campaignRoot}/measurement-invalid.json`, "utf8");
    assert.doesNotMatch(invalidBytes, /access_token/i);
    assert.equal(JSON.parse(invalidBytes).measurement_validity.overall, "invalid");
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("fake paired Campaign covers outcome, Goal activation, and usage recommendations", async () => {
  const cases = [
    {
      name: "control-fail-treatment-pass",
      controlBehavior: failingBehavior,
      treatmentBehavior: passingBehavior,
      action: "run_more",
    },
    {
      name: "control-pass-treatment-fail",
      controlBehavior: passingBehavior,
      treatmentBehavior: failingBehavior,
      action: "revert",
    },
    {
      name: "both-pass",
      controlBehavior: passingBehavior,
      treatmentBehavior: passingBehavior,
      action: "keep_baseline",
    },
    {
      name: "both-fail",
      controlBehavior: failingBehavior,
      treatmentBehavior: failingBehavior,
      action: "iterate",
    },
    {
      name: "goal-not-activated",
      controlBehavior: passingBehavior,
      treatmentBehavior: passingBehavior,
      goalActivated: false,
      action: "iterate",
    },
    {
      name: "usage-missing",
      controlBehavior: passingBehavior,
      treatmentBehavior: passingBehavior,
      includeUsage: false,
      action: "run_more",
    },
  ] as const;

  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  for (const scenario of cases) {
    const campaignRoot = await mkdtemp(`${parent}/campaign-matrix-${scenario.name}-`);
    try {
      const experiment = parseExperimentSpec({ ...validExperiment, campaign_id: scenario.name });
      const result = await runPairedCampaign({
        campaignRoot,
        experiment,
        variants,
        taskPackIdentity,
        publicTask: SYNTHETIC_PUBLIC_TASK,
        executeArm: async (arm) =>
          execution(arm, {
            ...(arm === "control"
              ? { goalActivated: false, includeUsage: true }
              : {
                  ...("goalActivated" in scenario ? { goalActivated: scenario.goalActivated } : {}),
                  ...("includeUsage" in scenario ? { includeUsage: scenario.includeUsage } : {}),
                }),
          }),
        evaluateArm: async (arm) =>
          evaluated(arm, arm === "control" ? scenario.controlBehavior : scenario.treatmentBehavior),
      });
      assert.equal(result.report.recommendation.action, scenario.action, scenario.name);
      assert.equal(result.report.effect_claim_eligible, false);
    } finally {
      await rm(campaignRoot, { recursive: true, force: true });
    }
  }
});
