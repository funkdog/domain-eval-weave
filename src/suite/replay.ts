import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { readJsonArtifact } from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import type { EvaluationResult } from "../contracts/parsers.js";
import {
  type ActivationArtifact,
  parseActivationArtifact,
  parseCampaignPointerArtifact,
  parseExposureRecord,
  parseHarnessManifest,
  parseRegistrySnapshot,
  parseSuiteEvaluationArtifact,
  parseSuiteManifest,
  parseSuiteReport,
  type RegistrySnapshot,
  type SuiteEvaluationArtifact,
  type SuiteManifest,
  type SuiteReport,
} from "../contracts/phase2.js";
import { replayPairedImpactReport } from "../contracts/replay.js";
import { parseSuiteArtifactRef } from "../contracts/suite-artifact-ref.js";
import {
  readCanonicalSuiteArtifact,
  readSuiteArtifactBytes,
  readSuiteArtifactBytesByRef,
  SuiteArtifactIntegrityError,
  type SuiteArtifactPointer,
} from "../contracts/suite-artifacts.js";
import { buildSuiteEvaluation, buildSuiteReport, renderSuiteReportMarkdown } from "./reporter.js";

export interface ReconstructedSuiteReport {
  readonly report: SuiteReport;
  readonly evaluation: SuiteEvaluationArtifact;
  readonly markdown: string;
  readonly manifest: SuiteManifest;
  readonly registry_snapshot: RegistrySnapshot;
}

export interface ReplayedSuiteReport extends ReconstructedSuiteReport {
  readonly reconstructed_evaluation: SuiteEvaluationArtifact;
  readonly reconstructed_report: SuiteReport;
}

function crossReferenceFailure(message: string): never {
  throw new SuiteArtifactIntegrityError("SUITE_ARTIFACT_CROSS_REFERENCE_INVALID", message);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function readCanonicalByRef<T>(
  suiteRoot: string,
  ref: string,
  parse: (value: unknown) => T,
): Promise<{ readonly pointer: SuiteArtifactPointer; readonly value: T }> {
  const artifact = await readSuiteArtifactBytesByRef(suiteRoot, ref);
  let text: string;
  let decoded: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes);
    decoded = JSON.parse(text);
  } catch {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_JSON_INVALID",
      "Suite artifact is not canonical JSON",
    );
  }
  let value: T;
  try {
    value = parse(decoded);
  } catch {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_SCHEMA_INVALID",
      "Suite artifact does not match its frozen schema",
    );
  }
  if (canonicalJson(value) !== text) {
    throw new SuiteArtifactIntegrityError(
      "SUITE_ARTIFACT_NOT_CANONICAL",
      "Suite artifact is not canonical JSON",
    );
  }
  return { pointer: artifact.pointer, value };
}

function verifyActivation(
  arm: "control" | "treatment",
  activation: ActivationArtifact,
  sessionId: string | undefined,
  result: EvaluationResult,
): void {
  if (
    activation.session_id !== sessionId ||
    activation.summary.activated !== result.mechanism.goal_created ||
    activation.summary.continuation_rounds !== result.mechanism.goal_rounds_started ||
    activation.summary.terminal_phase !== result.mechanism.goal_terminal_phase
  ) {
    crossReferenceFailure(`${arm} activation does not match reconstructed Session evidence`);
  }
}

async function verifyTaskArtifactSet(suiteRoot: string, manifest: SuiteManifest): Promise<void> {
  const taskRoot = resolve(suiteRoot, "tasks");
  const taskRootStat = await lstat(taskRoot);
  if (taskRootStat.isSymbolicLink() || !taskRootStat.isDirectory()) {
    crossReferenceFailure("Suite Task artifact root is not a physical directory");
  }
  const expected = manifest.tasks.map((task) => task.task_id).sort();
  const actual = (await readdir(taskRoot)).sort();
  if (!same(actual, expected)) {
    crossReferenceFailure("Suite contains a missing or unknown Task artifact directory");
  }
  for (const taskId of actual) {
    const directory = resolve(taskRoot, taskId);
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      crossReferenceFailure(`Suite Task artifact entry is invalid: ${taskId}`);
    }
    const entries = await readdir(directory);
    if (!same(entries.sort(), ["campaign-pointer.json"])) {
      crossReferenceFailure(`Suite Task artifact set is invalid: ${taskId}`);
    }
    const pointerStat = await lstat(resolve(directory, "campaign-pointer.json"));
    if (pointerStat.isSymbolicLink() || !pointerStat.isFile()) {
      crossReferenceFailure(`Suite Campaign pointer is not a physical file: ${taskId}`);
    }
  }
}

async function physicalInstanceRoot(instanceRoot: string): Promise<string> {
  if (!isAbsolute(instanceRoot)) {
    throw new SuiteArtifactIntegrityError(
      "SUITE_INSTANCE_ROOT_INVALID",
      "Suite instance root must be absolute",
    );
  }
  const rootStat = await lstat(instanceRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new SuiteArtifactIntegrityError(
      "SUITE_INSTANCE_ROOT_INVALID",
      "Suite instance root must be a physical directory",
    );
  }
  const root = await realpath(instanceRoot);
  const campaigns = resolve(root, "campaigns");
  const campaignStat = await lstat(campaigns);
  const campaignPhysical = await realpath(campaigns);
  const relation = relative(root, campaignPhysical);
  if (
    campaignStat.isSymbolicLink() ||
    !campaignStat.isDirectory() ||
    relation.startsWith("..") ||
    isAbsolute(relation)
  ) {
    throw new SuiteArtifactIntegrityError(
      "SUITE_CAMPAIGN_ROOT_INVALID",
      "Suite Campaign root must be a contained physical directory",
    );
  }
  return root;
}

export async function reconstructSuiteReport(
  instanceRoot: string,
  suiteRoot: string,
): Promise<ReconstructedSuiteReport> {
  const physicalInstance = await physicalInstanceRoot(instanceRoot);
  const [manifestArtifact, bindingArtifact, registryArtifact] = await Promise.all([
    readCanonicalByRef(suiteRoot, "artifact://suite/manifest.json", parseSuiteManifest),
    readCanonicalByRef(suiteRoot, "artifact://suite/binding.json", parseHarnessManifest),
    readCanonicalByRef(suiteRoot, "artifact://suite/registry.json", parseRegistrySnapshot),
  ]);
  const manifest = manifestArtifact.value;
  const binding = bindingArtifact.value;
  const registrySnapshot = registryArtifact.value;
  if (
    bindingArtifact.pointer.sha256 !== manifest.harness_binding_digest ||
    binding.eval_binding.registry_sha256 !== manifest.registry_digest ||
    registrySnapshot.digests.registry !== manifest.registry_digest ||
    registrySnapshot.digests.eval_pack !== manifest.eval_pack_digest
  ) {
    crossReferenceFailure("Suite top-level evidence bindings disagree");
  }
  await verifyTaskArtifactSet(suiteRoot, manifest);
  const campaignEvidence = [];
  for (const planned of manifest.tasks) {
    const task = registrySnapshot.tasks.find((candidate) => candidate.task_id === planned.task_id);
    if (!task || task.bucket !== planned.bucket) {
      crossReferenceFailure(
        `Suite Task ${planned.task_id} is not closed by frozen Registry evidence`,
      );
    }
    const campaignArtifact = await readCanonicalByRef(
      suiteRoot,
      `artifact://suite/tasks/${planned.task_id}/campaign-pointer.json`,
      parseCampaignPointerArtifact,
    );
    const campaignPointer = campaignArtifact.value;
    if (
      campaignPointer.suite_id !== manifest.suite_id ||
      campaignPointer.task_id !== planned.task_id ||
      campaignPointer.bucket !== planned.bucket ||
      campaignPointer.campaign_id !== planned.campaign_id
    ) {
      crossReferenceFailure(`Campaign pointer for ${planned.task_id} disagrees`);
    }
    const campaignRoot = resolve(physicalInstance, "campaigns", planned.campaign_id);
    const replay = await replayPairedImpactReport(campaignRoot, campaignPointer.campaign_report);
    if (replay.report.campaign_id !== planned.campaign_id) {
      crossReferenceFailure(`Campaign ${planned.campaign_id} has the wrong report identity`);
    }
    const [controlActivation, treatmentActivation, controlExposure, treatmentExposure] =
      await Promise.all([
        readJsonArtifact(campaignRoot, campaignPointer.activation.control, parseActivationArtifact),
        readJsonArtifact(
          campaignRoot,
          campaignPointer.activation.treatment,
          parseActivationArtifact,
        ),
        readJsonArtifact(campaignRoot, campaignPointer.exposure.control, parseExposureRecord),
        readJsonArtifact(campaignRoot, campaignPointer.exposure.treatment, parseExposureRecord),
      ]);
    for (const [arm, exposure, episode] of [
      ["control", controlExposure, replay.control_episode],
      ["treatment", treatmentExposure, replay.treatment_episode],
    ] as const) {
      if (
        exposure.suite_id !== manifest.suite_id ||
        exposure.campaign_id !== planned.campaign_id ||
        exposure.task_id !== task.task_id ||
        exposure.bucket !== task.bucket ||
        exposure.arm !== arm ||
        exposure.episode_id !== episode.episode_id ||
        exposure.session_id !== episode.session_id ||
        exposure.variant_digest !== episode.variant_digest ||
        exposure.public_task_sha256 !== task.public_task_sha256 ||
        exposure.effective_base_sha256 !== task.effective_base_sha256 ||
        exposure.registry_digest !== manifest.registry_digest ||
        exposure.binding_digest !== manifest.harness_binding_digest ||
        exposure.started_at !== episode.process.started_at ||
        exposure.ended_at !== episode.process.ended_at ||
        !same(exposure.candidate_archive, replay.evaluation.arms[arm].candidate.archive)
      ) {
        crossReferenceFailure(`${arm} exposure for ${planned.task_id} disagrees`);
      }
    }
    verifyActivation(
      "control",
      controlActivation,
      replay.control_episode.session_id,
      replay.report.arms.control,
    );
    verifyActivation(
      "treatment",
      treatmentActivation,
      replay.treatment_episode.session_id,
      replay.report.arms.treatment,
    );
    campaignEvidence.push({
      task,
      campaignId: planned.campaign_id,
      campaignPointer: campaignArtifact.pointer,
      campaignReportPointer: campaignPointer.campaign_report,
      report: replay.report,
      activation: { control: controlActivation, treatment: treatmentActivation },
    });
  }
  const evaluation = buildSuiteEvaluation(manifest.suite_id, campaignEvidence);
  const evaluationPointer: SuiteArtifactPointer = {
    ref: parseSuiteArtifactRef("artifact://suite/evaluation.json"),
    sha256: canonicalJsonDigest(evaluation),
  };
  const report = buildSuiteReport(evaluation, {
    manifest: manifestArtifact.pointer,
    binding: bindingArtifact.pointer,
    registry_snapshot: registryArtifact.pointer,
    evaluation: evaluationPointer,
  });
  return {
    report,
    evaluation,
    markdown: renderSuiteReportMarkdown(report),
    manifest,
    registry_snapshot: registrySnapshot,
  };
}

export async function replaySuiteReport(
  instanceRoot: string,
  suiteRoot: string,
  reportPointer: SuiteArtifactPointer,
  options: { readonly markdownPointer?: SuiteArtifactPointer } = {},
): Promise<ReplayedSuiteReport> {
  const report = await readCanonicalSuiteArtifact(suiteRoot, reportPointer, parseSuiteReport);
  const evaluation = await readCanonicalSuiteArtifact(
    suiteRoot,
    report.evidence.evaluation,
    parseSuiteEvaluationArtifact,
  );
  const reconstructed = await reconstructSuiteReport(instanceRoot, suiteRoot);
  if (!same(reconstructed.evaluation, evaluation) || !same(reconstructed.report, report)) {
    crossReferenceFailure("Suite derived evaluation/report does not match frozen primary evidence");
  }
  if (options.markdownPointer) {
    const markdown = await readSuiteArtifactBytes(suiteRoot, options.markdownPointer);
    if (markdown.toString("utf8") !== reconstructed.markdown) {
      crossReferenceFailure("Suite Markdown does not match the reconstructed report");
    }
  }
  return {
    ...reconstructed,
    evaluation,
    report,
    reconstructed_evaluation: reconstructed.evaluation,
    reconstructed_report: reconstructed.report,
  };
}
