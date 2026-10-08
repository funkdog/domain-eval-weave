import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCommerceGraderAdmission } from "../../src/commerce/admission.js";
import { runCommercePairedCampaign } from "../../src/commerce/campaign.js";
import { parseCommerceExperiment } from "../../src/commerce/campaign-contracts.js";
import { parseCommerceObservationCatalog } from "../../src/commerce/catalog.js";
import { compileCommerceGrader } from "../../src/commerce/compiler.js";
import {
  persistCommerceDelivery,
  replayCommerceDelivery,
} from "../../src/commerce/delivery-artifacts.js";
import { ArtifactIntegrityError } from "../../src/contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { validateDomainPack } from "../../src/domain/pack.js";
import { fingerprintEvalDeployment } from "../../src/fingerprint/deployment.js";
import { calibrateCommercePackDetailed } from "../../src/oracle/commerce-calibration.js";
import { CommerceOrderOracle } from "../../src/oracle/commerce-order.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { digestTaskPack, loadTaskPackIdentity } from "../../src/task-pack/loader.js";
import {
  validCommerceControlVariant,
  validCommerceTreatmentVariant,
} from "../helpers/commerce-artifact-fixtures.js";
import { writeSyntheticCommerceDomainPack } from "../helpers/commerce-domain-pack.js";
import {
  validControlVariant,
  validExperiment,
  validTreatmentVariant,
} from "../helpers/fixtures.js";
import { syntheticSessionLog } from "../helpers/session.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v1", import.meta.url),
);

test("a Commerce paired Campaign freezes two Agent outcomes without ledger semantics", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/commerce-campaign-`);
  try {
    const domain = await writeSyntheticCommerceDomainPack(root);
    const validated = await validateDomainPack(root, "domain-eval", domain.manifestRef, {
      confirmationLedger: domain.confirmationLedger,
    });
    const [taskPackIdentity, taskPackDigest, publicTask] = await Promise.all([
      loadTaskPackIdentity(packRoot),
      digestTaskPack(packRoot),
      readFile(`${packRoot}/public-task.md`, "utf8"),
    ]);
    assert.equal(taskPackIdentity.schema_version, 2);
    const catalog = parseCommerceObservationCatalog(
      JSON.parse(await readFile(`${packRoot}/claim-observation-catalog.json`, "utf8")),
    );
    const compiled = compileCommerceGrader({
      pack: validated,
      requirementId: "self-service-order-cancellation",
      taskPackDigest,
      catalog,
    });
    const { claimIr, oraclePlan: plan } = compiled;
    const calibration = await calibrateCommercePackDetailed({
      oracle: new CommerceOrderOracle({
        runner: new StrictProcessRunner(),
        oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
      }),
      packRoot,
      scratchRoot: `${root}/calibration`,
      seed: 1729,
    });
    const admission = buildCommerceGraderAdmission({
      oraclePlan: plan,
      catalog,
      calibration,
      seed: 1729,
      evalPackageDigest: validControlVariant.eval_package_sha256,
    });
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
    const experiment = parseCommerceExperiment({
      schema_version: 2,
      template_id: "commerce-order-cancellation-v1",
      campaign_id: "campaign-commerce-synthetic",
      created_at: "2026-08-21T00:00:00.000Z",
      domain: "open-coding-commerce-delivery",
      eval_pack_id: "open-coding-commerce-delivery-v1",
      task_pack_digest: taskPackDigest,
      control_variant_digest: canonicalJsonDigest(validCommerceControlVariant),
      treatment_variant_digest: canonicalJsonDigest(validCommerceTreatmentVariant),
      deployment: {
        digest: deploymentDigest,
        eval_package_sha256: validControlVariant.eval_package_sha256,
        qualification: {
          ...validExperiment.deployment.qualification,
          deployment_digest: deploymentDigest,
        },
        grader_admission_sha256: canonicalJsonDigest(admission),
      },
      intervention: validExperiment.intervention,
      arm_order: ["treatment", "control"],
      timeout_ms_per_arm: 900_000,
      claim_strength: "diagnostic",
      effect_claim_eligible: false,
    });
    const campaignRoot = `${root}/campaign`;
    const workspaces = {
      control: `${root}/workspaces/control`,
      treatment: `${root}/workspaces/treatment`,
    } as const;
    await Promise.all([
      cp(`${packRoot}/base`, workspaces.control, { recursive: true }),
      cp(`${packRoot}/calibration/gold-equivalent`, workspaces.treatment, {
        recursive: true,
      }),
    ]);
    const trees = { control: "1".repeat(40), treatment: "2".repeat(40) } as const;
    const oracle = new CommerceOrderOracle({
      runner: new StrictProcessRunner(),
      oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
    });
    const result = await runCommercePairedCampaign({
      campaignRoot,
      experiment,
      variants: {
        control: validCommerceControlVariant,
        treatment: validCommerceTreatmentVariant,
      },
      taskPackIdentity,
      publicTask,
      executeArm: async (arm) => ({
        sessionId: `session-commerce-${arm}`,
        sessionLog: syntheticSessionLog({
          arm,
          publicTask,
          sessionId: `session-commerce-${arm}`,
        }),
        candidateTree: trees[arm],
        candidatePatch: Buffer.from(`${arm}-commerce-patch`),
        candidateArchive: Buffer.from(`${arm}-commerce-archive`),
        candidateChangedPaths: ["src/order-service.ts"],
        candidateUnauthorizedPaths: [],
        candidateForbiddenEntries: [],
        workspaceBaseDigest: taskPackIdentity.pack.base_tree_sha256,
        process: {
          started_at: "2026-08-21T00:00:00.000Z",
          ended_at: "2026-08-21T00:01:00.000Z",
          exit_code: 0,
          signal: null,
          timed_out: false,
        },
        elapsedMs: arm === "control" ? 60_000 : 65_000,
      }),
      evaluateArm: async (arm) => ({
        behavior: await oracle.evaluateDirectory(workspaces[arm], 1730, `${root}/oracle/${arm}`),
        candidateTreeAfterOracle: trees[arm],
        oracleSeed: {
          schema_version: 2,
          template_id: "commerce-order-cancellation-v1",
          seed: 1730,
          oracle_version: "commerce-order-oracle-v1",
        },
      }),
    });
    assert.equal(
      result.pairedEvaluation.arms.treatment.result.outcome.externally_verified_completion,
      true,
    );
    assert.equal(
      result.pairedEvaluation.arms.control.result.outcome.externally_verified_completion,
      false,
    );
    assert.equal(result.report.template_id, "commerce-order-cancellation-v1");
    assert.equal(result.report.measurement_validity.overall, "valid");
    const badDeploymentRoot = `${root}/campaign-bad-deployment`;
    await cp(campaignRoot, badDeploymentRoot, { recursive: true });
    await assert.rejects(
      persistCommerceDelivery({
        campaignRoot: badDeploymentRoot,
        evaluationId: "delivery-commerce-bad-deployment",
        claimIr,
        oraclePlan: plan,
        catalog,
        admission: { ...admission, eval_package_sha256: "0".repeat(64) },
        pairedReportPointer: result.pointers.report,
      }),
      /does not bind the replayed Campaign deployment/,
    );
    const ghostPlan = {
      ...plan,
      checks: plan.checks.map((check, index) =>
        index === 0 ? { ...check, claim_ids: ["ghost-commerce-claim"] } : check,
      ),
    };
    const ghostPlanRoot = `${root}/campaign-ghost-plan`;
    await cp(campaignRoot, ghostPlanRoot, { recursive: true });
    await assert.rejects(
      persistCommerceDelivery({
        campaignRoot: ghostPlanRoot,
        evaluationId: "delivery-commerce-ghost-plan",
        claimIr,
        oraclePlan: ghostPlan,
        catalog,
        admission: { ...admission, oracle_plan_sha256: canonicalJsonDigest(ghostPlan) },
        pairedReportPointer: result.pointers.report,
      }),
      /semantic replay drifted/,
    );
    const delivery = await persistCommerceDelivery({
      campaignRoot,
      evaluationId: "delivery-commerce-synthetic",
      claimIr,
      oraclePlan: plan,
      catalog,
      admission,
      pairedReportPointer: result.pointers.report,
    });
    assert.equal(delivery.report.verdict, "accept");
    const replayed = await replayCommerceDelivery({
      campaignRoot,
      reportPointer: delivery.reportPointer,
    });
    assert.equal(replayed.reportPointer.sha256, delivery.reportPointer.sha256);
    const seedDriftRoot = `${root}/campaign-seed-drift`;
    await cp(campaignRoot, seedDriftRoot, { recursive: true });
    await writeFile(
      `${seedDriftRoot}/oracle/seed.json`,
      canonicalJson({
        schema_version: 2,
        template_id: "commerce-order-cancellation-v1",
        seed: 1731,
        oracle_version: "commerce-order-oracle-v1",
      }),
    );
    await assert.rejects(
      replayCommerceDelivery({
        campaignRoot: seedDriftRoot,
        reportPointer: delivery.reportPointer,
      }),
      ArtifactIntegrityError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
