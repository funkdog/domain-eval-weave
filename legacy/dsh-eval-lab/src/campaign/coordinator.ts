import { TextDecoder } from "node:util";
import type { ArtifactPointer } from "../contracts/artifacts.js";
import {
  parseArtifactRef,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../contracts/artifacts.js";
import { canonicalJson, canonicalJsonDigest } from "../contracts/canonical-json.js";
import type {
  EpisodeRecord,
  EvaluationResult,
  ExperimentSpec,
  PairedEvaluationArtifact,
  PairedImpactReport,
  VariantSpec,
} from "../contracts/parsers.js";
import { replayPairedImpactReport } from "../contracts/replay.js";
import { type BehaviorVector, LEDGER_BEHAVIORS } from "../oracle/ledger.js";
import {
  buildPairedImpactReport,
  combinePairedValidity,
  renderPairedReportMarkdown,
} from "../report/reporter.js";
import { assertSecretFreeText, SecretScanError } from "../report/secret-scan.js";
import type { TaskPackIdentity } from "../task-pack/loader.js";
import { evaluationFromFrozenEvidence } from "../validity/reconstruction.js";
import { CampaignStateStore } from "./state.js";

export interface ArmExecutionOutput {
  readonly sessionId: string;
  readonly sessionLog: string | Uint8Array;
  readonly candidateTree: string;
  readonly candidatePatch: Uint8Array;
  readonly candidateArchive: Uint8Array;
  readonly candidateChangedPaths: readonly string[];
  readonly candidateUnauthorizedPaths: readonly string[];
  readonly candidateForbiddenEntries: readonly string[];
  readonly workspaceBaseDigest: string;
  readonly process: EpisodeRecord["process"];
  readonly elapsedMs: number;
  readonly oracleInput?: unknown;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CampaignPointers {
  readonly experiment: ArtifactPointer;
  readonly controlEpisode: ArtifactPointer;
  readonly treatmentEpisode: ArtifactPointer;
  readonly evaluation: ArtifactPointer;
  readonly report: ArtifactPointer;
  readonly markdown: ArtifactPointer;
}

export interface ArmEvaluationOutput {
  readonly behavior: BehaviorVector;
  readonly candidateTreeAfterOracle: string;
  readonly oracleSeed: {
    readonly schema_version: 1;
    readonly seed: number;
    readonly oracle_version: string;
  };
}

function armRef(arm: "control" | "treatment", name: string): string {
  return `artifact://campaign/arms/${arm}/${name}`;
}

async function persistArm(
  campaignRoot: string,
  arm: "control" | "treatment",
  output: ArmExecutionOutput,
): Promise<{
  readonly evidence: EpisodeRecord["evidence"];
  readonly archivePointer: ArtifactPointer;
}> {
  const sessionText =
    typeof output.sessionLog === "string"
      ? output.sessionLog
      : new TextDecoder("utf-8", { fatal: true }).decode(output.sessionLog);
  assertSecretFreeText(sessionText);
  assertSecretFreeText(output.stdout ?? "");
  assertSecretFreeText(output.stderr ?? "");
  const [sessionPointer, archivePointer, stdoutPointer, stderrPointer, treePointer, patchPointer] =
    await Promise.all([
      writeArtifactBytes(campaignRoot, armRef(arm, "session.jsonl"), output.sessionLog),
      writeArtifactBytes(campaignRoot, armRef(arm, "candidate.tar"), output.candidateArchive),
      writeArtifactBytes(campaignRoot, armRef(arm, "stdout.txt"), output.stdout ?? ""),
      writeArtifactBytes(campaignRoot, armRef(arm, "stderr.txt"), output.stderr ?? ""),
      writeArtifactBytes(campaignRoot, armRef(arm, "candidate.tree"), `${output.candidateTree}\n`),
      writeArtifactBytes(campaignRoot, armRef(arm, "candidate.patch"), output.candidatePatch),
    ]);
  return {
    evidence: {
      session_log_ref: sessionPointer.ref,
      session_log_sha256: sessionPointer.sha256,
      candidate_tree: output.candidateTree,
      candidate_tree_ref: treePointer.ref,
      candidate_tree_sha256: treePointer.sha256,
      candidate_patch_ref: patchPointer.ref,
      candidate_patch_sha256: patchPointer.sha256,
      candidate_archive_ref: archivePointer.ref,
      candidate_archive_sha256: archivePointer.sha256,
      stdout_ref: stdoutPointer.ref,
      stdout_sha256: stdoutPointer.sha256,
      stderr_ref: stderrPointer.ref,
      stderr_sha256: stderrPointer.sha256,
    },
    archivePointer,
  };
}

export async function runPairedCampaign(input: {
  readonly campaignRoot: string;
  readonly experiment: ExperimentSpec;
  readonly variants: {
    readonly control: VariantSpec;
    readonly treatment: VariantSpec;
  };
  readonly taskPackIdentity: TaskPackIdentity;
  readonly publicTask: string;
  readonly executeArm: (arm: "control" | "treatment") => Promise<ArmExecutionOutput>;
  readonly evaluateArm: (
    arm: "control" | "treatment",
    output: ArmExecutionOutput,
  ) => Promise<ArmEvaluationOutput>;
}): Promise<{
  readonly report: PairedImpactReport;
  readonly pairedEvaluation: PairedEvaluationArtifact;
  readonly pointers: CampaignPointers;
}> {
  for (const value of [
    input.experiment,
    input.variants.control,
    input.variants.treatment,
    input.taskPackIdentity,
  ]) {
    assertSecretFreeText(canonicalJson(value));
  }
  assertSecretFreeText(input.publicTask);
  const state = new CampaignStateStore(`${input.campaignRoot}/campaign-state.json`);
  await state.initialize(input.experiment.campaign_id);
  const [controlVariantPointer, treatmentVariantPointer] = await Promise.all([
    writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/variants/control.json",
      input.variants.control,
    ),
    writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/variants/treatment.json",
      input.variants.treatment,
    ),
  ]);
  const [taskPackPointer, publicTaskPointer] = await Promise.all([
    writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/task-pack/identity.json",
      input.taskPackIdentity,
    ),
    writeArtifactBytes(
      input.campaignRoot,
      "artifact://campaign/task-pack/public-task.md",
      input.publicTask,
    ),
  ]);
  if (
    controlVariantPointer.sha256 !== input.experiment.control_variant_digest ||
    treatmentVariantPointer.sha256 !== input.experiment.treatment_variant_digest ||
    taskPackPointer.sha256 !== input.experiment.task_pack_digest ||
    publicTaskPointer.sha256 !== input.taskPackIdentity.public_task_sha256
  ) {
    throw new Error("Experiment digests do not bind its frozen Task Pack and VariantSpecs");
  }
  const experimentPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    "artifact://campaign/manifest.json",
    input.experiment,
  );
  await state.transition("qualified");
  const persisted = new Map<"control" | "treatment", Awaited<ReturnType<typeof persistArm>>>();
  const outputs = new Map<"control" | "treatment", ArmExecutionOutput>();
  try {
    for (let index = 0; index < input.experiment.arm_order.length; index += 1) {
      const arm = input.experiment.arm_order[index];
      if (arm === undefined) throw new Error("arm order is incomplete");
      await state.transition(index === 0 ? "arm_1_running" : "arm_2_running");
      const output = await input.executeArm(arm);
      outputs.set(arm, output);
      persisted.set(arm, await persistArm(input.campaignRoot, arm, output));
      await state.transition(index === 0 ? "arm_1_frozen" : "arm_2_frozen");
    }
    await state.transition("oracle_running");
    const control = persisted.get("control");
    const treatment = persisted.get("treatment");
    const controlOutput = outputs.get("control");
    const treatmentOutput = outputs.get("treatment");
    if (!control || !treatment || !controlOutput || !treatmentOutput) {
      throw new Error("both arms must be persisted before evaluation");
    }
    const controlEvaluationOutput = await input.evaluateArm("control", controlOutput);
    const treatmentEvaluationOutput = await input.evaluateArm("treatment", treatmentOutput);
    if (
      canonicalJson(controlEvaluationOutput.oracleSeed) !==
      canonicalJson(treatmentEvaluationOutput.oracleSeed)
    ) {
      throw new Error("Oracle artifacts do not share one frozen seed");
    }
    const [oracleSeedPointer, controlBehaviorPointer, treatmentBehaviorPointer] = await Promise.all(
      [
        writeCanonicalJsonArtifact(
          input.campaignRoot,
          "artifact://campaign/oracle/seed.json",
          controlEvaluationOutput.oracleSeed,
        ),
        writeCanonicalJsonArtifact(
          input.campaignRoot,
          "artifact://campaign/oracle/control/behavior.json",
          { schema_version: 1, behavior: controlEvaluationOutput.behavior },
        ),
        writeCanonicalJsonArtifact(
          input.campaignRoot,
          "artifact://campaign/oracle/treatment/behavior.json",
          { schema_version: 1, behavior: treatmentEvaluationOutput.behavior },
        ),
      ],
    );
    const episodeFor = (
      arm: "control" | "treatment",
      persistedArm: Awaited<ReturnType<typeof persistArm>>,
      output: ArmExecutionOutput,
      evaluated: ArmEvaluationOutput,
    ): EpisodeRecord => ({
      schema_version: 1,
      episode_id: `${input.experiment.campaign_id}-${arm}`,
      campaign_id: input.experiment.campaign_id,
      arm,
      variant_digest:
        arm === "control"
          ? input.experiment.control_variant_digest
          : input.experiment.treatment_variant_digest,
      workspace_base_digest: output.workspaceBaseDigest,
      session_id: output.sessionId,
      process: output.process,
      evidence: persistedArm.evidence,
      measurement: {
        candidate_changed_paths: [...output.candidateChangedPaths].sort(),
        candidate_unauthorized_paths: [...output.candidateUnauthorizedPaths].sort(),
        candidate_forbidden_entries: [...output.candidateForbiddenEntries].sort(),
        candidate_frozen_before_oracle: true,
        candidate_tree_after_oracle: evaluated.candidateTreeAfterOracle,
        elapsed_ms: output.elapsedMs,
      },
      infrastructure_errors: [],
    });
    const controlEpisode = episodeFor("control", control, controlOutput, controlEvaluationOutput);
    const treatmentEpisode = episodeFor(
      "treatment",
      treatment,
      treatmentOutput,
      treatmentEvaluationOutput,
    );
    for (const episode of [controlEpisode, treatmentEpisode]) {
      assertSecretFreeText(canonicalJson(episode));
    }
    const [controlEpisodePointer, treatmentEpisodePointer] = await Promise.all([
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        armRef("control", "episode.json"),
        controlEpisode,
      ),
      writeCanonicalJsonArtifact(
        input.campaignRoot,
        armRef("treatment", "episode.json"),
        treatmentEpisode,
      ),
    ]);
    const controlEvaluation = evaluationFromFrozenEvidence({
      episode: controlEpisode,
      sessionText:
        typeof controlOutput.sessionLog === "string"
          ? controlOutput.sessionLog
          : new TextDecoder("utf-8", { fatal: true }).decode(controlOutput.sessionLog),
      publicTask: input.publicTask,
      variant: input.variants.control,
      behavior: controlEvaluationOutput.behavior,
    });
    const treatmentEvaluation = evaluationFromFrozenEvidence({
      episode: treatmentEpisode,
      sessionText:
        typeof treatmentOutput.sessionLog === "string"
          ? treatmentOutput.sessionLog
          : new TextDecoder("utf-8", { fatal: true }).decode(treatmentOutput.sessionLog),
      publicTask: input.publicTask,
      variant: input.variants.treatment,
      behavior: treatmentEvaluationOutput.behavior,
    });
    const pairedEvaluation: PairedEvaluationArtifact = {
      schema_version: 1,
      campaign_id: input.experiment.campaign_id,
      oracle_seed: oracleSeedPointer,
      measurement_validity: combinePairedValidity(
        controlEvaluation.measurement_validity,
        treatmentEvaluation.measurement_validity,
      ),
      arms: {
        control: {
          episode: controlEpisodePointer,
          oracle: controlBehaviorPointer,
          candidate: { tree: controlOutput.candidateTree, archive: control.archivePointer },
          result: controlEvaluation,
        },
        treatment: {
          episode: treatmentEpisodePointer,
          oracle: treatmentBehaviorPointer,
          candidate: { tree: treatmentOutput.candidateTree, archive: treatment.archivePointer },
          result: treatmentEvaluation,
        },
      },
    };
    const evaluationPointer: ArtifactPointer = {
      ref: parseArtifactRef("artifact://campaign/evaluation.json"),
      sha256: canonicalJsonDigest(pairedEvaluation),
    };
    const report = buildPairedImpactReport({
      experiment: input.experiment,
      experimentPointer,
      pairedEvaluation,
      evaluationPointer,
      controlEpisodePointer,
      treatmentEpisodePointer,
    });
    const markdown = renderPairedReportMarkdown(report);
    assertSecretFreeText(canonicalJson(pairedEvaluation));
    assertSecretFreeText(canonicalJson(report));
    assertSecretFreeText(markdown);
    await writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/evaluation.json",
      pairedEvaluation,
    );
    await state.transition("projected");
    const reportPointer = await writeCanonicalJsonArtifact(
      input.campaignRoot,
      "artifact://campaign/report.json",
      report,
    );
    const markdownPointer = await writeArtifactBytes(
      input.campaignRoot,
      "artifact://campaign/report.md",
      markdown,
    );
    await replayPairedImpactReport(input.campaignRoot, reportPointer);
    await state.transition("reported");
    return {
      report,
      pairedEvaluation,
      pointers: {
        experiment: experimentPointer,
        controlEpisode: controlEpisodePointer,
        treatmentEpisode: treatmentEpisodePointer,
        evaluation: evaluationPointer,
        report: reportPointer,
        markdown: markdownPointer,
      },
    };
  } catch (error) {
    if (error instanceof SecretScanError) {
      await writeMeasurementInvalidReport({
        campaignRoot: input.campaignRoot,
        campaignId: input.experiment.campaign_id,
      });
    }
    const current = await state.read();
    if (current.phase !== "interrupted" && current.phase !== "reported") {
      await state.transition("interrupted");
    }
    throw error;
  }
}

export async function rebuildCampaignReport(input: {
  readonly campaignRoot: string;
  readonly pointers: CampaignPointers;
}): Promise<{
  readonly report: PairedImpactReport;
  readonly reportPointer: ArtifactPointer;
  readonly markdownPointer: ArtifactPointer;
}> {
  const replayed = await replayPairedImpactReport(input.campaignRoot, input.pointers.report, {
    requirePersistedEvaluation: false,
  });
  const report = replayed.report;
  assertSecretFreeText(canonicalJson(replayed.reconstructed_evaluation));
  assertSecretFreeText(canonicalJson(report));
  await writeCanonicalJsonArtifact(
    input.campaignRoot,
    "artifact://campaign/evaluation.json",
    replayed.reconstructed_evaluation,
  );
  const reportPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    "artifact://campaign/report.json",
    report,
  );
  const markdown = renderPairedReportMarkdown(report);
  assertSecretFreeText(markdown);
  const markdownPointer = await writeArtifactBytes(
    input.campaignRoot,
    "artifact://campaign/report.md",
    markdown,
  );
  await replayPairedImpactReport(input.campaignRoot, reportPointer);
  return { report, reportPointer, markdownPointer };
}

export async function writeMeasurementInvalidReport(input: {
  readonly campaignRoot: string;
  readonly campaignId: string;
}): Promise<{
  readonly report: PairedImpactReport;
  readonly reportPointer: ArtifactPointer;
  readonly markdownPointer: ArtifactPointer;
}> {
  const diagnostic = {
    code: "ARTIFACT_INTEGRITY_FAILURE",
    severity: "error" as const,
    message: "Frozen Campaign evidence failed digest or cross-reference validation.",
    evidence_refs: [],
  };
  const invalidValidity = {
    overall: "invalid" as const,
    dimensions: {
      outcome: "invalid" as const,
      mechanism: "invalid" as const,
      cost: "invalid" as const,
    },
    reasons: [diagnostic],
  };
  const invalidArm = (): EvaluationResult => ({
    schema_version: 1,
    measurement_validity: invalidValidity,
    outcome: {
      externally_verified_completion: null,
      behavior_vector: Object.fromEntries(LEDGER_BEHAVIORS.map((behavior) => [behavior, "error"])),
      completion_claim: "absent",
      false_completion_claim: null,
    },
    mechanism: {
      goal_created: null,
      goal_rounds_started: null,
      goal_terminal_phase: null,
      tool_calls: {},
      turns: null,
      steps: null,
    },
    cost: {
      elapsed_ms: null,
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      failed_tool_calls: null,
    },
    hard_gates: { artifact_integrity: "fail" },
    claim_strength: "diagnostic",
    effect_claim_eligible: false,
  });
  const missingPointer = (ref: string): ArtifactPointer => ({
    ref: parseArtifactRef(ref),
    sha256: "0".repeat(64),
  });
  const report: PairedImpactReport = {
    schema_version: 1,
    campaign_id: input.campaignId,
    experiment_digest: "0".repeat(64),
    measurement_validity: invalidValidity,
    arms: {
      control: invalidArm(),
      treatment: invalidArm(),
    },
    cost_delta: {
      elapsed_ms: null,
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      failed_tool_calls: null,
    },
    evidence: {
      experiment: missingPointer("artifact://campaign/manifest.json"),
      control_episode: missingPointer("artifact://campaign/arms/control/episode.json"),
      treatment_episode: missingPointer("artifact://campaign/arms/treatment/episode.json"),
      evaluation: missingPointer("artifact://campaign/evaluation.json"),
    },
    known_blind_spots: [diagnostic],
    recommendation: {
      action: "run_more",
      rationale_codes: [diagnostic.code],
    },
    claim_strength: "diagnostic",
    effect_claim_eligible: false,
  };
  const markdown = renderPairedReportMarkdown(report);
  assertSecretFreeText(canonicalJson(report));
  assertSecretFreeText(markdown);
  const reportPointer = await writeCanonicalJsonArtifact(
    input.campaignRoot,
    "artifact://campaign/measurement-invalid.json",
    report,
  );
  const markdownPointer = await writeArtifactBytes(
    input.campaignRoot,
    "artifact://campaign/measurement-invalid.md",
    markdown,
  );
  return { report, reportPointer, markdownPointer };
}
