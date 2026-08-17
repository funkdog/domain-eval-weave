import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { EXIT_CODE } from "../../src/app/args.js";
import { DefaultAppExecutor } from "../../src/app/default-executor.js";
import { rebuildCampaignReport, runPairedCampaign } from "../../src/campaign/coordinator.js";
import { CampaignStateStore } from "../../src/campaign/state.js";
import { parseEvaluationResult, parseExperimentSpec } from "../../src/contracts/parsers.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { parseTaskPackIdentity } from "../../src/task-pack/loader.js";
import {
  validControlVariant,
  validEvaluation,
  validExperiment,
  validTaskPackIdentity,
  validTreatmentEvaluation,
  validTreatmentVariant,
} from "../helpers/fixtures.js";

const variants = { control: validControlVariant, treatment: validTreatmentVariant } as const;
const taskPackIdentity = parseTaskPackIdentity(validTaskPackIdentity);
const evaluated = (result: ReturnType<typeof parseEvaluationResult>) => ({
  result,
  behavior: result.outcome.behavior_vector,
  oracleSeed: { schema_version: 1 as const, seed: 1729, oracle_version: "ledger-oracle-v2" },
});

test("fake paired Campaign runs arms serially and artifact-only rebuild keeps the report digest", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/campaign-e2e-`);
  const order: string[] = [];
  const evaluationOrder: string[] = [];
  let active = false;
  const experiment = parseExperimentSpec(validExperiment);
  const controlEvaluation = parseEvaluationResult(validEvaluation);
  const treatmentEvaluation = parseEvaluationResult(validTreatmentEvaluation);
  try {
    const result = await runPairedCampaign({
      campaignRoot,
      experiment,
      variants,
      taskPackIdentity,
      executeArm: async (arm) => {
        assert.equal(active, false);
        active = true;
        order.push(arm);
        await Promise.resolve();
        active = false;
        return {
          sessionId: `session-${arm}`,
          sessionLog: `${JSON.stringify({ type: "session", arm })}\n`,
          candidateTree: arm === "control" ? "1".repeat(40) : "2".repeat(40),
          candidatePatch: Buffer.from(`${arm}-patch`, "utf8"),
          candidateArchive: Buffer.from(`${arm}-candidate`, "utf8"),
          workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
          process: {
            started_at: "2026-08-17T10:00:00.000Z",
            ended_at: "2026-08-17T10:01:00.000Z",
            exit_code: 0,
            signal: null,
            timed_out: false,
          },
        };
      },
      evaluateArm: async (arm) => {
        assert.equal(order.length, 2, "Oracle must not start until both arms are frozen");
        evaluationOrder.push(arm);
        return evaluated(arm === "control" ? controlEvaluation : treatmentEvaluation);
      },
    });
    assert.deepEqual(order, experiment.arm_order);
    assert.deepEqual(evaluationOrder, ["control", "treatment"]);
    assert.equal(result.report.effect_claim_eligible, false);
    assert.equal(result.report.claim_strength, "diagnostic");
    const rebuilt = await rebuildCampaignReport({ campaignRoot, pointers: result.pointers });
    assert.equal(rebuilt.reportPointer.sha256, result.pointers.report.sha256);
    assert.equal(rebuilt.markdownPointer.sha256, result.pointers.markdown.sha256);
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
  const controlEvaluation = parseEvaluationResult(validEvaluation);
  try {
    await assert.rejects(
      runPairedCampaign({
        campaignRoot,
        experiment,
        variants,
        taskPackIdentity,
        executeArm: async () => {
          calls += 1;
          throw new Error("synthetic carrier failure");
        },
        evaluateArm: async () => evaluated(controlEvaluation),
      }),
    );
    assert.equal(calls, 1);
    const state = await new CampaignStateStore(`${campaignRoot}/campaign-state.json`).read();
    assert.equal(state.phase, "interrupted");
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("report corruption writes a separate measurement-invalid report without overwriting", async () => {
  const campaignId = `campaign-invalid-report-${randomUUID()}`;
  const campaignRoot = `${DEDICATED_RUNTIME_ROOT}/campaigns/${campaignId}`;
  await mkdir(campaignRoot, { recursive: true, mode: 0o700 });
  const experiment = parseExperimentSpec({ ...validExperiment, campaign_id: campaignId });
  const controlEvaluation = parseEvaluationResult(validEvaluation);
  const treatmentEvaluation = parseEvaluationResult(validTreatmentEvaluation);
  try {
    await runPairedCampaign({
      campaignRoot,
      experiment,
      variants,
      taskPackIdentity,
      executeArm: async (arm) => ({
        sessionId: `session-${arm}`,
        sessionLog: `${JSON.stringify({ type: "session", arm })}\n`,
        candidateTree: arm === "control" ? "1".repeat(40) : "2".repeat(40),
        candidatePatch: Buffer.from(`${arm}-patch`),
        candidateArchive: Buffer.from(`${arm}-candidate`),
        workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
        process: {
          started_at: "2026-08-17T10:00:00.000Z",
          ended_at: "2026-08-17T10:01:00.000Z",
          exit_code: 0,
          signal: null,
          timed_out: false,
        },
      }),
      evaluateArm: async (arm) =>
        evaluated(arm === "control" ? controlEvaluation : treatmentEvaluation),
    });
    const originalReport = await readFile(`${campaignRoot}/report.json`);
    await writeFile(`${campaignRoot}/arms/control/candidate.patch`, "tampered-patch", "utf8");
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
    assert.deepEqual(await readFile(`${campaignRoot}/report.json`), originalReport);
    const invalid = JSON.parse(await readFile(`${campaignRoot}/measurement-invalid.json`, "utf8"));
    assert.equal(invalid.measurement_validity.overall, "invalid");
    assert.equal(invalid.recommendation.action, "run_more");
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("secret-shaped carrier output is rejected before any transcript or stdout artifact persists", async () => {
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
        executeArm: async (arm) => ({
          sessionId: `session-${arm}`,
          sessionLog: "access_token=synthetic-forbidden\n",
          candidateTree: "1".repeat(40),
          candidatePatch: Buffer.from("candidate-patch"),
          candidateArchive: Buffer.from("candidate"),
          workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
          process: {
            started_at: "2026-08-17T10:00:00.000Z",
            ended_at: "2026-08-17T10:01:00.000Z",
            exit_code: 0,
            signal: null,
            timed_out: false,
          },
          stdout: "access_token=synthetic-forbidden",
        }),
        evaluateArm: async () => evaluated(parseEvaluationResult(validEvaluation)),
      }),
      /forbidden credential/,
    );
    await assert.rejects(access(`${campaignRoot}/arms/control/session.jsonl`));
    await assert.rejects(access(`${campaignRoot}/arms/control/stdout.txt`));
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("fake paired Campaign covers the frozen outcome, Goal activation, and usage matrix", async () => {
  const passing = parseEvaluationResult(validEvaluation);
  const treatmentPassing = parseEvaluationResult(validTreatmentEvaluation);
  const failing = parseEvaluationResult({
    ...validEvaluation,
    outcome: {
      ...validEvaluation.outcome,
      externally_verified_completion: false,
      behavior_vector: {
        ...validEvaluation.outcome.behavior_vector,
        basic_reservation: "fail",
      },
      false_completion_claim: true,
    },
  });
  const treatmentFailing = parseEvaluationResult({
    ...validTreatmentEvaluation,
    outcome: failing.outcome,
  });
  const treatmentNotActivated = parseEvaluationResult({
    ...validTreatmentEvaluation,
    mechanism: validEvaluation.mechanism,
  });
  const missingUsage = parseEvaluationResult({
    ...validTreatmentEvaluation,
    measurement_validity: {
      overall: "insufficient",
      dimensions: { outcome: "valid", mechanism: "valid", cost: "insufficient" },
      reasons: [
        {
          code: "USAGE_MISSING",
          severity: "warning",
          message: "Synthetic usage is absent.",
          evidence_refs: [],
        },
      ],
    },
    cost: {
      ...validTreatmentEvaluation.cost,
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
    },
  });
  const cases = [
    {
      name: "control-fail-treatment-pass",
      control: failing,
      treatment: treatmentPassing,
      action: "run_more",
    },
    {
      name: "control-pass-treatment-fail",
      control: passing,
      treatment: treatmentFailing,
      action: "revert",
    },
    { name: "both-pass", control: treatmentPassing, treatment: treatmentPassing, action: "keep" },
    { name: "both-fail", control: failing, treatment: treatmentFailing, action: "iterate" },
    {
      name: "goal-not-activated",
      control: passing,
      treatment: treatmentNotActivated,
      action: "iterate",
    },
    { name: "usage-missing", control: passing, treatment: missingUsage, action: "run_more" },
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
        executeArm: async (arm) => ({
          sessionId: `session-${arm}`,
          sessionLog: `${JSON.stringify({ type: "session", arm })}\n`,
          candidateTree: arm === "control" ? "1".repeat(40) : "2".repeat(40),
          candidatePatch: Buffer.from(`${arm}-patch`),
          candidateArchive: Buffer.from(`${arm}-candidate`),
          workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
          process: {
            started_at: "2026-08-17T10:00:00.000Z",
            ended_at: "2026-08-17T10:01:00.000Z",
            exit_code: 0,
            signal: null,
            timed_out: false,
          },
        }),
        evaluateArm: async (arm) => evaluated(scenario[arm]),
      });
      assert.equal(result.report.recommendation.action, scenario.action, scenario.name);
      assert.equal(result.report.effect_claim_eligible, false);
    } finally {
      await rm(campaignRoot, { recursive: true, force: true });
    }
  }
});
