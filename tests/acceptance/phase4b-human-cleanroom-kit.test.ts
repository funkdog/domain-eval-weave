import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildSyntheticCleanroomSubmission } from "./helpers/phase4b-cleanroom-fixture.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../..", import.meta.url).pathname;
const kitSource = join(repositoryRoot, "cleanroom/phase4b-contributor-v1");

test("human clean-room kit is label-free and materializes one immutable package closure", async () => {
  const topLevel = await readdir(kitSource);
  assert.equal(topLevel.includes("capsule.yaml"), false);
  assert.equal(topLevel.includes("domain.yaml"), false);
  assert.deepEqual((await readdir(join(kitSource, "candidate-pool"))).sort(), [
    "alpha",
    "beta",
    "delta",
    "epsilon",
    "gamma",
  ]);
  for (const name of await readdir(join(kitSource, "candidate-pool"))) {
    const source = await readFile(join(kitSource, "candidate-pool", name, "candidate.mjs"), "utf8");
    assert.doesNotMatch(source, /gold|equivalent|mutant|expected_claims|target_claim_ids/i);
  }

  const scratch = await mkdtemp(join(tmpdir(), "phase4b-human-kit-"));
  const materialized = join(scratch, "kit");
  try {
    const output = await execFileAsync(
      process.execPath,
      [join(repositoryRoot, "scripts/materialize-phase4b-cleanroom.mjs"), materialized],
      { cwd: repositoryRoot, maxBuffer: 32 * 1024 * 1024 },
    );
    const receipt = JSON.parse(output.stdout) as {
      readonly kit_id?: unknown;
      readonly lab_package_sha256?: unknown;
    };
    assert.equal(receipt.kit_id, "phase4b-contributor-v1");
    assert.match(String(receipt.lab_package_sha256), /^[0-9a-f]{64}$/);
    const manifest = JSON.parse(
      await readFile(join(materialized, "kit-manifest.json"), "utf8"),
    ) as {
      readonly entries: readonly unknown[];
      readonly verifier_runtime?: unknown;
    };
    assert.ok(manifest.entries.length >= 8);
    assert.equal(manifest.verifier_runtime, "package/verifier-runtime.cjs");
    assert.deepEqual((await readdir(join(materialized, "package"))).sort(), [
      "domaineval-weave-0.1.0-alpha.0.tgz",
      "verifier-runtime.cjs",
    ]);
    assert.doesNotMatch(
      await readFile(join(materialized, "package/verifier-runtime.cjs"), "utf8"),
      /dsh-eval-lab-phase4b|packages\/lab\/dist/,
    );
    assert.doesNotMatch(
      await readFile(join(repositoryRoot, "scripts/verify-phase4b-cleanroom.mjs"), "utf8"),
      /packages\/lab\/dist/,
      "verification must execute the kit-bound runtime rather than the current checkout",
    );

    const invalidReceipt = {
      schema_version: 1,
      kit_id: "phase4b-contributor-v1",
      participant_id: "same-person",
      observer_id: "same-person",
      participant_prior_experience: "none",
      oral_help_received: false,
      repository_source_read: false,
      compare_completed: true,
      started_at: "2026-08-27T00:00:00.000Z",
      completed_at: "2026-08-27T01:00:00.000Z",
      lab_package_sha256: receipt.lab_package_sha256,
      capsule_release_sha256: "a".repeat(64),
      calibration_ref: `.eval/calibrations/${"b".repeat(64)}.json`,
      run_ref: `.eval/runs/${"c".repeat(64)}.json`,
      observer_attestation: "observed_no_oral_help",
      notes: "Synthetic negative contract test only.",
    };
    const invalidPath = join(scratch, "invalid-receipt.json");
    await writeFile(invalidPath, `${JSON.stringify(invalidReceipt)}\n`, "utf8");
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          join(repositoryRoot, "scripts/verify-phase4b-cleanroom.mjs"),
          materialized,
          join(scratch, "missing-submission"),
          invalidPath,
        ],
        { cwd: repositoryRoot },
      ),
      /participant.*observer|independent/i,
    );

    const submission = join(scratch, "synthetic-submission");
    const positive = await buildSyntheticCleanroomSubmission({
      root: submission,
      materializedRoot: materialized,
      labPackageSha256: String(receipt.lab_package_sha256),
    });
    const verified = await execFileAsync(
      process.execPath,
      [
        join(repositoryRoot, "scripts/verify-phase4b-cleanroom.mjs"),
        materialized,
        submission,
        positive.receiptPath,
      ],
      { cwd: repositoryRoot },
    );
    assert.equal(
      (JSON.parse(verified.stdout) as { readonly mechanically_valid?: unknown }).mechanically_valid,
      true,
    );
    assert.equal(
      (
        JSON.parse(
          await readFile(join(repositoryRoot, ".github/open-source-status.json"), "utf8"),
        ) as {
          readonly human_cleanroom?: unknown;
        }
      ).human_cleanroom,
      "pending",
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
