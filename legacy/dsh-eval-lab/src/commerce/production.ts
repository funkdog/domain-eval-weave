import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { readArtifactBytesByRef } from "../contracts/artifacts.js";
import { canonicalJsonDigest } from "../contracts/canonical-json.js";
import { validateDomainPack } from "../domain/pack.js";
import { fingerprintPackageContent } from "../fingerprint/deployment.js";
import { PHASE2_INSTANCE } from "../instance.js";
import { calibrateCommercePackDetailed } from "../oracle/commerce-calibration.js";
import { CommerceOrderOracle } from "../oracle/commerce-order.js";
import { StrictProcessRunner } from "../process/strict-runner.js";
import {
  digestTaskPack,
  loadObservationCatalog,
  loadTaskPackIdentity,
} from "../task-pack/loader.js";
import { buildCommerceGraderAdmission } from "./admission.js";
import { parseCommerceObservationCatalog } from "./catalog.js";
import { CommerceCompilerError, compileCommerceGrader } from "./compiler.js";
import {
  persistCommerceDelivery,
  renderCommerceDeliveryReport,
  replayCommerceDelivery,
} from "./delivery-artifacts.js";
import { runRealCommerceCampaign } from "./real-campaign.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACK_ROOT = `${PACKAGE_ROOT}/task-packs/open-coding-ts-commerce-order-v1`;
const REPORT_REF = "artifact://campaign/delivery/report.json";

export class CommerceProductionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommerceProductionError";
    this.code = code;
  }
}

export async function runRealCommerceDelivery(input: {
  readonly projectRoot: string;
  readonly packRef: string;
  readonly manifestRef: string;
  readonly requirementId: string;
  readonly timeoutMs: number;
  readonly confirm: (summary: string) => Promise<boolean>;
}) {
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs <= 0 ||
    input.timeoutMs > 5_400_000
  ) {
    throw new CommerceProductionError(
      "COMMERCE_TIMEOUT_INVALID",
      "Commerce timeout must be a positive integer no greater than 5400000 ms",
    );
  }
  const pack = await validateDomainPack(input.projectRoot, input.packRef, input.manifestRef);
  const [catalogValue, taskPackIdentity, taskPackDigest, evalPackageDigest] = await Promise.all([
    loadObservationCatalog(PACK_ROOT),
    loadTaskPackIdentity(PACK_ROOT),
    digestTaskPack(PACK_ROOT),
    fingerprintPackageContent(PACKAGE_ROOT),
  ]);
  const catalog = parseCommerceObservationCatalog(catalogValue);
  if (
    taskPackIdentity.schema_version !== 2 ||
    taskPackIdentity.template_id !== "commerce-order-cancellation-v1"
  ) {
    throw new CommerceProductionError(
      "COMMERCE_TASK_PACK_INVALID",
      "Commerce production Task Pack identity drifted",
    );
  }
  let compiled: ReturnType<typeof compileCommerceGrader>;
  try {
    compiled = compileCommerceGrader({
      pack,
      requirementId: input.requirementId,
      taskPackDigest,
      catalog,
    });
  } catch (error) {
    if (error instanceof CommerceCompilerError) {
      throw new CommerceProductionError("COMMERCE_DOMAIN_TRUTH_NOT_READY", error.message);
    }
    throw error;
  }
  const scratchParent = `${PHASE2_INSTANCE.instanceRoot}/calibration/commerce-delivery`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/run-${randomUUID().slice(0, 8)}-`);
  let calibration: Awaited<ReturnType<typeof calibrateCommercePackDetailed>>;
  try {
    calibration = await calibrateCommercePackDetailed({
      oracle: new CommerceOrderOracle({
        runner: new StrictProcessRunner(),
        oracleRunnerPath: `${PACK_ROOT}/oracle/runner.mjs`,
      }),
      packRoot: PACK_ROOT,
      scratchRoot: scratch,
      seed: 1729,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const admission = buildCommerceGraderAdmission({
    oraclePlan: compiled.oraclePlan,
    catalog,
    calibration,
    seed: 1729,
    evalPackageDigest,
  });
  if (admission.status !== "admitted") {
    throw new CommerceProductionError(
      "COMMERCE_GRADER_NOT_ADMITTED",
      "Commerce deterministic Grader failed admission before Candidate execution",
    );
  }
  const campaign = await runRealCommerceCampaign({
    packageRoot: PACKAGE_ROOT,
    timeoutMs: input.timeoutMs,
    admissionSha256: canonicalJsonDigest(admission),
    confirm: (summary) =>
      input.confirm(
        `Evaluate Commerce Requirement ${input.requirementId} with admitted Plan ${compiled.oraclePlan.plan_id}. ${summary}`,
      ),
  });
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaign.campaignId}`;
  const evaluationId = `commerce-delivery-${campaign.campaignId}`;
  const persisted = await persistCommerceDelivery({
    campaignRoot,
    evaluationId,
    claimIr: compiled.claimIr,
    oraclePlan: compiled.oraclePlan,
    catalog,
    admission,
    pairedReportPointer: campaign.pointers.report,
  });
  return {
    campaignId: campaign.campaignId,
    evaluationId,
    verdict: persisted.report.verdict,
    reportPointer: persisted.reportPointer,
    markdownPointer: persisted.markdownPointer,
  };
}

export async function replayRealCommerceDelivery(campaignId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(campaignId)) {
    throw new CommerceProductionError(
      "COMMERCE_CAMPAIGN_ID_INVALID",
      "Commerce replay requires one valid Campaign id",
    );
  }
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaignId}`;
  const { pointer } = await readArtifactBytesByRef(campaignRoot, REPORT_REF);
  return replayCommerceDelivery({ campaignRoot, reportPointer: pointer });
}

export function renderRealCommerceDelivery(report: unknown): string {
  return renderCommerceDeliveryReport(report as Parameters<typeof renderCommerceDeliveryReport>[0]);
}
