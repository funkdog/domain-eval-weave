import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { digestDirectory, digestTaskPack, loadTaskPack } from "../../src/task-pack/loader.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-ledger-v1", import.meta.url),
);

test("Task Pack manifest binds the base tree and calibration corpus digests", async () => {
  const pack = await loadTaskPack(packRoot);
  assert.equal(pack.task_id, "open-coding-ts-ledger-v1");
  assert.equal(pack.base_tree_sha256, await digestDirectory(`${packRoot}/base`));
  assert.equal(pack.calibration_digest, await digestDirectory(`${packRoot}/calibration`));
  assert.equal(
    await readFile(`${packRoot}/${pack.public_task_ref}`, "utf8").then((text) =>
      text.includes("TASK_COMPLETE"),
    ),
    true,
  );
});

test("Task Pack digest binds the public task and hidden Oracle bytes", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/task-pack-digest-`);
  await cp(packRoot, scratch, { recursive: true });
  try {
    const before = await digestTaskPack(scratch);
    await writeFile(`${scratch}/public-task.md`, "changed public task\n");
    const afterTask = await digestTaskPack(scratch);
    assert.notEqual(afterTask, before);
    await writeFile(`${scratch}/oracle/runner.mjs`, "changed hidden Oracle\n");
    assert.notEqual(await digestTaskPack(scratch), afterTask);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
