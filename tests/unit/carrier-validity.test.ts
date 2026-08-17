import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { discoverFreshSession } from "../../src/carrier/session-discovery.js";
import { readStableSessionTranscript } from "../../src/carrier/session-inventory.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { assessMeasurementValidity } from "../../src/validity/index.js";

test("session discovery requires exactly one new root session in the arm interval", () => {
  const before = [
    {
      id: "old",
      cwd: "/workspace",
      createdAt: Date.parse("2026-08-17T09:00:00.000Z"),
      delegationDepth: 0,
    },
  ];
  const newEntry = {
    id: "new",
    cwd: "/workspace",
    createdAt: Date.parse("2026-08-17T10:00:01.000Z"),
    delegationDepth: 0,
  };
  const after = [...before, newEntry];
  assert.equal(
    discoverFreshSession({
      before,
      after,
      workspace: "/workspace",
      startedAt: "2026-08-17T10:00:00.000Z",
      endedAt: "2026-08-17T10:01:00.000Z",
    }).id,
    "new",
  );
  assert.throws(() =>
    discoverFreshSession({
      before,
      after: [...after, { ...newEntry, id: "other" }],
      workspace: "/workspace",
      startedAt: "2026-08-17T10:00:00.000Z",
      endedAt: "2026-08-17T10:01:00.000Z",
    }),
  );
});

test("Session transcript must remain byte-stable after the carrier exits", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/session-stability-`);
  const transcript = `${root}/session.jsonl`;
  await writeFile(transcript, "first\n");
  try {
    assert.equal(await readStableSessionTranscript(transcript, 1), "first\n");
    const changing = readStableSessionTranscript(transcript, 30);
    const writer = new Promise<void>((resolveWriter, rejectWriter) =>
      setTimeout(
        () => void writeFile(transcript, "changed\n").then(resolveWriter, rejectWriter),
        5,
      ),
    );
    await assert.rejects(changing, /not stable/);
    await writer;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hard invalidators outrank insufficiency while dimensions remain independent", () => {
  const invalid = assessMeasurementValidity({
    invalidators: ["VARIANT_UNDECLARED_DIFF"],
    insufficient: ["USAGE_MISSING"],
  });
  assert.equal(invalid.overall, "invalid");
  assert.equal(invalid.dimensions.outcome, "invalid");

  const insufficient = assessMeasurementValidity({
    invalidators: [],
    insufficient: ["USAGE_MISSING"],
  });
  assert.equal(insufficient.overall, "insufficient");
  assert.equal(insufficient.dimensions.outcome, "valid");
  assert.equal(insufficient.dimensions.cost, "insufficient");
});
