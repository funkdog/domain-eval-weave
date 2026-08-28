import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { ReservationLedger } from "../../src/ledger.ts";

test("reserve and snapshot", async () => {
  await mkdir(resolve("tmp"), { recursive: true });
  const root = await mkdtemp(resolve("tmp", "ledger-public-"));
  try {
    const ledger = await ReservationLedger.open(resolve(root, "state.json"), 5);
    await ledger.reserve({ requestId: "one", key: "alpha", units: 2 });
    assert.equal((await ledger.snapshot()).used, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
