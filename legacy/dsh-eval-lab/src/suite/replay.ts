import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { readArtifactBytes, readJsonArtifact } from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import {
  type EvaluationResult,
  parseQualificationEvidence,
  type QualificationEvidence,
} from "../contracts/parsers.js";
import {
  type ActivationArtifact,
  assertActivationArtifactSemantics,
  assertSuiteManifestSemantics,
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
import { ExposureLedger } from "../exposure/ledger.js";
import { LEDGER_BEHAVIORS } from "../oracle/ledger.js";
import { decodeOfficialSessionJsonl } from "../projector/jsonl.js";
import { projectGoalActivation } from "../projector/projector.js";
import type { TaskPackIdentity } from "../task-pack/loader.js";
import { buildSuiteEvaluation, buildSuiteReport, renderSuiteReportMarkdown } from "./reporter.js";

export interface ReconstructedSuiteReport {
  readonly report: SuiteReport;
  readonly evaluation: SuiteEvaluationArtifact;
  readonly markdown: string;
  readonly manifest: SuiteManifest;
  readonly registry_snapshot: RegistrySnapshot;
  readonly qualification: QualificationEvidence;
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

export function assertTaskPackMatchesRegistry(
  task: RegistrySnapshot["tasks"][number],
  taskPack: TaskPackIdentity,
): void {
  if (
    taskPack.public_task_sha256 !== task.public_task_sha256 ||
    taskPack.pack.base_tree_sha256 !== task.effective_base_sha256 ||
    taskPack.oracle_runner_sha256 !== task.oracle.runner_sha256 ||
    taskPack.pack.oracle_version !== task.oracle.version ||
    !same([...task.oracle.behavior_keys].sort(), [...LEDGER_BEHAVIORS].sort())
  ) {
    crossReferenceFailure("Campaign Task Pack does not match the frozen Registry Task");
  }
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
  projected: ActivationArtifact,
  result: EvaluationResult,
): void {
  if (
    !same(activation, projected) ||
    activation.summary.activated !== result.mechanism.goal_created ||
    activation.summary.continuation_rounds !== result.mechanism.goal_rounds_started ||
    activation.summary.terminal_phase !== result.mechanism.goal_terminal_phase
  ) {
    crossReferenceFailure(`${arm} activation does not match reconstructed Session evidence`);
  }
}

async function reconstructActivation(
  campaignRoot: string,
  episode: Awaited<ReturnType<typeof replayPairedImpactReport>>["control_episode"],
): Promise<ActivationArtifact> {
  const bytes = await readArtifactBytes(campaignRoot, {
    ref: episode.evidence.session_log_ref,
    sha256: episode.evidence.session_log_sha256,
  });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    crossReferenceFailure("Session JSONL is not valid UTF-8");
  }
  try {
    return projectGoalActivation(decodeOfficialSessionJsonl(text));
  } catch {
    crossReferenceFailure("Session JSONL cannot reconstruct Goal activation");
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
  const [manifestArtifact, bindingArtifact, registryArtifact, qualificationArtifact] =
    await Promise.all([
      readCanonicalByRef(suiteRoot, "artifact://suite/manifest.json", parseSuiteManifest),
      readCanonicalByRef(suiteRoot, "artifact://suite/binding.json", parseHarnessManifest),
      readCanonicalByRef(suiteRoot, "artifact://suite/registry.json", parseRegistrySnapshot),
      readCanonicalByRef(
        suiteRoot,
        "artifact://suite/qualification.json",
        parseQualificationEvidence,
      ),
    ]);
  const manifest = manifestArtifact.value;
  const binding = bindingArtifact.value;
  const registrySnapshot = registryArtifact.value;
  const qualification = qualificationArtifact.value;
  try {
    assertSuiteManifestSemantics(manifest);
  } catch {
    crossReferenceFailure("Suite manifest semantic bindings disagree");
  }
  if (
    bindingArtifact.pointer.sha256 !== manifest.harness_binding_digest ||
    binding.eval_binding.registry_sha256 !== manifest.registry_digest ||
    registrySnapshot.digests.registry !== manifest.registry_digest ||
    registrySnapshot.digests.eval_pack !== manifest.eval_pack_digest ||
    qualification.deployment_digest !== manifest.deployment_digest
  ) {
    crossReferenceFailure("Suite top-level evidence bindings disagree");
  }
  await verifyTaskArtifactSet(suiteRoot, manifest);
  const campaignEvidence = [];
  const exposureLedger = new ExposureLedger(physicalInstance);
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
    assertTaskPackMatchesRegistry(task, replay.task_pack);
    const projection = replay.experiment.deployment.qualification_projection;
    if (
      !same(replay.experiment.deployment.qualification, qualification) ||
      projection?.source_deployment_digest !== manifest.deployment_digest ||
      projection.source_qualification_sha256 !== qualificationArtifact.pointer.sha256 ||
      projection.projected_deployment_digest !== replay.experiment.deployment.digest
    ) {
      crossReferenceFailure(
        `Campaign ${planned.campaign_id} does not project the frozen Suite qualification`,
      );
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
    try {
      assertActivationArtifactSemantics(controlActivation);
      assertActivationArtifactSemantics(treatmentActivation);
    } catch {
      crossReferenceFailure("Stored activation artifact has invalid ordered-event semantics");
    }
    for (const [arm, exposure, episode, pointer] of [
      ["control", controlExposure, replay.control_episode, campaignPointer.exposure.control],
      [
        "treatment",
        treatmentExposure,
        replay.treatment_episode,
        campaignPointer.exposure.treatment,
      ],
    ] as const) {
      let ledgerExposure: Awaited<ReturnType<ExposureLedger["read"]>>;
      try {
        ledgerExposure = await exposureLedger.read(exposure.exposure_id);
      } catch {
        crossReferenceFailure(`${arm} immutable exposure ledger entry is missing or invalid`);
      }
      if (
        ledgerExposure.sha256 !== pointer.sha256 ||
        !same(ledgerExposure.record, exposure) ||
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
    const [projectedControlActivation, projectedTreatmentActivation] = await Promise.all([
      reconstructActivation(campaignRoot, replay.control_episode),
      reconstructActivation(campaignRoot, replay.treatment_episode),
    ]);
    verifyActivation(
      "control",
      controlActivation,
      projectedControlActivation,
      replay.report.arms.control,
    );
    verifyActivation(
      "treatment",
      treatmentActivation,
      projectedTreatmentActivation,
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
    qualification: qualificationArtifact.pointer,
    evaluation: evaluationPointer,
  });
  return {
    report,
    evaluation,
    markdown: renderSuiteReportMarkdown(report),
    manifest,
    registry_snapshot: registrySnapshot,
    qualification,
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
