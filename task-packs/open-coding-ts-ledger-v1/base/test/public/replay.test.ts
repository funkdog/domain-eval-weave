import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { ReservationLedger } from "../../src/ledger.ts";

test("exact reserve replay is idempotent", async () => {
  await mkdir(resolve("tmp"), { recursive: true });
  const root = await mkdtemp(resolve("tmp", "ledger-replay-"));
  try {
    const ledger = await ReservationLedger.open(resolve(root, "state.json"), 5);
    const request = { requestId: "one", key: "alpha", units: 2 };
    assert.deepEqual(await ledger.reserve(request), await ledger.reserve(request));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
