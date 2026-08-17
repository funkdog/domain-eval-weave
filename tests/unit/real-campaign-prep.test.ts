import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createOpaqueArmWorkspaces, initializeGitWorkspace } from "../../src/campaign/real.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const execFileAsync = promisify(execFile);

test("real Campaign preparation creates nested fresh Git workspaces with opaque arm identities", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/campaign-prep-`);
  const destination = `${root}/nested/opaque-episode`;
  const source = fileURLToPath(
    new URL("../../task-packs/open-coding-ts-ledger-v1/base", import.meta.url),
  );
  try {
    await initializeGitWorkspace(source, destination);
    assert.match(
      (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: destination })).stdout,
      /^[0-9a-f]{40}\n$/,
    );
    await assert.rejects(initializeGitWorkspace(source, destination));

    const workspaces = createOpaqueArmWorkspaces();
    assert.notEqual(workspaces.control, workspaces.treatment);
    assert.equal(/campaign|control|treatment|undefined/.test(workspaces.control), false);
    assert.equal(/campaign|control|treatment|undefined/.test(workspaces.treatment), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
