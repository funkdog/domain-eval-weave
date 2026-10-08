import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { loadStaticEvalBinding } from "../../src/registry/loader.js";
import { phase2TaskPackIdentity } from "../../src/suite/identity.js";
import { loadTaskPack } from "../../src/task-pack/loader.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

interface TaskIdentityFields {
  readonly task_id: string;
  readonly public_task_sha256: string;
  readonly effective_base_sha256: string;
}

const IDENTITY_FIELDS = ["task_id", "public_task_sha256", "effective_base_sha256"] as const;

// Frozen from the immutable clowder-ai exposure ledger and holdout reservation indexes. Keeping the
// retired identities in source makes alias reuse fail in CI before a real acceptance preflight.
const HISTORICAL_EXPOSURE_OR_RESERVATION_IDENTITIES: readonly TaskIdentityFields[] = [
  {
    task_id: "ledger-full-v1",
    public_task_sha256: "9074f43d9722bc32185a5ac42ca32cf550c378768c5ce979b5f06f3f1c65358f",
    effective_base_sha256: "c3627bf66ad2d3df607d2264728b6b1f0409857b714a37dbffd13b71772ddbd5",
  },
  {
    task_id: "ledger-audit-v1",
    public_task_sha256: "df9237080f7d4798acc1c3daa89074544e2fa7760bcbcc18a45b4f60f52864a6",
    effective_base_sha256: "248a5125a5c8ef88c1029174e7b900afaf9650f319f6779e55f273d2ab5162d3",
  },
  {
    task_id: "ledger-concurrency-v1",
    public_task_sha256: "febdf2dcc969e10d30a78b40350dfa77a9ad2fef7a6ad66321ed66d0e35a8986",
    effective_base_sha256: "effc0ee093dff036900fa85694b823dcf16616043829fb0fa0ec8fc34e45cfbd",
  },
  {
    task_id: "ledger-restart-recovery-v1",
    public_task_sha256: "031ac8d0241a33b61561cfb8128c31c370c6da9f08772a051f5fd720fa95c6e5",
    effective_base_sha256: "c7d61935d5f71061eba26e670257df6c45c6d0bb162bd1bfded74d58f928eeef",
  },
];

function assertFieldwiseUnique(identities: readonly TaskIdentityFields[]): void {
  for (const field of IDENTITY_FIELDS) {
    assert.equal(
      new Set(identities.map((identity) => identity[field])).size,
      identities.length,
      `Registry ${field} values must be unique`,
    );
  }
}

function assertNoHistoricalReuse(candidate: TaskIdentityFields): void {
  for (const field of IDENTITY_FIELDS) {
    const historicalValues = new Set(
      HISTORICAL_EXPOSURE_OR_RESERVATION_IDENTITIES.map((identity) => identity[field]),
    );
    assert.ok(!historicalValues.has(candidate[field]), `holdout reuses historical ${field}`);
  }
}

test("each Registry Task has a distinct Phase 1-compatible frozen identity", async () => {
  const binding = await loadStaticEvalBinding(PACKAGE_ROOT);
  const legacy = await loadTaskPack(`${PACKAGE_ROOT}/task-packs/open-coding-ts-ledger-v1`);
  const identities = binding.tasks.map((task) => phase2TaskPackIdentity(task, legacy));

  assert.equal(new Set(identities.map(canonicalJsonDigest)).size, 3);
  assertFieldwiseUnique(binding.tasks);
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
  assertNoHistoricalReuse(holdout);

  for (const field of IDENTITY_FIELDS) {
    const historical = HISTORICAL_EXPOSURE_OR_RESERVATION_IDENTITIES[0];
    assert.ok(historical);
    assert.throws(
      () => assertNoHistoricalReuse({ ...holdout, [field]: historical[field] }),
      new RegExp(`historical ${field}`),
    );
  }
});
