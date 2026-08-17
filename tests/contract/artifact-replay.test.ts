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
  validEpisode,
  validExperiment,
  validPairedEvaluation,
  validReport,
  validTreatmentEpisode,
} from "../helpers/fixtures.js";

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
    const controlSession = await writeArtifactBytes(
      campaignRoot,
      "artifact://campaign/arms/control/session.jsonl",
      Buffer.from('{"type":"turn/end"}\n', "utf8"),
    );
    const controlArchive = await writeArtifactBytes(
      campaignRoot,
      "artifact://campaign/arms/control/candidate.tar",
      Buffer.from("control-candidate", "utf8"),
    );
    const treatmentSession = await writeArtifactBytes(
      campaignRoot,
      "artifact://campaign/arms/treatment/session.jsonl",
      Buffer.from('{"type":"goal/change"}\n', "utf8"),
    );
    const treatmentArchive = await writeArtifactBytes(
      campaignRoot,
      "artifact://campaign/arms/treatment/candidate.tar",
      Buffer.from("treatment-candidate", "utf8"),
    );
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
        candidate_archive_ref: controlArchive.ref,
        candidate_archive_sha256: controlArchive.sha256,
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
        candidate_archive_ref: treatmentArchive.ref,
        candidate_archive_sha256: treatmentArchive.sha256,
      },
    };
    const treatmentEpisodePointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/arms/treatment/episode.json",
      treatmentEpisode,
    );
    const evaluationPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/evaluation.json",
      validPairedEvaluation,
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
    assert.deepEqual(replay.evaluation, validPairedEvaluation);
    assert.equal(
      (await readArtifactBytes(campaignRoot, controlArchive)).toString(),
      "control-candidate",
    );
    assert.equal(canonicalJsonDigest(replay.report), reportPointer.sha256);

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
