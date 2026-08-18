import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { loadStaticEvalBinding } from "../../src/registry/loader.js";
import { phase2TaskPackIdentity } from "../../src/suite/identity.js";
import { loadTaskPack } from "../../src/task-pack/loader.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

test("each Registry Task has a distinct Phase 1-compatible frozen identity", async () => {
  const binding = await loadStaticEvalBinding(PACKAGE_ROOT);
  const legacy = await loadTaskPack(`${PACKAGE_ROOT}/task-packs/open-coding-ts-ledger-v1`);
  const identities = binding.tasks.map((task) => phase2TaskPackIdentity(task, legacy));

  assert.equal(new Set(identities.map(canonicalJsonDigest)).size, 3);
  for (const [index, task] of binding.tasks.entries()) {
    const identity = identities[index];
    assert.ok(identity);
    assert.equal(identity.pack.base_tree_sha256, task.effective_base_sha256);
    assert.equal(identity.public_task_sha256, task.public_task_sha256);
    assert.equal(identity.oracle_runner_sha256, task.oracle.runner_sha256);
    assert.equal(identity.pack.oracle_version, task.oracle.version);
  }
});

test("renewed holdout has a genuinely new task, public-task, and effective-base identity", async () => {
  const binding = await loadStaticEvalBinding(PACKAGE_ROOT);
  const holdout = binding.tasks.find((task) => task.bucket === "holdout");

  assert.ok(holdout);
  assert.equal(holdout.task_id, "ledger-release-recovery-v1");
  assert.notEqual(
    holdout.public_task_sha256,
    "031ac8d0241a33b61561cfb8128c31c370c6da9f08772a051f5fd720fa95c6e5",
  );
  assert.notEqual(
    holdout.effective_base_sha256,
    "c7d61935d5f71061eba26e670257df6c45c6d0bb162bd1bfded74d58f928eeef",
  );
});
