import assert from "node:assert/strict";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import test from "node:test";
import { PHASE3A_AUTHOR } from "../../src/instance.js";
import {
  assertAuthorProfileRoles,
  assertProfileRoles,
  authorProfileFiles,
  installPhase3ProfilesAtomically,
  legacyPhase2RunnerProfileFiles,
  materializeFrozenFiles,
  ProfileContractError,
  runnerProfileFiles,
  verifyFrozenFiles,
  verifySharedModelSettings,
} from "../../src/runtime-profile/init.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

function syntheticProfileLockfile(packageSpec: string): string {
  return [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      dsh-codex-connect:",
    `        specifier: ${JSON.stringify("0.1.0-alpha.4.7")}`,
    "        version: synthetic",
    "      dsh-eval-lab:",
    `        specifier: ${JSON.stringify(packageSpec)}`,
    "        version: synthetic",
    "",
  ].join("\n");
}

async function acceptSyntheticPackageContent(): Promise<void> {}

async function writeSyntheticInstalledProfile(
  root: string,
  packageSpec: string,
  version: string,
): Promise<void> {
  await mkdir(`${root}/node_modules/dsh-eval-lab`, { recursive: true, mode: 0o700 });
  await mkdir(`${root}/node_modules/dsh-codex-connect`, { recursive: true, mode: 0o700 });
  await writeFile(`${root}/pnpm-lock.yaml`, syntheticProfileLockfile(packageSpec), "utf8");
  await writeFile(
    `${root}/node_modules/dsh-eval-lab/package.json`,
    `${JSON.stringify({ name: "dsh-eval-lab", version })}\n`,
    "utf8",
  );
  await writeFile(
    `${root}/node_modules/dsh-codex-connect/package.json`,
    `${JSON.stringify({ name: "dsh-codex-connect", version: "0.1.0-alpha.4.7" })}\n`,
    "utf8",
  );
}

async function writeSyntheticInstalledProfileWithEvalSymlink(
  root: string,
  externalPackageRoot: string,
  packageSpec: string,
  version: string,
): Promise<void> {
  await mkdir(`${root}/node_modules/dsh-codex-connect`, { recursive: true, mode: 0o700 });
  await mkdir(externalPackageRoot, { recursive: true, mode: 0o700 });
  await writeFile(`${root}/pnpm-lock.yaml`, syntheticProfileLockfile(packageSpec), "utf8");
  await writeFile(
    `${externalPackageRoot}/package.json`,
    `${JSON.stringify({ name: "dsh-eval-lab", version })}\n`,
    "utf8",
  );
  await writeFile(
    `${root}/node_modules/dsh-codex-connect/package.json`,
    `${JSON.stringify({ name: "dsh-codex-connect", version: "0.1.0-alpha.4.7" })}\n`,
    "utf8",
  );
  await symlink(externalPackageRoot, `${root}/node_modules/dsh-eval-lab`);
}

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
      { id: "dsh-eval-author-bridge", disabled: true },
    ],
    "runner",
  );
  assert.throws(
    () =>
      assertProfileRoles(
        [
          { id: "dsh-eval-app", disabled: false },
          { id: "dsh-eval-bridge", disabled: false },
          { id: "dsh-eval-author-bridge", disabled: true },
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

  const authorRows = [
    { id: "dsh-eval-app", disabled: true },
    { id: "dsh-eval-bridge", disabled: true },
    { id: "dsh-eval-author-bridge", disabled: false },
    { id: "dsh-eval-domain-skill", disabled: false },
    {
      id: "session-persistence-jsonl",
      config: {
        root: PHASE3A_AUTHOR.sessionsRoot,
        compression: "none",
        packChunks: false,
      },
    },
    { id: "tool-bash", disabled: true },
    { id: "tool-pwsh", disabled: true },
    { id: "tool-jobs", disabled: true },
    { id: "tool-skill", disabled: false },
    { id: "tool-str-replace-editor", disabled: false },
    { id: "tool-web", disabled: true },
    { id: "tool-subagent-control", disabled: true },
    { id: "tool-subagent-list-agents", disabled: true },
    { id: "tool-subagent", disabled: true },
    { id: "tool-subagent-fork", disabled: true },
    { id: "tool-subagent-report", disabled: true },
    { id: "tool-workflow", disabled: true },
    { id: "tool-ralph", disabled: true },
  ] as const;
  assertAuthorProfileRoles(authorRows);
  assert.throws(
    () =>
      assertAuthorProfileRoles(
        authorRows.map((row) => (row.id === "tool-bash" ? { ...row, disabled: false } : row)),
      ),
    ProfileContractError,
  );
  assert.throws(
    () =>
      assertAuthorProfileRoles(
        authorRows.map((row) =>
          row.id === "session-persistence-jsonl"
            ? { ...row, config: { ...row.config, root: "/tmp/wrong" } }
            : row,
        ),
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

test("Phase 3 init atomically upgrades a Phase 2 runner and creates the author profile", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const previousSpec = "file:/runtime/packages/phase2/dsh-eval-lab-0.2.0-rc.4.tgz";
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, legacyPhase2RunnerProfileFiles(previousSpec));
    await writeSyntheticInstalledProfile(runnerRoot, previousSpec, "0.2.0-rc.4");
    await writeFile(`${runnerRoot}/cordis.yml`, "[]\n", "utf8");

    const changed = await installPhase3ProfilesAtomically({
      runnerRoot,
      authorRoot,
      packageSpec: nextSpec,
      packageVersion: "0.3.0-alpha.1",
      verifyPackageContent: acceptSyntheticPackageContent,
      install: async (profileRoot) => {
        installs += 1;
        await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
      },
    });

    assert.deepEqual(changed, [runnerRoot, authorRoot]);
    assert.equal(installs, 2);
    await verifyFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await verifyFrozenFiles(authorRoot, authorProfileFiles(nextSpec));
    assert.equal(await readFile(`${runnerRoot}/cordis.yml`, "utf8"), "[]\n");

    assert.deepEqual(
      await installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async () => {
          installs += 1;
        },
      }),
      [],
    );
    assert.equal(installs, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile upgrade rejects unrecognized drift before staging", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-drift-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const previousSpec = "file:/runtime/packages/phase2/dsh-eval-lab-0.2.0-rc.4.tgz";
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, legacyPhase2RunnerProfileFiles(previousSpec));
    await writeSyntheticInstalledProfile(runnerRoot, previousSpec, "0.2.0-rc.4");
    await writeFile(`${runnerRoot}/cordis.patch.yml`, "- id: unauthorized-drift\n", "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async () => {
          installs += 1;
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONTENT_MISMATCH",
    );
    assert.equal(installs, 0);
    assert.equal(
      await readFile(`${runnerRoot}/cordis.patch.yml`, "utf8"),
      "- id: unauthorized-drift\n",
    );
    await assert.rejects(access(authorRoot), { code: "ENOENT" });
    assert.deepEqual(await readdir(root), ["eval-clowder-runner"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile preflight rejects a current package directory symlink", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-current-package-symlink-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const externalPackageRoot = `${root}/external-current-package`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await writeSyntheticInstalledProfileWithEvalSymlink(
      runnerRoot,
      externalPackageRoot,
      nextSpec,
      "0.3.0-alpha.1",
    );

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async () => {
          installs += 1;
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_INSTALL_INVALID",
    );
    assert.equal(installs, 0);
    assert.equal((await lstat(`${runnerRoot}/node_modules/dsh-eval-lab`)).isSymbolicLink(), true);
    await assert.rejects(access(authorRoot), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile preflight rejects a legacy package directory symlink", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-legacy-package-symlink-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const externalPackageRoot = `${root}/external-legacy-package`;
  const previousSpec = "file:/runtime/packages/phase2/dsh-eval-lab-0.2.0-rc.4.tgz";
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, legacyPhase2RunnerProfileFiles(previousSpec));
    await writeSyntheticInstalledProfileWithEvalSymlink(
      runnerRoot,
      externalPackageRoot,
      previousSpec,
      "0.2.0-rc.4",
    );

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async () => {
          installs += 1;
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_INSTALL_INVALID",
    );
    assert.equal(installs, 0);
    assert.equal((await lstat(`${runnerRoot}/node_modules/dsh-eval-lab`)).isSymbolicLink(), true);
    await assert.rejects(access(authorRoot), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile preflight binds current package bytes to management", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-current-package-drift-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(runnerRoot, nextSpec, "0.3.0-alpha.1");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        verifyPackageContent: async () => {
          throw new Error("synthetic byte drift");
        },
        install: async () => {
          installs += 1;
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_INSTALL_MISMATCH",
    );
    assert.equal(installs, 0);
    await assert.rejects(access(authorRoot), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile upgrade leaves both live profiles untouched when staged install fails", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-install-failure-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const previousSpec = "file:/runtime/packages/phase2/dsh-eval-lab-0.2.0-rc.4.tgz";
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, legacyPhase2RunnerProfileFiles(previousSpec));
    await writeSyntheticInstalledProfile(runnerRoot, previousSpec, "0.2.0-rc.4");
    const previousPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async (profileRoot) => {
          installs += 1;
          if (installs === 2) throw new Error("synthetic install failure");
          await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
        },
      }),
      /synthetic install failure/,
    );

    assert.equal(installs, 2);
    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), previousPackage);
    await assert.rejects(access(authorRoot), { code: "ENOENT" });
    assert.deepEqual(await readdir(root), ["eval-clowder-runner"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile upgrade rolls the runner back when the author switch conflicts", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-commit-failure-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const previousSpec = "file:/runtime/packages/phase2/dsh-eval-lab-0.2.0-rc.4.tgz";
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, legacyPhase2RunnerProfileFiles(previousSpec));
    await writeSyntheticInstalledProfile(runnerRoot, previousSpec, "0.2.0-rc.4");
    const previousPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async (profileRoot) => {
          installs += 1;
          await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
          if (installs === 2) {
            await mkdir(authorRoot, { mode: 0o700 });
            await writeFile(`${authorRoot}/concurrent-owner`, "preserve\n", "utf8");
          }
        },
      }),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOTEMPTY",
    );

    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), previousPackage);
    assert.equal(await readFile(`${authorRoot}/concurrent-owner`, "utf8"), "preserve\n");
    assert.deepEqual((await readdir(root)).sort(), ["eval-clowder-author", "eval-clowder-runner"]);
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
