import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import test from "node:test";
import { canonicalJson, sha256Hex } from "../../src/contracts/canonical-json.js";
import {
  ExposureLedger,
  ExposureLedgerError,
  phase2ExposureId,
} from "../../src/exposure/ledger.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { validExposureRecord } from "../helpers/phase2-fixtures.js";

async function scratchRoot(label: string): Promise<string> {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(`${parent}/${label}-`);
}

test("exposure records are canonical, immutable, permissioned, and concurrency-safe", async () => {
  const scratch = await scratchRoot("phase2-exposure");
  const instanceRoot = `${scratch}/instance`;
  const ledger = new ExposureLedger(instanceRoot);
  const record = {
    ...validExposureRecord,
    exposure_id: phase2ExposureId("suite-1", "ledger-full-v1", "control"),
  };
  try {
    const writes = await Promise.all(Array.from({ length: 32 }, () => ledger.write(record)));
    assert.equal(new Set(writes.map((write) => write.sha256)).size, 1);
    assert.equal(writes[0]?.sha256, sha256Hex(canonicalJson(record)));

    const exposurePath = `${instanceRoot}/exposures/${record.exposure_id}.json`;
    assert.equal(await readFile(exposurePath, "utf8"), canonicalJson(record));
    assert.equal((await lstat(`${instanceRoot}/exposures`)).mode & 0o777, 0o700);
    assert.equal((await lstat(exposurePath)).mode & 0o777, 0o600);
    assert.deepEqual(await ledger.read(record.exposure_id), {
      path: exposurePath,
      sha256: sha256Hex(canonicalJson(record)),
      record,
    });

    await assert.rejects(
      ledger.write({ ...record, ended_at: "2026-08-18T00:02:00.000Z" }),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "EXPOSURE_ALREADY_EXISTS",
    );
    assert.deepEqual(await ledger.list(), [record]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("read-only exposure replay never creates a missing ledger root", async () => {
  const scratch = await scratchRoot("phase2-exposure-read-only");
  const instanceRoot = `${scratch}/instance`;
  await mkdir(instanceRoot, { mode: 0o700 });
  const ledger = new ExposureLedger(instanceRoot);
  try {
    await assert.rejects(
      ledger.read("suite-1--ledger-full-v1--control"),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "EXPOSURE_ROOT_INVALID",
    );
    await assert.rejects(lstat(`${instanceRoot}/exposures`), { code: "ENOENT" });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("holdout freshness is checked before a model is exposed", async () => {
  const scratch = await scratchRoot("phase2-holdout");
  const ledger = new ExposureLedger(`${scratch}/instance`);
  const identity = {
    task_id: "ledger-restart-recovery-v1",
    public_task_sha256: "9".repeat(64),
    effective_base_sha256: "a".repeat(64),
  } as const;
  try {
    await ledger.assertHoldoutUnexposed(identity);
    await ledger.write({
      ...validExposureRecord,
      exposure_id: phase2ExposureId("suite-1", "ledger-full-v1", "control"),
    });
    await ledger.assertHoldoutUnexposed(identity);

    await assert.rejects(
      ledger.assertHoldoutUnexposed({
        ...identity,
        task_id: "renamed-public-task",
        public_task_sha256: validExposureRecord.public_task_sha256,
      }),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "HOLDOUT_ALREADY_EXPOSED",
    );
    await assert.rejects(
      ledger.assertHoldoutUnexposed({
        ...identity,
        task_id: "renamed-base-task",
        effective_base_sha256: validExposureRecord.effective_base_sha256,
      }),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "HOLDOUT_ALREADY_EXPOSED",
    );

    const holdout = {
      ...validExposureRecord,
      exposure_id: phase2ExposureId("suite-1", "ledger-restart-recovery-v1", "control"),
      task_id: "ledger-restart-recovery-v1",
      bucket: "holdout" as const,
      public_task_sha256: identity.public_task_sha256,
      effective_base_sha256: identity.effective_base_sha256,
    };
    await assert.rejects(
      ledger.write(holdout),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "HOLDOUT_RESERVATION_MISSING",
    );
    await ledger.reserveHoldout(identity, "suite-1");
    await ledger.write(holdout);
    await assert.rejects(
      ledger.assertHoldoutUnexposed(identity),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "HOLDOUT_ALREADY_EXPOSED",
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("concurrent Suites atomically reserve the one allowed holdout exposure", async () => {
  const scratch = await scratchRoot("phase2-holdout-reservation");
  const ledger = new ExposureLedger(`${scratch}/instance`);
  const identity = {
    task_id: "ledger-restart-recovery-v1",
    public_task_sha256: "9".repeat(64),
    effective_base_sha256: "a".repeat(64),
  } as const;
  try {
    const attempts = await Promise.allSettled(
      Array.from({ length: 32 }, (_, index) => ledger.reserveHoldout(identity, `suite-${index}`)),
    );
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 31);
    for (const attempt of attempts) {
      if (attempt.status === "fulfilled") continue;
      assert.equal(attempt.reason instanceof ExposureLedgerError, true);
      assert.equal((attempt.reason as ExposureLedgerError).code, "HOLDOUT_ALREADY_RESERVED");
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("holdout reservations cannot be bypassed by relabeling frozen evidence", async () => {
  const scratch = await scratchRoot("phase2-holdout-alias-reservation");
  const ledger = new ExposureLedger(`${scratch}/instance`);
  const identity = {
    task_id: "ledger-restart-recovery-v1",
    public_task_sha256: "9".repeat(64),
    effective_base_sha256: "a".repeat(64),
  } as const;
  try {
    await ledger.reserveHoldout(identity, "suite-1");
    await assert.rejects(
      ledger.reserveHoldout(
        { ...identity, task_id: "renamed-public-task", effective_base_sha256: "b".repeat(64) },
        "suite-2",
      ),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "HOLDOUT_ALREADY_RESERVED",
    );
    await assert.rejects(
      ledger.reserveHoldout(
        { ...identity, task_id: "renamed-base-task", public_task_sha256: "c".repeat(64) },
        "suite-3",
      ),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "HOLDOUT_ALREADY_RESERVED",
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("exposure ledger rejects a symlinked storage root", async () => {
  const scratch = await scratchRoot("phase2-exposure-symlink");
  const instanceRoot = `${scratch}/instance`;
  await mkdir(instanceRoot, { mode: 0o700 });
  await mkdir(`${scratch}/outside`, { mode: 0o700 });
  await symlink(`${scratch}/outside`, `${instanceRoot}/exposures`);
  const ledger = new ExposureLedger(instanceRoot);
  const record = {
    ...validExposureRecord,
    exposure_id: phase2ExposureId("suite-1", "ledger-full-v1", "control"),
  };
  try {
    await assert.rejects(
      ledger.write(record),
      (error: unknown) =>
        error instanceof ExposureLedgerError && error.code === "EXPOSURE_ROOT_INVALID",
    );
    await assert.rejects(
      readFile(`${scratch}/outside/${record.exposure_id}.json`),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
