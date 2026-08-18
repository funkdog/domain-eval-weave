import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  assertAuthorProfileRoles,
  assertProfileRoles,
  authorProfileFiles,
  materializeFrozenFiles,
  ProfileContractError,
  runnerProfileFiles,
  verifySharedModelSettings,
} from "../../src/runtime-profile/init.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

test("runner profile files freeze the exact package and opposite app/bridge roles", async () => {
  const files = runnerProfileFiles("file:/tmp/dsh-eval-lab.tgz");
  const manifest = JSON.parse(files.get("package.json") ?? "null") as {
    name: string;
    dependencies: Record<string, string>;
    dsh: { profile: { bundles: string[] } };
  };
  assert.equal(manifest.name, "dsh-profile-eval-clowder-runner");
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

test("author profile enables only the domain Skill authoring surface", () => {
  const files = authorProfileFiles("file:/tmp/dsh-eval-lab.tgz");
  const manifest = JSON.parse(files.get("package.json") ?? "null") as {
    name: string;
    dependencies: Record<string, string>;
    dsh: { profile: { bundles: string[] } };
  };
  assert.equal(manifest.name, "dsh-profile-eval-clowder-author");
  assert.equal(manifest.dependencies["dsh-eval-lab"], "file:/tmp/dsh-eval-lab.tgz");
  assert.deepEqual(manifest.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-headless",
    "dsh-codex-connect",
    "dsh-eval-lab",
  ]);

  assertAuthorProfileRoles([
    { id: "dsh-eval-app", disabled: true },
    { id: "dsh-eval-bridge", disabled: true },
    { id: "dsh-eval-domain-skill", disabled: false },
    { id: "tool-skill", disabled: false },
    { id: "tool-str-replace-editor", disabled: false },
    { id: "tool-web", disabled: true },
  ]);
  assert.throws(
    () =>
      assertAuthorProfileRoles([
        { id: "dsh-eval-app", disabled: true },
        { id: "dsh-eval-bridge", disabled: false },
        { id: "dsh-eval-domain-skill", disabled: false },
        { id: "tool-skill", disabled: false },
        { id: "tool-str-replace-editor", disabled: false },
        { id: "tool-web", disabled: true },
      ]),
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

test("profile materialization rejects a root symlink before writing frozen files", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/profile-symlink-`);
  const outside = await mkdtemp(`${scratchParent}/profile-outside-`);
  const linkedRoot = `${scratch}/eval-runner`;
  await symlink(outside, linkedRoot);

  try {
    await assert.rejects(
      materializeFrozenFiles(linkedRoot, runnerProfileFiles("file:/tmp/dsh-eval-lab.tgz")),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_PATH_INVALID",
    );
    await assert.rejects(readFile(`${outside}/package.json`, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("shared model settings are validated read-only while unrelated configuration remains free", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/shared-settings-`);
  const settings = `${root}/settings.yaml`;

  try {
    const source = [
      "telemetry:",
      "  enabled: false",
      "agent-default-model:",
      "  provider: openai-codex",
      "  model: gpt-5.6-sol",
      "  reasoningEffort: xhigh",
      "  transportOption: preserved",
      "another-implementation:",
      "  profile: eval-dsh",
      "",
    ].join("\n");
    await writeFile(settings, source, { mode: 0o600 });
    await verifySharedModelSettings(root);
    assert.equal(await readFile(settings, "utf8"), source);

    await writeFile(settings, source.replace("gpt-5.6-sol", "wrong-model"), "utf8");
    await assert.rejects(
      verifySharedModelSettings(root),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "MODEL_ROUTE_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
