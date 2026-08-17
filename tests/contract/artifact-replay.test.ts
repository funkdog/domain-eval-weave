import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  ArtifactIntegrityError,
  parseArtifactRef,
  readArtifactBytes,
  readJsonArtifact,
  resolveArtifactRef,
  writeArtifactBytes,
  writeCanonicalJsonArtifact,
} from "../../src/contracts/artifacts.js";
import { canonicalJsonDigest, sha256Hex } from "../../src/contracts/canonical-json.js";
import { parseExperimentSpec } from "../../src/contracts/parsers.js";
import { replayPairedImpactReport } from "../../src/contracts/replay.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import {
  validControlVariant,
  validEpisode,
  validEvaluation,
  validExperiment,
  validPairedEvaluation,
  validReport,
  validTaskPackIdentity,
  validTreatmentEpisode,
  validTreatmentEvaluation,
  validTreatmentVariant,
} from "../helpers/fixtures.js";
import { SYNTHETIC_PUBLIC_TASK, syntheticSessionLog } from "../helpers/session.js";

test("artifact refs are portable campaign refs, not cwd-relative or host-absolute paths", () => {
  const ref = parseArtifactRef("artifact://campaign/arms/control/episode.json");
  assert.equal(ref, "artifact://campaign/arms/control/episode.json");
  assert.throws(() => parseArtifactRef("arms/control/episode.json"));
  assert.throws(() => parseArtifactRef("artifact://campaign/../outside.json"));
  assert.throws(() => parseArtifactRef("file:///tmp/campaign/episode.json"));
});

test("fake Campaign artifacts can be canonically written, verified, and replayed", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/campaign-m0-`);

  try {
    await Promise.all([
      writeCanonicalJsonArtifact(
        campaignRoot,
        "artifact://campaign/variants/control.json",
        validControlVariant,
      ),
      writeCanonicalJsonArtifact(
        campaignRoot,
        "artifact://campaign/variants/treatment.json",
        validTreatmentVariant,
      ),
      writeCanonicalJsonArtifact(
        campaignRoot,
        "artifact://campaign/task-pack/identity.json",
        validTaskPackIdentity,
      ),
      writeArtifactBytes(
        campaignRoot,
        "artifact://campaign/task-pack/public-task.md",
        SYNTHETIC_PUBLIC_TASK,
      ),
    ]);
    const controlSession = await writeArtifactBytes(
      campaignRoot,
      "artifact://campaign/arms/control/session.jsonl",
      Buffer.from(syntheticSessionLog({ arm: "control" }), "utf8"),
    );
    const controlArchive = await writeArtifactBytes(
      campaignRoot,
      "artifact://campaign/arms/control/candidate.tar",
      Buffer.from("control-candidate", "utf8"),
    );
    const treatmentSession = await writeArtifactBytes(
      campaignRoot,
      "artifact://campaign/arms/treatment/session.jsonl",
      Buffer.from(syntheticSessionLog({ arm: "treatment" }), "utf8"),
    );
    const treatmentArchive = await writeArtifactBytes(
      campaignRoot,
      "artifact://campaign/arms/treatment/candidate.tar",
      Buffer.from("treatment-candidate", "utf8"),
    );
    const [
      controlTree,
      controlPatch,
      controlStdout,
      controlStderr,
      treatmentTree,
      treatmentPatch,
      treatmentStdout,
      treatmentStderr,
    ] = await Promise.all([
      writeArtifactBytes(
        campaignRoot,
        "artifact://campaign/arms/control/candidate.tree",
        `${validEpisode.evidence.candidate_tree}\n`,
      ),
      writeArtifactBytes(
        campaignRoot,
        "artifact://campaign/arms/control/candidate.patch",
        "control-patch",
      ),
      writeArtifactBytes(campaignRoot, "artifact://campaign/arms/control/stdout.txt", "control"),
      writeArtifactBytes(campaignRoot, "artifact://campaign/arms/control/stderr.txt", ""),
      writeArtifactBytes(
        campaignRoot,
        "artifact://campaign/arms/treatment/candidate.tree",
        `${validTreatmentEpisode.evidence.candidate_tree}\n`,
      ),
      writeArtifactBytes(
        campaignRoot,
        "artifact://campaign/arms/treatment/candidate.patch",
        "treatment-patch",
      ),
      writeArtifactBytes(
        campaignRoot,
        "artifact://campaign/arms/treatment/stdout.txt",
        "treatment",
      ),
      writeArtifactBytes(campaignRoot, "artifact://campaign/arms/treatment/stderr.txt", ""),
    ]);
    const experimentPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/manifest.json",
      validExperiment,
    );
    const controlEpisode = {
      ...validEpisode,
      evidence: {
        ...validEpisode.evidence,
        session_log_ref: controlSession.ref,
        session_log_sha256: controlSession.sha256,
        candidate_tree_ref: controlTree.ref,
        candidate_tree_sha256: controlTree.sha256,
        candidate_patch_ref: controlPatch.ref,
        candidate_patch_sha256: controlPatch.sha256,
        candidate_archive_ref: controlArchive.ref,
        candidate_archive_sha256: controlArchive.sha256,
        stdout_ref: controlStdout.ref,
        stdout_sha256: controlStdout.sha256,
        stderr_ref: controlStderr.ref,
        stderr_sha256: controlStderr.sha256,
      },
    };
    const episodePointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/arms/control/episode.json",
      controlEpisode,
    );
    const treatmentEpisode = {
      ...validTreatmentEpisode,
      evidence: {
        ...validTreatmentEpisode.evidence,
        session_log_ref: treatmentSession.ref,
        session_log_sha256: treatmentSession.sha256,
        candidate_tree_ref: treatmentTree.ref,
        candidate_tree_sha256: treatmentTree.sha256,
        candidate_patch_ref: treatmentPatch.ref,
        candidate_patch_sha256: treatmentPatch.sha256,
        candidate_archive_ref: treatmentArchive.ref,
        candidate_archive_sha256: treatmentArchive.sha256,
        stdout_ref: treatmentStdout.ref,
        stdout_sha256: treatmentStdout.sha256,
        stderr_ref: treatmentStderr.ref,
        stderr_sha256: treatmentStderr.sha256,
      },
    };
    const treatmentEpisodePointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/arms/treatment/episode.json",
      treatmentEpisode,
    );
    const [oracleSeedPointer, controlBehaviorPointer, treatmentBehaviorPointer] = await Promise.all(
      [
        writeCanonicalJsonArtifact(campaignRoot, "artifact://campaign/oracle/seed.json", {
          schema_version: 1,
          seed: 1729,
          oracle_version: "ledger-oracle-v2",
        }),
        writeCanonicalJsonArtifact(
          campaignRoot,
          "artifact://campaign/oracle/control/behavior.json",
          { schema_version: 1, behavior: validEvaluation.outcome.behavior_vector },
        ),
        writeCanonicalJsonArtifact(
          campaignRoot,
          "artifact://campaign/oracle/treatment/behavior.json",
          { schema_version: 1, behavior: validTreatmentEvaluation.outcome.behavior_vector },
        ),
      ],
    );
    const pairedEvaluation = {
      ...validPairedEvaluation,
      oracle_seed: oracleSeedPointer,
      arms: {
        control: {
          ...validPairedEvaluation.arms.control,
          episode: episodePointer,
          oracle: controlBehaviorPointer,
          candidate: {
            tree: controlEpisode.evidence.candidate_tree,
            archive: controlArchive,
          },
        },
        treatment: {
          ...validPairedEvaluation.arms.treatment,
          episode: treatmentEpisodePointer,
          oracle: treatmentBehaviorPointer,
          candidate: {
            tree: treatmentEpisode.evidence.candidate_tree,
            archive: treatmentArchive,
          },
        },
      },
    };
    const evaluationPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/evaluation.json",
      pairedEvaluation,
    );
    const report = {
      ...validReport,
      experiment_digest: experimentPointer.sha256,
      evidence: {
        ...validReport.evidence,
        experiment: experimentPointer,
        control_episode: episodePointer,
        treatment_episode: treatmentEpisodePointer,
        evaluation: evaluationPointer,
      },
    };
    const reportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report.json",
      report,
    );

    const replay = await replayPairedImpactReport(campaignRoot, reportPointer);
    assert.deepEqual(replay.experiment, validExperiment);
    assert.deepEqual(replay.control_episode, controlEpisode);
    assert.deepEqual(replay.treatment_episode, treatmentEpisode);
    assert.deepEqual(replay.evaluation, pairedEvaluation);
    assert.equal(
      (await readArtifactBytes(campaignRoot, controlArchive)).toString(),
      "control-candidate",
    );
    assert.equal(canonicalJsonDigest(replay.report), reportPointer.sha256);

    const sourceQualification = {
      ...validExperiment.deployment.qualification,
      deployment_digest: "e".repeat(64),
    };
    const projectedExperiment = parseExperimentSpec({
      ...structuredClone(validExperiment),
      deployment: {
        ...structuredClone(validExperiment.deployment),
        qualification: sourceQualification,
        qualification_projection: {
          source_deployment_digest: sourceQualification.deployment_digest,
          projected_deployment_digest: validExperiment.deployment.digest,
          source_qualification_sha256: canonicalJsonDigest(sourceQualification),
        },
      },
    });
    const projectedExperimentPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/manifest-projected.json",
      projectedExperiment,
    );
    const projectedReportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report-projected.json",
      {
        ...report,
        experiment_digest: projectedExperimentPointer.sha256,
        evidence: { ...report.evidence, experiment: projectedExperimentPointer },
        known_blind_spots: report.known_blind_spots.map((blindSpot) => ({
          ...blindSpot,
          evidence_refs: [projectedExperimentPointer.ref],
        })),
      },
    );
    assert.deepEqual(
      (await replayPairedImpactReport(campaignRoot, projectedReportPointer)).experiment,
      projectedExperiment,
    );

    const invalidProjectionPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/manifest-invalid-projection.json",
      {
        ...projectedExperiment,
        deployment: {
          ...projectedExperiment.deployment,
          qualification_projection: {
            ...projectedExperiment.deployment.qualification_projection,
            source_qualification_sha256: "f".repeat(64),
          },
        },
      },
    );
    const invalidProjectionReportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report-invalid-projection.json",
      {
        ...report,
        experiment_digest: invalidProjectionPointer.sha256,
        evidence: { ...report.evidence, experiment: invalidProjectionPointer },
        known_blind_spots: report.known_blind_spots.map((blindSpot) => ({
          ...blindSpot,
          evidence_refs: [invalidProjectionPointer.ref],
        })),
      },
    );
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, invalidProjectionReportPointer),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError &&
        error.code === "ARTIFACT_CROSS_REFERENCE_INVALID",
    );

    const wrongCostReportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report-wrong-cost.json",
      {
        ...report,
        cost_delta: { ...report.cost_delta, elapsed_ms: 999 },
      },
    );
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, wrongCostReportPointer),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError &&
        error.code === "ARTIFACT_CROSS_REFERENCE_INVALID",
    );

    const wrongValidityReportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report-wrong-validity.json",
      {
        ...report,
        measurement_validity: {
          ...report.measurement_validity,
          overall: "insufficient",
        },
      },
    );
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, wrongValidityReportPointer),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError &&
        error.code === "ARTIFACT_CROSS_REFERENCE_INVALID",
    );

    const wrongDeploymentExperimentPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/manifest-wrong-deployment.json",
      {
        ...validExperiment,
        deployment: {
          ...validExperiment.deployment,
          digest: "f".repeat(64),
          qualification: {
            ...validExperiment.deployment.qualification,
            deployment_digest: "f".repeat(64),
          },
        },
      },
    );
    const wrongDeploymentReportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report-wrong-deployment.json",
      {
        ...report,
        experiment_digest: wrongDeploymentExperimentPointer.sha256,
        evidence: {
          ...report.evidence,
          experiment: wrongDeploymentExperimentPointer,
        },
      },
    );
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, wrongDeploymentReportPointer),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError &&
        error.code === "ARTIFACT_CROSS_REFERENCE_INVALID",
    );

    const wrongBehaviorPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/oracle/control/behavior-wrong.json",
      {
        schema_version: 1,
        behavior: {
          ...validEvaluation.outcome.behavior_vector,
          basic_reservation: "fail",
        },
      },
    );
    const wrongBehaviorEvaluationPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/evaluation-wrong-behavior.json",
      {
        ...pairedEvaluation,
        arms: {
          ...pairedEvaluation.arms,
          control: { ...pairedEvaluation.arms.control, oracle: wrongBehaviorPointer },
        },
      },
    );
    const wrongBehaviorReportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report-wrong-behavior.json",
      {
        ...report,
        evidence: { ...report.evidence, evaluation: wrongBehaviorEvaluationPointer },
      },
    );
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, wrongBehaviorReportPointer),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError &&
        error.code === "ARTIFACT_CROSS_REFERENCE_INVALID",
    );

    const wrongCandidateEvaluationPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/evaluation-wrong-candidate.json",
      {
        ...pairedEvaluation,
        arms: {
          ...pairedEvaluation.arms,
          control: {
            ...pairedEvaluation.arms.control,
            candidate: {
              ...pairedEvaluation.arms.control.candidate,
              archive: treatmentArchive,
            },
          },
        },
      },
    );
    const wrongCandidateReportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report-wrong-candidate.json",
      {
        ...report,
        evidence: {
          ...report.evidence,
          evaluation: wrongCandidateEvaluationPointer,
        },
      },
    );
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, wrongCandidateReportPointer),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError &&
        error.code === "ARTIFACT_CROSS_REFERENCE_INVALID",
    );

    const wrongEpisodeEvaluationPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/evaluation-wrong-episode.json",
      {
        ...pairedEvaluation,
        arms: {
          ...pairedEvaluation.arms,
          control: {
            ...pairedEvaluation.arms.control,
            episode: treatmentEpisodePointer,
          },
        },
      },
    );
    const wrongEpisodeReportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report-wrong-episode.json",
      {
        ...report,
        evidence: {
          ...report.evidence,
          evaluation: wrongEpisodeEvaluationPointer,
        },
      },
    );
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, wrongEpisodeReportPointer),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError &&
        error.code === "ARTIFACT_CROSS_REFERENCE_INVALID",
    );

    const controlPatchPath = resolveArtifactRef(campaignRoot, controlPatch.ref);
    await writeFile(controlPatchPath, "tampered-patch", "utf8");
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, reportPointer),
      ArtifactIntegrityError,
    );
    await writeFile(controlPatchPath, "control-patch", "utf8");

    const treatmentEpisodePath = resolveArtifactRef(campaignRoot, treatmentEpisodePointer.ref);
    await writeFile(treatmentEpisodePath, "{}", "utf8");
    await assert.rejects(
      replayPairedImpactReport(campaignRoot, reportPointer),
      ArtifactIntegrityError,
    );
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("concurrent writes can create distinct artifacts under one missing parent", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/artifact-parent-race-`);

  try {
    const pointers = await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        writeArtifactBytes(
          campaignRoot,
          `artifact://campaign/shared/new/artifact-${index}.txt`,
          `bytes-${index}`,
        ),
      ),
    );
    assert.equal(pointers.length, 64);
    assert.equal(new Set(pointers.map((pointer) => pointer.ref)).size, 64);
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("artifact writes are idempotent but never replace different frozen bytes", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/artifact-no-overwrite-`);

  try {
    const ref = "artifact://campaign/manifest.json";
    const first = await writeCanonicalJsonArtifact(campaignRoot, ref, validExperiment);
    assert.deepEqual(await writeCanonicalJsonArtifact(campaignRoot, ref, validExperiment), first);
    await assert.rejects(
      writeCanonicalJsonArtifact(campaignRoot, ref, {
        ...validExperiment,
        campaign_id: "different-campaign",
      }),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError && error.code === "ARTIFACT_ALREADY_EXISTS",
    );
    assert.deepEqual(
      await readJsonArtifact(campaignRoot, first, parseExperimentSpec),
      validExperiment,
    );
  } finally {
    await rm(campaignRoot, { recursive: true, force: true });
  }
});

test("artifact writes reject symlink parents and reads reject non-canonical JSON", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const testRoot = await mkdtemp(`${scratchParent}/artifact-safety-`);
  const campaignRoot = `${testRoot}/campaign`;
  const outsideRoot = `${testRoot}/outside`;
  await mkdir(campaignRoot, { mode: 0o700 });
  await mkdir(outsideRoot, { mode: 0o700 });

  try {
    await symlink(outsideRoot, `${campaignRoot}/arms`);
    await assert.rejects(
      writeCanonicalJsonArtifact(
        campaignRoot,
        "artifact://campaign/arms/control/episode.json",
        validEpisode,
      ),
      ArtifactIntegrityError,
    );

    const nonCanonicalRef = parseArtifactRef("artifact://campaign/non-canonical.json");
    const nonCanonicalBytes = '{"z":1,"a":2}';
    await writeFile(resolveArtifactRef(campaignRoot, nonCanonicalRef), nonCanonicalBytes, {
      mode: 0o600,
    });
    await assert.rejects(
      readJsonArtifact(
        campaignRoot,
        { ref: nonCanonicalRef, sha256: sha256Hex(nonCanonicalBytes) },
        (value) => value,
      ),
      (error: unknown) =>
        error instanceof ArtifactIntegrityError && error.code === "ARTIFACT_JSON_NON_CANONICAL",
    );
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
