import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  assertProfileRoles,
  materializeFrozenFiles,
  ProfileContractError,
  runnerProfileFiles,
} from "../../src/runtime-profile/init.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

test("runner profile files freeze the exact package and opposite app/bridge roles", async () => {
  const files = runnerProfileFiles("file:/tmp/dsh-eval-lab.tgz");
  const manifest = JSON.parse(files.get("package.json") ?? "null") as {
    dependencies: Record<string, string>;
    dsh: { profile: { bundles: string[] } };
  };
  assert.equal(manifest.dependencies["dsh-codex-connect"], "0.1.0-alpha.4.7");
  assert.equal(manifest.dependencies["dsh-eval-lab"], "file:/tmp/dsh-eval-lab.tgz");
  assert.deepEqual(manifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-headless",
    "dsh-codex-connect",
    "dsh-eval-lab",
  ]);

  assertProfileRoles(
    [
      { id: "dsh-eval-app", disabled: true },
      { id: "dsh-eval-bridge", disabled: false },
    ],
    "runner",
  );
  assert.throws(
    () =>
      assertProfileRoles(
        [
          { id: "dsh-eval-app", disabled: false },
          { id: "dsh-eval-bridge", disabled: false },
        ],
        "runner",
      ),
    ProfileContractError,
  );
});

test("profile materialization is idempotent and never overwrites drift", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-m1-`);
  const files = runnerProfileFiles("file:/tmp/dsh-eval-lab.tgz");

  try {
    const first = await materializeFrozenFiles(root, files);
    assert.ok(first.length >= 3);
    assert.deepEqual(await materializeFrozenFiles(root, files), []);
    await writeFile(`${root}/package.json`, "{}\n", "utf8");
    await assert.rejects(
      materializeFrozenFiles(root, files),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONTENT_MISMATCH",
    );
    assert.equal(await readFile(`${root}/package.json`, "utf8"), "{}\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
