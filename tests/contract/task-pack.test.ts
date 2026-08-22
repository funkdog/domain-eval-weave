import assert from "node:assert/strict";
import { cp, link, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import {
  digestDirectory,
  digestTaskPack,
  loadObservationCatalog,
  loadTaskPack,
  loadTaskPackIdentity,
} from "../../src/task-pack/loader.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-ledger-v1", import.meta.url),
);
const commercePackRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v1", import.meta.url),
);
const commerceWithdrawalPackRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v2", import.meta.url),
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

test("the commerce Task Pack binds its exact v2 template, corpus, and catalog", async () => {
  const [pack, identity, catalog] = await Promise.all([
    loadTaskPack(commercePackRoot),
    loadTaskPackIdentity(commercePackRoot),
    loadObservationCatalog(commercePackRoot),
  ]);
  assert.equal(pack.schema_version, 2);
  assert.equal(pack.task_id, "open-coding-ts-commerce-order-v1");
  assert.equal(pack.base_tree_sha256, await digestDirectory(`${commercePackRoot}/base`));
  assert.equal(pack.calibration_digest, await digestDirectory(`${commercePackRoot}/calibration`));
  assert.equal(identity.schema_version, 2);
  assert.equal(identity.pack.task_id, pack.task_id);
  assert.equal(catalog.template_id, "commerce-order-cancellation-v1");
  assert.equal(catalog.behaviors.length, 8);
  assert.match(await readFile(`${commercePackRoot}/public-task.md`, "utf8"), /TASK_COMPLETE/);
});

test("the commerce withdrawal successor binds its own task, Oracle, and sixteen behaviors", async () => {
  const [pack, identity, catalog] = await Promise.all([
    loadTaskPack(commerceWithdrawalPackRoot),
    loadTaskPackIdentity(commerceWithdrawalPackRoot),
    loadObservationCatalog(commerceWithdrawalPackRoot),
  ]);
  assert.equal(pack.schema_version, 2);
  assert.equal(pack.template_id, "commerce-order-cancellation-v2");
  assert.equal(pack.task_id, "open-coding-ts-commerce-order-v2");
  assert.equal(pack.base_tree_sha256, await digestDirectory(`${commerceWithdrawalPackRoot}/base`));
  assert.equal(
    pack.calibration_digest,
    await digestDirectory(`${commerceWithdrawalPackRoot}/calibration`),
  );
  assert.equal(identity.schema_version, 2);
  assert.equal(identity.template_id, "commerce-order-cancellation-v2");
  assert.equal(catalog.template_id, "commerce-order-cancellation-v2");
  assert.equal(catalog.behaviors.length, 16);
  assert.match(
    await readFile(`${commerceWithdrawalPackRoot}/public-task.md`, "utf8"),
    /TASK_COMPLETE/,
  );
});

test("Task Pack digest binds the public task, hidden Oracle, and observation catalog bytes", async () => {
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
    const afterOracle = await digestTaskPack(scratch);
    assert.notEqual(afterOracle, afterTask);
    const catalogPath = `${scratch}/claim-observation-catalog.json`;
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      behaviors: Array<{ statement: string }>;
    };
    const first = catalog.behaviors[0];
    assert.ok(first);
    first.statement = "changed public observation meaning";
    await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`);
    assert.notEqual(await digestTaskPack(scratch), afterOracle);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("Task Pack rejects a catalog hard-linked to an external inode before reading it", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/task-pack-hardlink-`);
  await cp(packRoot, scratch, { recursive: true });
  const catalogPath = `${scratch}/claim-observation-catalog.json`;
  const externalPath = `${parent}/external-catalog-${scratch.split("-").at(-1)}.json`;
  try {
    await writeFile(externalPath, await readFile(catalogPath), { mode: 0o600 });
    await unlink(catalogPath);
    await link(externalPath, catalogPath);
    await assert.rejects(loadObservationCatalog(scratch), /single-link physical file/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(externalPath, { force: true });
  }
});
