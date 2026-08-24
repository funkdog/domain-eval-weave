import { readArtifactBytesByRef } from "../contracts/artifacts.js";
import { PHASE2_INSTANCE } from "../instance.js";
import { renderPhase3cDeliveryReport, replayPhase3cEvaluation } from "./artifacts.js";
import { unavailableTddSkillDeployment } from "./tdd-binding.js";

const MANIFEST_REF = "artifact://campaign/phase3c/replay-manifest.json";

export class Phase3cProductionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "Phase3cProductionError";
  }
}

export async function runRealPhase3cDelivery(input: {
  readonly projectRoot: string;
  readonly packRef: string;
  readonly manifestRef: string;
  readonly requirementId: string;
  readonly timeoutMs: number;
  readonly confirm: (summary: string) => Promise<boolean>;
}): Promise<never> {
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs <= 0 ||
    input.timeoutMs > 5_400_000
  ) {
    throw new Phase3cProductionError(
      "PHASE3C_TIMEOUT_INVALID",
      "Phase 3C timeout must be a positive integer no greater than 5400000 ms",
    );
  }
  const deployment = unavailableTddSkillDeployment("skill_not_installed");
  throw new Phase3cProductionError(
    "PHASE3C_TDD_SKILL_UNAVAILABLE",
    `Phase 3C real Harness acceptance is fail-closed because the exact external TDD Skill deployment is ${deployment.availability}; no Candidate Episode was started`,
  );
}

export async function replayRealPhase3cDelivery(campaignId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(campaignId)) {
    throw new Phase3cProductionError(
      "PHASE3C_CAMPAIGN_ID_INVALID",
      "Phase 3C replay requires one valid Campaign id",
    );
  }
  const campaignRoot = `${PHASE2_INSTANCE.instanceRoot}/campaigns/${campaignId}`;
  const { pointer } = await readArtifactBytesByRef(campaignRoot, MANIFEST_REF);
  const replayed = await replayPhase3cEvaluation({ campaignRoot, manifestPointer: pointer });
  return { report: replayed.report, reportPointer: replayed.manifest.delivery_report };
}

export function renderRealPhase3cDelivery(report: unknown): string {
  return renderPhase3cDeliveryReport(report);
}
