import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import test from "node:test";

import {
  ConfirmationLedgerError,
  OwnerConfirmationLedger,
} from "../../src/domain/confirmation-ledger.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { validOwnerConfirmation } from "../helpers/phase3a-fixtures.js";

test("owner confirmation ledger is immutable, idempotent, and digest-bound", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/confirmation-ledger-`);
  const ledger = new OwnerConfirmationLedger(root);
  const event = {
    ...validOwnerConfirmation,
    confirmation_id: `confirm-${randomUUID()}`,
  };
  try {
    const pointer = await ledger.write(event);
    assert.deepEqual(await ledger.write(event), pointer);
    assert.deepEqual(await ledger.read(pointer), event);
    await assert.rejects(
      ledger.write({ ...event, actor_id: "forged-owner" }),
      (error: unknown) =>
        error instanceof ConfirmationLedgerError && error.code === "CONFIRMATION_CONFLICT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owner confirmation ledger rejects a symlink root", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/confirmation-symlink-`);
  const outside = await mkdtemp(`${parent}/confirmation-outside-`);
  const linked = `${scratch}/ledger`;
  await symlink(outside, linked);
  try {
    await assert.rejects(
      new OwnerConfirmationLedger(linked).write(validOwnerConfirmation),
      (error: unknown) => error instanceof ConfirmationLedgerError,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("owner confirmation replay never creates a missing ledger root", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/confirmation-ledger-readonly-`);
  const missingRoot = `${scratch}/missing`;
  try {
    await assert.rejects(
      new OwnerConfirmationLedger(missingRoot).read({
        confirmation_id: "missing-confirmation",
        sha256: "a".repeat(64),
      }),
    );
    await assert.rejects(lstat(missingRoot), { code: "ENOENT" });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
