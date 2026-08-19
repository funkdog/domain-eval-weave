import assert from "node:assert/strict";
import {
  access,
  copyFile,
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
import { pathToFileURL } from "node:url";
import { sha256Hex } from "../../src/contracts/canonical-json.js";
import { fingerprintPackageContent } from "../../src/fingerprint/deployment.js";
import { PHASE3A_AUTHOR } from "../../src/instance.js";
import {
  assertAuthorProfileRoles,
  assertProfileRoles,
  authorProfileFiles,
  installPhase3ProfilesAtomically,
  legacyPhase2RunnerProfileFiles,
  materializeFrozenFiles,
  ProfileContractError,
  phase3ProfileClaimMarker,
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

async function prepareSyntheticLegacyProfile(
  root: string,
  runnerRoot: string,
): Promise<{
  readonly packageSpec: string;
  readonly evidence: {
    readonly tarballSha256: string;
    readonly tarballSize: number;
    readonly contentSha256: string;
  };
}> {
  const tarball = `${root}/accepted-phase2.tgz`;
  const tarballBytes = Buffer.from("synthetic accepted Phase 2 package\n", "utf8");
  await writeFile(tarball, tarballBytes, { mode: 0o600 });
  const packageSpec = pathToFileURL(tarball).href;
  await materializeFrozenFiles(runnerRoot, legacyPhase2RunnerProfileFiles(packageSpec));
  await writeSyntheticInstalledProfile(runnerRoot, packageSpec, "0.2.0-rc.4");
  return {
    packageSpec,
    evidence: {
      tarballSha256: sha256Hex(tarballBytes),
      tarballSize: tarballBytes.byteLength,
      contentSha256: await fingerprintPackageContent(`${runnerRoot}/node_modules/dsh-eval-lab`),
    },
  };
}

async function prepareSyntheticPhase3Predecessor(
  root: string,
  runnerRoot: string,
  authorRoot: string,
): Promise<{
  readonly packageSpec: string;
  readonly evidence: {
    readonly tarballSha256: string;
    readonly tarballSize: number;
    readonly contentSha256: string;
  };
}> {
  const tarball = `${root}/accepted-phase3a.tgz`;
  const tarballBytes = Buffer.from("synthetic accepted Phase 3A package\n", "utf8");
  await writeFile(tarball, tarballBytes, { mode: 0o600 });
  const packageSpec = pathToFileURL(tarball).href;
  await materializeFrozenFiles(runnerRoot, runnerProfileFiles(packageSpec));
  await materializeFrozenFiles(authorRoot, authorProfileFiles(packageSpec));
  await writeSyntheticInstalledProfile(runnerRoot, packageSpec, "0.3.0-alpha.1");
  await writeSyntheticInstalledProfile(authorRoot, packageSpec, "0.3.0-alpha.1");
  return {
    packageSpec,
    evidence: {
      tarballSha256: sha256Hex(tarballBytes),
      tarballSize: tarballBytes.byteLength,
      contentSha256: await fingerprintPackageContent(`${runnerRoot}/node_modules/dsh-eval-lab`),
    },
  };
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

test("author profile enables only the frozen Skill/helper authoring surface", () => {
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
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    await writeFile(`${runnerRoot}/cordis.yml`, "[]\n", "utf8");

    const changed = await installPhase3ProfilesAtomically({
      runnerRoot,
      authorRoot,
      packageSpec: nextSpec,
      packageVersion: "0.3.0-alpha.1",
      legacyPackageEvidence: evidence,
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
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    await writeFile(`${runnerRoot}/cordis.patch.yml`, "- id: unauthorized-drift\n", "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
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
    assert.deepEqual((await readdir(root)).sort(), ["accepted-phase2.tgz", "eval-clowder-runner"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile upgrade rejects a same-version tampered Phase 2 package", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-legacy-package-drift-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    await mkdir(`${runnerRoot}/node_modules/dsh-eval-lab/dist`, { mode: 0o700 });
    await writeFile(
      `${runnerRoot}/node_modules/dsh-eval-lab/dist/tampered.js`,
      "export const tampered = true;\n",
      "utf8",
    );
    const previousRunnerPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async () => {
          installs += 1;
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_INSTALL_MISMATCH",
    );

    assert.equal(installs, 0);
    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), previousRunnerPackage);
    assert.equal(
      await readFile(`${runnerRoot}/node_modules/dsh-eval-lab/dist/tampered.js`, "utf8"),
      "export const tampered = true;\n",
    );
    await assert.rejects(access(authorRoot), { code: "ENOENT" });
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
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    const manifest = await readFile(`${runnerRoot}/node_modules/dsh-eval-lab/package.json`, "utf8");
    await rm(`${runnerRoot}/node_modules/dsh-eval-lab`, { recursive: true });
    await mkdir(externalPackageRoot, { mode: 0o700 });
    await writeFile(`${externalPackageRoot}/package.json`, manifest, "utf8");
    await symlink(externalPackageRoot, `${runnerRoot}/node_modules/dsh-eval-lab`);

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
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

test("Phase 3 init upgrades the exact accepted Phase 3A predecessor set", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-phase3-successor-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3-next/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticPhase3Predecessor(root, runnerRoot, authorRoot);
    await writeFile(`${runnerRoot}/cordis.yml`, "# runner-local\n[]\n", "utf8");
    await writeFile(`${authorRoot}/cordis.yml`, "# author-local\n[]\n", "utf8");
    const input = {
      runnerRoot,
      authorRoot,
      packageSpec: nextSpec,
      packageVersion: "0.3.0-alpha.1",
      acceptedPhase3PackageEvidence: evidence,
      verifyPackageContent: acceptSyntheticPackageContent,
      install: async (profileRoot: string) => {
        installs += 1;
        await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
      },
    };

    assert.deepEqual(await installPhase3ProfilesAtomically(input), [runnerRoot, authorRoot]);
    assert.equal(installs, 2);
    await verifyFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await verifyFrozenFiles(authorRoot, authorProfileFiles(nextSpec));
    assert.equal(await readFile(`${runnerRoot}/cordis.yml`, "utf8"), "# runner-local\n[]\n");
    assert.equal(await readFile(`${authorRoot}/cordis.yml`, "utf8"), "# author-local\n[]\n");
    assert.deepEqual(await installPhase3ProfilesAtomically(input), []);
    assert.equal(installs, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 successor preflight rejects an accepted runner without its author peer", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-phase3-successor-missing-author-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3-next/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticPhase3Predecessor(root, runnerRoot, authorRoot);
    const runnerManifest = await readFile(`${runnerRoot}/package.json`, "utf8");
    await rm(authorRoot, { recursive: true });

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        acceptedPhase3PackageEvidence: evidence,
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async () => {
          installs += 1;
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONTENT_MISMATCH",
    );
    assert.equal(installs, 0);
    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), runnerManifest);
    await assert.rejects(access(authorRoot), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 successor preflight rejects an accepted author without its runner peer", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-phase3-successor-missing-runner-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3-next/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticPhase3Predecessor(root, runnerRoot, authorRoot);
    const authorManifest = await readFile(`${authorRoot}/package.json`, "utf8");
    await rm(runnerRoot, { recursive: true });

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        acceptedPhase3PackageEvidence: evidence,
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async () => {
          installs += 1;
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONTENT_MISMATCH",
    );
    assert.equal(installs, 0);
    assert.equal(await readFile(`${authorRoot}/package.json`, "utf8"), authorManifest);
    await assert.rejects(access(runnerRoot), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 successor preflight rejects an accepted and current hybrid set", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-phase3-successor-hybrid-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3-next/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticPhase3Predecessor(root, runnerRoot, authorRoot);
    await rm(authorRoot, { recursive: true });
    await materializeFrozenFiles(authorRoot, authorProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(authorRoot, nextSpec, "0.3.0-alpha.1");
    const runnerManifest = await readFile(`${runnerRoot}/package.json`, "utf8");
    const authorManifest = await readFile(`${authorRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        acceptedPhase3PackageEvidence: evidence,
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async () => {
          installs += 1;
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONTENT_MISMATCH",
    );
    assert.equal(installs, 0);
    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), runnerManifest);
    assert.equal(await readFile(`${authorRoot}/package.json`, "utf8"), authorManifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 successor preflight rejects tampered accepted Phase 3A package bytes", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-phase3-successor-tamper-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3-next/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticPhase3Predecessor(root, runnerRoot, authorRoot);
    await mkdir(`${runnerRoot}/node_modules/dsh-eval-lab/dist`, { mode: 0o700 });
    await writeFile(
      `${runnerRoot}/node_modules/dsh-eval-lab/dist/tampered.js`,
      "export const tampered = true;\n",
      "utf8",
    );
    const input = {
      runnerRoot,
      authorRoot,
      packageSpec: nextSpec,
      packageVersion: "0.3.0-alpha.1",
      acceptedPhase3PackageEvidence: evidence,
      verifyPackageContent: acceptSyntheticPackageContent,
      install: async () => {
        installs += 1;
      },
    };

    await assert.rejects(
      installPhase3ProfilesAtomically(input),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_INSTALL_MISMATCH",
    );
    assert.equal(installs, 0);
    assert.equal(
      await readFile(`${runnerRoot}/node_modules/dsh-eval-lab/dist/tampered.js`, "utf8"),
      "export const tampered = true;\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 successor preflight rejects split runner and author predecessor specs", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-phase3-successor-split-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3-next/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence, packageSpec } = await prepareSyntheticPhase3Predecessor(
      root,
      runnerRoot,
      authorRoot,
    );
    const copiedTarball = `${root}/accepted-phase3a-copy.tgz`;
    const copiedSpec = pathToFileURL(copiedTarball).href;
    await copyFile(`${root}/accepted-phase3a.tgz`, copiedTarball);
    await rm(authorRoot, { recursive: true });
    await materializeFrozenFiles(authorRoot, authorProfileFiles(copiedSpec));
    await writeSyntheticInstalledProfile(authorRoot, copiedSpec, "0.3.0-alpha.1");
    const input = {
      runnerRoot,
      authorRoot,
      packageSpec: nextSpec,
      packageVersion: "0.3.0-alpha.1",
      acceptedPhase3PackageEvidence: evidence,
      verifyPackageContent: acceptSyntheticPackageContent,
      install: async () => {
        installs += 1;
      },
    };

    await assert.rejects(
      installPhase3ProfilesAtomically(input),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONTENT_MISMATCH",
    );
    assert.equal(installs, 0);
    assert.equal(
      JSON.parse(await readFile(`${runnerRoot}/package.json`, "utf8")).dependencies["dsh-eval-lab"],
      packageSpec,
    );
    assert.equal(
      JSON.parse(await readFile(`${authorRoot}/package.json`, "utf8")).dependencies["dsh-eval-lab"],
      copiedSpec,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile preflight preserves an unowned empty author root", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-unowned-empty-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(runnerRoot, nextSpec, "0.3.0-alpha.1");
    await mkdir(authorRoot, { mode: 0o700 });
    const ownerInode = (await lstat(authorRoot)).ino;

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
    assert.equal((await lstat(authorRoot)).ino, ownerInode);
    assert.deepEqual(await readdir(authorRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile preflight preserves an unowned author root with unknown bytes", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-unowned-unknown-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(runnerRoot, nextSpec, "0.3.0-alpha.1");
    await mkdir(authorRoot, { mode: 0o700 });
    await writeFile(`${authorRoot}/concurrent-owner`, "preserve-me\n", "utf8");

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
    assert.equal(await readFile(`${authorRoot}/concurrent-owner`, "utf8"), "preserve-me\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile preflight rejects a tokenless author partial", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-unowned-partial-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(runnerRoot, nextSpec, "0.3.0-alpha.1");
    await materializeFrozenFiles(
      authorRoot,
      new Map([...authorProfileFiles(nextSpec)].filter(([name]) => name !== "package.json")),
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
        error instanceof ProfileContractError && error.code === "PROFILE_CONTENT_MISMATCH",
    );

    assert.equal(installs, 0);
    assert.equal(
      await readFile(`${authorRoot}/cordis.patch.yml`, "utf8"),
      authorProfileFiles(nextSpec).get("cordis.patch.yml"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile recovery rejects unknown bytes beside a valid ownership marker", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-owned-unknown-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(runnerRoot, nextSpec, "0.3.0-alpha.1");
    await mkdir(authorRoot, { mode: 0o700 });
    await writeFile(
      `${authorRoot}/.dsh-eval-profile-transaction`,
      phase3ProfileClaimMarker(
        "author",
        authorRoot,
        nextSpec,
        "0.3.0-alpha.1",
        "00000000-0000-4000-8000-000000000002",
      ),
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(`${authorRoot}/concurrent-owner`, "preserve-me\n", "utf8");

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
        error instanceof ProfileContractError && error.code === "PROFILE_TRANSACTION_INVALID",
    );

    assert.equal(installs, 0);
    assert.equal(await readFile(`${authorRoot}/concurrent-owner`, "utf8"), "preserve-me\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile recovery rejects a marker bound to another profile", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-wrong-owner-marker-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(runnerRoot, nextSpec, "0.3.0-alpha.1");
    await mkdir(authorRoot, { mode: 0o700 });
    await writeFile(
      `${authorRoot}/.dsh-eval-profile-transaction`,
      phase3ProfileClaimMarker(
        "author",
        `${root}/another-author-profile`,
        nextSpec,
        "0.3.0-alpha.1",
        "00000000-0000-4000-8000-000000000003",
      ),
      { encoding: "utf8", mode: 0o600 },
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
        error instanceof ProfileContractError && error.code === "PROFILE_TRANSACTION_INVALID",
    );

    assert.equal(installs, 0);
    assert.match(
      await readFile(`${authorRoot}/.dsh-eval-profile-transaction`, "utf8"),
      /another-author-profile/,
    );
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
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    const previousPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
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
    assert.deepEqual((await readdir(root)).sort(), ["accepted-phase2.tgz", "eval-clowder-runner"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile upgrade rejects a non-empty author that appears during staging", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-commit-failure-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    const previousPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
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
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONCURRENT_MODIFICATION",
    );

    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), previousPackage);
    assert.equal(await readFile(`${authorRoot}/concurrent-owner`, "utf8"), "preserve\n");
    assert.deepEqual((await readdir(root)).sort(), [
      "accepted-phase2.tgz",
      "eval-clowder-author",
      "eval-clowder-runner",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile upgrade rejects current author drift during runner staging", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-current-cas-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    await materializeFrozenFiles(authorRoot, authorProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(authorRoot, nextSpec, "0.3.0-alpha.1");
    const previousRunnerPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async (profileRoot) => {
          installs += 1;
          await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
          await writeFile(`${authorRoot}/cordis.patch.yml`, "- id: concurrent-drift\n", "utf8");
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONCURRENT_MODIFICATION",
    );

    assert.equal(installs, 1);
    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), previousRunnerPackage);
    assert.equal(
      await readFile(`${authorRoot}/cordis.patch.yml`, "utf8"),
      "- id: concurrent-drift\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile upgrade rejects a missing author that appears during staging", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-missing-cas-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    const previousRunnerPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async (profileRoot) => {
          installs += 1;
          await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
          if (installs === 2) await mkdir(authorRoot, { mode: 0o700 });
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONCURRENT_MODIFICATION",
    );

    assert.equal(installs, 2);
    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), previousRunnerPackage);
    assert.deepEqual(await readdir(authorRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 missing-root claim preserves a concurrent empty author inode", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-claim-cas-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;
  let concurrentInode: number | undefined;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    const previousRunnerPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
        verifyPackageContent: acceptSyntheticPackageContent,
        beforeMissingRootClaim: async (profileRoot) => {
          if (profileRoot !== authorRoot) return;
          await mkdir(authorRoot, { mode: 0o700 });
          concurrentInode = (await lstat(authorRoot)).ino;
        },
        install: async (profileRoot) => {
          installs += 1;
          await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONCURRENT_MODIFICATION",
    );

    assert.equal(installs, 2);
    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), previousRunnerPackage);
    assert.equal((await lstat(authorRoot)).ino, concurrentInode);
    assert.deepEqual(await readdir(authorRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 init replays an owned author claim interrupted before package readiness", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-claim-replay-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;

  try {
    await materializeFrozenFiles(runnerRoot, runnerProfileFiles(nextSpec));
    await writeSyntheticInstalledProfile(runnerRoot, nextSpec, "0.3.0-alpha.1");
    const partialAuthorFiles = new Map(
      [...authorProfileFiles(nextSpec)].filter(([name]) => name !== "package.json"),
    );
    await materializeFrozenFiles(authorRoot, partialAuthorFiles);
    await writeFile(
      `${authorRoot}/.dsh-eval-profile-transaction`,
      phase3ProfileClaimMarker(
        "author",
        authorRoot,
        nextSpec,
        "0.3.0-alpha.1",
        "00000000-0000-4000-8000-000000000001",
      ),
      { encoding: "utf8", mode: 0o600 },
    );

    assert.deepEqual(
      await installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        verifyPackageContent: acceptSyntheticPackageContent,
        install: async (profileRoot) => {
          installs += 1;
          await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
        },
      }),
      [authorRoot],
    );

    assert.equal(installs, 1);
    await verifyFrozenFiles(authorRoot, authorProfileFiles(nextSpec));
    await assert.rejects(access(`${authorRoot}/.dsh-eval-profile-transaction`), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 3 profile upgrade rolls back both switches when final set validation drifts", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/profile-upgrade-final-cas-`);
  const runnerRoot = `${root}/eval-clowder-runner`;
  const authorRoot = `${root}/eval-clowder-author`;
  const nextSpec = "file:/runtime/packages/phase3/dsh-eval-lab-0.3.0-alpha.1.tgz";
  let installs = 0;
  let packageChecks = 0;

  try {
    const { evidence } = await prepareSyntheticLegacyProfile(root, runnerRoot);
    const previousRunnerPackage = await readFile(`${runnerRoot}/package.json`, "utf8");

    await assert.rejects(
      installPhase3ProfilesAtomically({
        runnerRoot,
        authorRoot,
        packageSpec: nextSpec,
        packageVersion: "0.3.0-alpha.1",
        legacyPackageEvidence: evidence,
        verifyPackageContent: async () => {
          packageChecks += 1;
          if (packageChecks === 3) {
            await writeFile(`${authorRoot}/cordis.patch.yml`, "- id: final-drift\n", "utf8");
          }
        },
        install: async (profileRoot) => {
          installs += 1;
          await writeSyntheticInstalledProfile(profileRoot, nextSpec, "0.3.0-alpha.1");
        },
      }),
      (error: unknown) =>
        error instanceof ProfileContractError && error.code === "PROFILE_CONCURRENT_MODIFICATION",
    );

    assert.equal(installs, 2);
    assert.equal(packageChecks, 3);
    assert.equal(await readFile(`${runnerRoot}/package.json`, "utf8"), previousRunnerPackage);
    await assert.rejects(access(authorRoot), { code: "ENOENT" });
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
