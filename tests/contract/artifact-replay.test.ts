import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  ArtifactIntegrityError,
  parseArtifactRef,
  readJsonArtifact,
  resolveArtifactRef,
  writeCanonicalJsonArtifact,
} from "../../src/contracts/artifacts.js";
import { canonicalJsonDigest, sha256Hex } from "../../src/contracts/canonical-json.js";
import { replayPairedImpactReport } from "../../src/contracts/replay.js";
import { DEFAULT_RUNTIME_ROOT } from "../../src/runtime-root.js";
import {
  validEpisode,
  validExperiment,
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
  const scratchParent = `${DEFAULT_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const campaignRoot = await mkdtemp(`${scratchParent}/campaign-m0-`);

  try {
    const experimentPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/manifest.json",
      validExperiment,
    );
    const episodePointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/arms/control/episode.json",
      validEpisode,
    );
    const treatmentEpisodePointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/arms/treatment/episode.json",
      validTreatmentEpisode,
    );
    const report = {
      ...validReport,
      experiment_digest: experimentPointer.sha256,
      evidence: {
        ...validReport.evidence,
        experiment: experimentPointer,
        control_episode: episodePointer,
        treatment_episode: treatmentEpisodePointer,
      },
    };
    const reportPointer = await writeCanonicalJsonArtifact(
      campaignRoot,
      "artifact://campaign/report.json",
      report,
    );

    const replay = await replayPairedImpactReport(campaignRoot, reportPointer);
    assert.deepEqual(replay.experiment, validExperiment);
    assert.deepEqual(replay.control_episode, validEpisode);
    assert.deepEqual(replay.treatment_episode, validTreatmentEpisode);
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

test("artifact writes reject symlink parents and reads reject non-canonical JSON", async () => {
  const scratchParent = `${DEFAULT_RUNTIME_ROOT}/test-tmp`;
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
