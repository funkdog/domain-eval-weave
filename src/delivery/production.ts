import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runRealCampaign } from "../campaign/real.js";
import { readArtifactBytesByRef } from "../contracts/artifacts.js";
import { canonicalJson } from "../contracts/canonical-json.js";
import { parseCurrentCalibrationEvidence } from "../contracts/parsers.js";
import { validateDomainPack } from "../domain/pack.js";
import { fingerprintPackageContent } from "../fingerprint/deployment.js";
import { PHASE2_INSTANCE, phase2CalibrationPath } from "../instance.js";
import { calibrateLedgerPackDetailed, projectCalibrationResult } from "../oracle/calibration.js";
import { LedgerOracle } from "../oracle/ledger.js";
import { StrictProcessRunner } from "../process/strict-runner.js";
import {
  digestTaskPack,
  loadObservationCatalog,
  loadTaskPackIdentity,
} from "../task-pack/loader.js";
import { buildGraderAdmission } from "./admission.js";
import {
  persistDeliveryEvaluation,
  renderDeliveryEvaluationMarkdown as renderDeliveryEvaluationMarkdownInternal,
  replayDeliveryEvaluation,
} from "./artifacts.js";
import { compileValidatedDeterministicGrader, DeterministicCompilerError } from "./compiler.js";
import type { DeliveryEvaluationReport } from "./contracts.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TASK_PACK_ROOT = `${PACKAGE_ROOT}/task-packs/open-coding-ts-ledger-v1`;
const DELIVERY_REPORT_REF = "artifact://campaign/delivery/report.json";

export class DeliveryProductionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeliveryProductionError";
    this.code = code;
  }
}

async function writeCurrentCalibrationEvidence(input: {
  readonly taskPackDigest: string;
  readonly calibrationDigest: string;
  readonly evalPackageDigest: string;
  readonly detailed: Awaited<ReturnType<typeof calibrateLedgerPackDetailed>>;
}): Promise<void> {
  const projected = projectCalibrationResult(input.detailed);
  if (!projected.ready) {
    throw new DeliveryProductionError(
      "DELIVERY_GRADER_NOT_ADMITTED",
      "detailed calibration cannot satisfy the frozen Campaign calibration contract",
    );
  }
  const evidence = parseCurrentCalibrationEvidence({
    ...projected,
    task_pack_digest: input.taskPackDigest,
    calibration_digest: input.calibrationDigest,
    eval_package_sha256: input.evalPackageDigest,
  });
  const path = phase2CalibrationPath(input.taskPackDigest, input.evalPackageDigest);
  const bytes = `${canonicalJson(evidence)}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== bytes) {
      throw new DeliveryProductionError(
        "DELIVERY_CALIBRATION_DRIFT",
        "an immutable calibration artifact already binds different bytes",
      );
    }
  }
}

export async function runRealDeliveryEvaluation(input: {
  readonly projectRoot: string;
  readonly packRef: string;
  readonly manifestRef: string;
  readonly requirementId: string;
  readonly timeoutMs: number;
  readonly confirm: (summary: string) => Promise<boolean>;
}): Promise<{
  readonly campaignId: string;
  readonly evaluationId: string;
  readonly verdict: "accept" | "reject" | "inconclusive";
  readonly reportPointer: { readonly ref: string; readonly sha256: string };
  readonly markdownPointer: { readonly ref: string; readonly sha256: string };
}> {
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs <= 0 ||
    input.timeoutMs > 5_400_000
  ) {
    throw new DeliveryProductionError(
      "DELIVERY_TIMEOUT_INVALID",
      "delivery timeout must be a positive integer no greater than 5400000 ms",
    );
  }
  const pack = await validateDomainPack(input.projectRoot, input.packRef, input.manifestRef);
  const [catalog, taskPackIdentity, taskPackDigest, evalPackageDigest] = await Promise.all([
    loadObservationCatalog(TASK_PACK_ROOT),
    loadTaskPackIdentity(TASK_PACK_ROOT),
    digestTaskPack(TASK_PACK_ROOT),
    fingerprintPackageContent(PACKAGE_ROOT),
  ]);
  let compiled: ReturnType<typeof compileValidatedDeterministicGrader>;
  try {
    compiled = compileValidatedDeterministicGrader({
      pack,
      requirementId: input.requirementId,
      taskPackDigest,
      catalog,
    });
  } catch (error) {
    if (error instanceof DeterministicCompilerError) {
      throw new DeliveryProductionError("DELIVERY_DOMAIN_TRUTH_NOT_READY", error.message);
    }
    throw error;
  }
  const scratchParent = `${PHASE2_INSTANCE.instanceRoot}/calibration/delivery`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratchRoot = await mkdtemp(`${scratchParent}/run-${randomUUID().slice(0, 8)}-`);
  let detailed: Awaited<ReturnType<typeof calibrateLedgerPackDetailed>>;
  try {
    detailed = await calibrateLedgerPackDetailed({
      oracle: new LedgerOracle({
        runner: new StrictProcessRunner(),
        oracleRunnerPath: `${TASK_PACK_ROOT}/oracle/runner.mjs`,
      }),
      packRoot: TASK_PACK_ROOT,
      scratchRoot,
      seed: 1729,
    });
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
  const admission = buildGraderAdmission({
    oraclePlan: compiled.oraclePlan,
    catalog,
    calibration: detailed,
    seed: 1729,
    evalPackageDigest,
  });
  if (admission.status !== "admitted") {
    throw new DeliveryProductionError(
      "DELIVERY_GRADER_NOT_ADMITTED",
      "the frozen deterministic Grader failed admission before any Candidate model call",
    );
  }
  await writeCurrentCalibrationEvidence({
    taskPackDigest,
    calibrationDigest: taskPackIdentity.pack.calibration_digest,
    evalPackageDigest,
    detailed,
  });

  const campaign = await runRealCampaign({
    packageRoot: PACKAGE_ROOT,
    timeoutMs: input.timeoutMs,
    confirm: (summary) =>
      input.confirm(
        `Evaluate confirmed Requirement ${input.requirementId} with admitted Plan ${compiled.oraclePlan.plan_id}. ${summary}`,
      ),
  });
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaign.campaignId}`;
  const evaluationId = `delivery-${campaign.campaignId}`;
  const persisted = await persistDeliveryEvaluation({
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

export function renderDeliveryEvaluationMarkdown(report: DeliveryEvaluationReport): string {
  return renderDeliveryEvaluationMarkdownInternal(report);
}

export async function replayRealDeliveryEvaluation(campaignId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(campaignId)) {
    throw new DeliveryProductionError(
      "DELIVERY_CAMPAIGN_ID_INVALID",
      "delivery replay requires one valid Campaign id",
    );
  }
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaignId}`;
  const { pointer } = await readArtifactBytesByRef(campaignRoot, DELIVERY_REPORT_REF);
  return replayDeliveryEvaluation({ campaignRoot, reportPointer: pointer });
}
