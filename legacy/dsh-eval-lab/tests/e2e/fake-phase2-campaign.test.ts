import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { parseExperimentSpec, type VariantSpec } from "../../src/contracts/parsers.js";
import { parseTaskEntry } from "../../src/contracts/phase2.js";
import { ExposureLedger } from "../../src/exposure/ledger.js";
import type { BehaviorVector } from "../../src/oracle/ledger.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { runPhase2TaskCampaign } from "../../src/suite/task-campaign.js";
import { parseTaskPackIdentity } from "../../src/task-pack/loader.js";
import {
  validControlVariant,
  validEvaluation,
  validExperiment,
  validTaskPackIdentity,
  validTreatmentVariant,
} from "../helpers/fixtures.js";
import { validTaskEntry } from "../helpers/phase2-fixtures.js";
import { SYNTHETIC_PUBLIC_TASK, syntheticSessionLog } from "../helpers/session.js";

const variants = {
  control: validControlVariant,
  treatment: validTreatmentVariant,
} as const satisfies Record<"control" | "treatment", VariantSpec>;
const taskPackIdentity = parseTaskPackIdentity(validTaskPackIdentity);
const behavior = validEvaluation.outcome.behavior_vector as BehaviorVector;

test("Phase 2 Campaign freezes activation and exposure before Oracle", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/fake-phase2-campaign-`);
  const campaignRoot = `${scratch}/campaign`;
  await mkdir(campaignRoot, { mode: 0o700 });
  const ledger = new ExposureLedger(`${scratch}/instance`);
  const experiment = parseExperimentSpec({
    ...validExperiment,
    campaign_id: "campaign-phase2-trigger",
  });
  try {
    const result = await runPhase2TaskCampaign({
      suiteId: "suite-phase2",
      campaignRoot,
      experiment,
      variants,
      task: parseTaskEntry({
        ...validTaskEntry,
        public_task_sha256: validTaskPackIdentity.public_task_sha256,
        effective_base_sha256: validTaskPackIdentity.pack.base_tree_sha256,
        oracle: {
          ...validTaskEntry.oracle,
          runner_sha256: validTaskPackIdentity.oracle_runner_sha256,
        },
      }),
      taskPackIdentity,
      publicTask: SYNTHETIC_PUBLIC_TASK,
      registryDigest: "7".repeat(64),
      bindingDigest: "8".repeat(64),
      exposureLedger: ledger,
      executeArm: async (arm) => ({
        sessionId: `session-${arm}`,
        sessionLog: syntheticSessionLog({ arm }),
        candidateTree: arm === "control" ? "1".repeat(40) : "2".repeat(40),
        candidatePatch: Buffer.from(`${arm}-patch`),
        candidateArchive: Buffer.from(`${arm}-archive`),
        candidateChangedPaths: ["src/ledger.ts"],
        candidateUnauthorizedPaths: [],
        candidateForbiddenEntries: [],
        workspaceBaseDigest: validTaskPackIdentity.pack.base_tree_sha256,
        process: {
          started_at: "2026-08-18T00:00:00.000Z",
          ended_at: "2026-08-18T00:01:00.000Z",
          exit_code: 0,
          signal: null,
          timed_out: false,
        },
        elapsedMs: 60_000,
      }),
      evaluateArm: async (arm, output) => {
        assert.equal((await ledger.list()).length, 2, "both model exposures precede Oracle");
        assert.ok(await readFile(`${campaignRoot}/arms/${arm}/activation.json`, "utf8"));
        assert.ok(await readFile(`${campaignRoot}/arms/${arm}/exposure.json`, "utf8"));
        return {
          behavior,
          candidateTreeAfterOracle: output.candidateTree,
          oracleSeed: { schema_version: 1, seed: 1729, oracle_version: "ledger-oracle-v3" },
        };
      },
    });

    assert.equal(result.report.campaign_id, experiment.campaign_id);
    const exposures = await ledger.list();
    assert.equal(exposures.length, 2);
    assert.deepEqual(
      exposures.map(({ task_id, bucket, arm }) => ({ task_id, bucket, arm })),
      [
        { task_id: "ledger-full-v1", bucket: "trigger", arm: "control" },
        { task_id: "ledger-full-v1", bucket: "trigger", arm: "treatment" },
      ],
    );
    const control = JSON.parse(
      await readFile(`${campaignRoot}/arms/control/activation.json`, "utf8"),
    );
    const treatment = JSON.parse(
      await readFile(`${campaignRoot}/arms/treatment/activation.json`, "utf8"),
    );
    assert.equal(control.summary.activated, false);
    assert.equal(treatment.summary.activated, true);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
