import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  confirmCapsuleClaim,
  loadCapsule,
  readCapsuleRelease,
  releaseCapsule,
} from "../../packages/weave/src/capsule/index.js";

const example = new URL("../../examples/capsules/commerce-cancellation/", import.meta.url);

test("Commerce Capsule loads and creates one content-addressed release", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-loader-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const loaded = await loadCapsule(root);
    assert.equal(loaded.manifest.capsule_id, "commerce-cancellation");
    assert.equal(loaded.domain.claims.length, 6);
    assert.equal(loaded.requirements.length, 1);
    assert.equal(loaded.evaluators.length, 2);

    const released = await releaseCapsule(root);
    assert.match(released.ref, /^\.eval\/releases\/[0-9a-f]{64}\.json$/);
    const replayed = await readCapsuleRelease(root, released.ref);
    assert.deepEqual(replayed, released.release);

    const second = await releaseCapsule(root);
    assert.equal(second.sha256, released.sha256);
    assert.equal(second.ref, released.ref);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("explicit owner command confirms one proposed Claim without authored digests", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-confirm-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const claim = await confirmCapsuleClaim({
      root,
      claimId: "cancellation-reason-copy",
      ownerId: "commerce-owner",
    });
    assert.equal(claim.status, "confirmed");
    assert.match(claim.confirmation?.projection_sha256 ?? "", /^[0-9a-f]{64}$/);
    const reloaded = await loadCapsule(root);
    assert.equal(
      reloaded.domain.claims.find((entry) => entry.claim_id === claim.claim_id)?.status,
      "confirmed",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Capsule source symlinks fail closed", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-symlink-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    await rm(join(root, "sources", "product-policy.md"));
    await symlink("/etc/hosts", join(root, "sources", "product-policy.md"));
    await assert.rejects(() => loadCapsule(root), /symlink/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Capsule release detects source drift", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-drift-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const released = await releaseCapsule(root);
    const policy = join(root, "sources", "product-policy.md");
    await writeFile(policy, `${await readFile(policy, "utf8")}\nDrift.\n`, "utf8");
    await assert.rejects(() => readCapsuleRelease(root, released.ref), /drift/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Capsule release detects files added to a frozen Candidate closure", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-extra-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const released = await releaseCapsule(root);
    await writeFile(join(root, "candidates", "gold", "late-file.txt"), "late\n", "utf8");
    await assert.rejects(() => readCapsuleRelease(root, released.ref), /extra|drift/i);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
