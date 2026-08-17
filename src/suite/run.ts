import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { readJsonArtifact } from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  parseActivationArtifact,
  parseCampaignPointerArtifact,
  parseRegistrySnapshot,
  type SuiteManifest,
  type TaskEntry,
} from "../contracts/phase2.js";
import { parseSuiteArtifactRef } from "../contracts/suite-artifact-ref.js";
import {
  type SuiteArtifactPointer,
  writeCanonicalSuiteArtifact,
  writeSuiteArtifactBytes,
} from "../contracts/suite-artifacts.js";
import type { ExposureLedger } from "../exposure/ledger.js";
import type { StaticEvalBinding } from "../registry/loader.js";
import { assertSecretFreeText } from "../report/secret-scan.js";
import { executePlannedSuite, type PlannedSuiteTask } from "./coordinator.js";
import { writeSuiteMeasurementInvalidEnvelope } from "./recovery.js";
import { replaySuiteReport } from "./replay.js";
import { buildSuiteEvaluation, buildSuiteReport, renderSuiteReportMarkdown } from "./reporter.js";
import type { Phase2TaskCampaignResult } from "./task-campaign.js";

async function prepareSuiteRoot(instanceRoot: string, suiteId: string): Promise<string> {
  if (!isAbsolute(instanceRoot)) throw new Error("Phase 2 instance root must be absolute");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(suiteId)) {
    throw new Error("Phase 2 Suite id is invalid");
  }
  const stat = await lstat(instanceRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Phase 2 instance root must be a physical directory");
  }
  const physicalInstance = await realpath(instanceRoot);
  const suites = resolve(physicalInstance, "suites");
  await mkdir(suites, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const suitesStat = await lstat(suites);
  if (suitesStat.isSymbolicLink() || !suitesStat.isDirectory()) {
    throw new Error("Phase 2 Suites root must be a physical directory");
  }
  const suiteRoot = resolve(suites, suiteId);
  await mkdir(suiteRoot, { mode: 0o700 });
  return suiteRoot;
}

function registrySnapshot(binding: StaticEvalBinding) {
  return parseRegistrySnapshot({
    schema_version: 1,
    registry: binding.registry,
    eval_pack: binding.evalPack,
    tasks: binding.tasks,
    digests: {
      registry: binding.digests.registry,
      eval_pack: binding.digests.evalPack,
      tasks: binding.digests.tasks,
    },
  });
}

export async function runPhase2Suite(input: {
  readonly instanceRoot: string;
  readonly binding: StaticEvalBinding;
  readonly suiteId: string;
  readonly createdAt: string;
  readonly deploymentDigest: string;
  readonly timeoutMsPerArm: number;
  readonly triggerFirst: boolean;
  readonly campaignIdForTask: (task: TaskEntry) => string;
  readonly exposureLedger: ExposureLedger;
  readonly runCampaign: (
    plan: PlannedSuiteTask,
    manifest: SuiteManifest,
  ) => Promise<Phase2TaskCampaignResult>;
}): Promise<{
  readonly suiteRoot: string;
  readonly report: ReturnType<typeof buildSuiteReport>;
  readonly pointers: {
    readonly manifest: SuiteArtifactPointer;
    readonly binding: SuiteArtifactPointer;
    readonly registrySnapshot: SuiteArtifactPointer;
    readonly evaluation: SuiteArtifactPointer;
    readonly report: SuiteArtifactPointer;
    readonly markdown: SuiteArtifactPointer;
  };
}> {
  const suiteRoot = await prepareSuiteRoot(input.instanceRoot, input.suiteId);
  try {
    const snapshot = registrySnapshot(input.binding);
    let primaryPointers:
      | {
          manifest: SuiteArtifactPointer;
          binding: SuiteArtifactPointer;
          registrySnapshot: SuiteArtifactPointer;
        }
      | undefined;
    const execution = await executePlannedSuite({
      binding: input.binding,
      suiteId: input.suiteId,
      createdAt: input.createdAt,
      deploymentDigest: input.deploymentDigest,
      timeoutMsPerArm: input.timeoutMsPerArm,
      triggerFirst: input.triggerFirst,
      campaignIdForTask: input.campaignIdForTask,
      holdoutGate: input.exposureLedger,
      freezeManifest: async (manifest) => {
        const [manifestPointer, bindingPointer, snapshotPointer] = await Promise.all([
          writeCanonicalSuiteArtifact(suiteRoot, "artifact://suite/manifest.json", manifest),
          writeCanonicalSuiteArtifact(
            suiteRoot,
            "artifact://suite/binding.json",
            input.binding.harness,
          ),
          writeCanonicalSuiteArtifact(suiteRoot, "artifact://suite/registry.json", snapshot),
        ]);
        if (
          bindingPointer.sha256 !== manifest.harness_binding_digest ||
          snapshot.digests.registry !== manifest.registry_digest ||
          snapshot.digests.eval_pack !== manifest.eval_pack_digest
        ) {
          throw new Error("Suite manifest does not bind its frozen static evidence");
        }
        primaryPointers = {
          manifest: manifestPointer,
          binding: bindingPointer,
          registrySnapshot: snapshotPointer,
        };
      },
      runTask: async (plan, manifest) => {
        const result = await input.runCampaign(plan, manifest);
        if (result.report.campaign_id !== plan.campaignId) {
          throw new Error("Phase 2 Campaign result has the wrong id");
        }
        const campaignPointer = parseCampaignPointerArtifact({
          schema_version: 1,
          suite_id: manifest.suite_id,
          task_id: plan.task.task_id,
          bucket: plan.task.bucket,
          campaign_id: plan.campaignId,
          campaign_report: result.pointers.report,
          activation: result.phase2Pointers.activation,
          exposure: result.phase2Pointers.exposure,
        });
        const pointer = await writeCanonicalSuiteArtifact(
          suiteRoot,
          `artifact://suite/tasks/${plan.task.task_id}/campaign-pointer.json`,
          campaignPointer,
        );
        return { campaign: result, pointer };
      },
    });
    if (!primaryPointers) throw new Error("Suite primary evidence was not frozen");

    const campaignEvidence = await Promise.all(
      execution.results.map(async ({ plan, result }) => {
        const campaignRoot = resolve(input.instanceRoot, "campaigns", plan.campaignId);
        const [controlActivation, treatmentActivation] = await Promise.all([
          readJsonArtifact(
            campaignRoot,
            result.campaign.phase2Pointers.activation.control,
            parseActivationArtifact,
          ),
          readJsonArtifact(
            campaignRoot,
            result.campaign.phase2Pointers.activation.treatment,
            parseActivationArtifact,
          ),
        ]);
        return {
          task: plan.task,
          campaignId: plan.campaignId,
          campaignPointer: result.pointer,
          campaignReportPointer: result.campaign.pointers.report,
          report: result.campaign.report,
          activation: { control: controlActivation, treatment: treatmentActivation },
        };
      }),
    );
    const evaluation = buildSuiteEvaluation(input.suiteId, campaignEvidence);
    const evaluationPointer: SuiteArtifactPointer = {
      ref: parseSuiteArtifactRef("artifact://suite/evaluation.json"),
      sha256: canonicalJsonDigest(evaluation),
    };
    const report = buildSuiteReport(evaluation, {
      manifest: primaryPointers.manifest,
      binding: primaryPointers.binding,
      registry_snapshot: primaryPointers.registrySnapshot,
      evaluation: evaluationPointer,
    });
    const markdown = renderSuiteReportMarkdown(report);
    assertSecretFreeText(canonicalJson(evaluation));
    assertSecretFreeText(canonicalJson(report));
    assertSecretFreeText(markdown);
    const [persistedEvaluation, reportPointer, markdownPointer] = await Promise.all([
      writeCanonicalSuiteArtifact(suiteRoot, "artifact://suite/evaluation.json", evaluation),
      writeCanonicalSuiteArtifact(suiteRoot, "artifact://suite/report.json", report),
      writeSuiteArtifactBytes(suiteRoot, "artifact://suite/report.md", markdown),
    ]);
    if (persistedEvaluation.sha256 !== evaluationPointer.sha256) {
      throw new Error("Suite evaluation digest changed during persistence");
    }
    await replaySuiteReport(input.instanceRoot, suiteRoot, reportPointer, { markdownPointer });
    return {
      suiteRoot,
      report,
      pointers: {
        manifest: primaryPointers.manifest,
        binding: primaryPointers.binding,
        registrySnapshot: primaryPointers.registrySnapshot,
        evaluation: persistedEvaluation,
        report: reportPointer,
        markdown: markdownPointer,
      },
    };
  } catch (error) {
    await writeSuiteMeasurementInvalidEnvelope({ suiteRoot, suiteId: input.suiteId });
    throw error;
  }
}
