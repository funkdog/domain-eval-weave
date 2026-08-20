import { type ChildProcessByStdio, spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../contracts/canonical-json.js";
import { fingerprintPackageClosure, fingerprintPackageContent } from "../fingerprint/deployment.js";
import {
  ACCEPTED_PHASE3A_EVAL_VERSION,
  authorProfileFiles,
  PINNED_DSH_VERSION,
  verifyFrozenFiles,
  verifySharedModelSettings,
} from "../runtime-profile/init.js";
export interface AuthorForwardProductionConfig {
  readonly dshHome: string;
  readonly authorProfileRoot: string;
  readonly dshRuntimeRoot: string;
  readonly nodeExecutable: string;
  readonly nodeVersion: string;
  readonly expectedDshContentSha256: string;
  readonly expectedDshClosureSha256: string;
}

interface RuntimePathIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtime_ms: number;
}

interface RuntimeInspection {
  readonly executable: string;
  readonly dshLauncher: string;
  readonly descriptor: AuthorForwardLaunchCapability["descriptor"];
  readonly identity: {
    readonly node: RuntimePathIdentity;
    readonly author_profile: RuntimePathIdentity;
    readonly author_manifest: RuntimePathIdentity;
    readonly author_package: RuntimePathIdentity;
    readonly author_package_manifest: RuntimePathIdentity;
    readonly author_package_content_sha256: string;
    readonly dsh_runtime: RuntimePathIdentity;
    readonly dsh_package: RuntimePathIdentity;
    readonly dsh_manifest: RuntimePathIdentity;
    readonly dsh_launcher: RuntimePathIdentity;
    readonly dsh_package_content_sha256: string;
    readonly dsh_package_closure_sha256: string;
  };
}

export interface AuthorForwardLaunchCapability {
  readonly descriptor: {
    readonly node_version: string;
    readonly package_version: string;
    readonly package_content_sha256: string;
    readonly package_closure_sha256: string;
  };
  readonly launch: (input: {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
  }) => Promise<ChildProcessByStdio<null, Readable, Readable>>;
  readonly assertUnchanged: () => Promise<void>;
}

async function physicalDirectory(path: string, label: string, mode?: number): Promise<string> {
  const absolute = resolve(path);
  const entry = await lstat(absolute);
  if (
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    (mode !== undefined && (entry.mode & 0o777) !== mode) ||
    (await realpath(absolute)) !== absolute
  ) {
    throw new Error(`${label} must be a physical directory`);
  }
  return absolute;
}

async function physicalFile(path: string, label: string): Promise<string> {
  const absolute = resolve(path);
  const entry = await lstat(absolute);
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.nlink !== 1 ||
    (await realpath(absolute)) !== absolute
  ) {
    throw new Error(`${label} must be a physical regular file with no hard links`);
  }
  return absolute;
}

async function runtimePathIdentity(
  path: string,
  label: string,
  kind: "directory" | "file",
): Promise<RuntimePathIdentity> {
  const absolute =
    kind === "directory" ? await physicalDirectory(path, label) : await physicalFile(path, label);
  const entry = await lstat(absolute);
  return {
    path: absolute,
    dev: entry.dev,
    ino: entry.ino,
    size: entry.size,
    mtime_ms: entry.mtimeMs,
  };
}

async function readJsonFile(path: string, label: string): Promise<Record<string, unknown>> {
  const source = await readFile(await physicalFile(path, label), "utf8");
  const value = JSON.parse(source) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function exactLocalPackagePath(spec: string): string {
  let url: URL;
  try {
    url = new URL(spec);
  } catch {
    throw new Error("author profile package spec must be an exact local file URL");
  }
  if (
    url.protocol !== "file:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("author profile package spec must be an exact local file URL");
  }
  return resolve(fileURLToPath(url));
}

async function verifyLiveAuthorPackage(
  input: {
    readonly packageTarPath: string;
    readonly packageContentSha256: string;
    readonly packageVersion: string;
  },
  config: AuthorForwardProductionConfig,
): Promise<{
  readonly authorRoot: string;
  readonly profileManifestPath: string;
  readonly installedRoot: string;
  readonly installedManifestPath: string;
  readonly installedContentSha256: string;
}> {
  if (input.packageVersion !== ACCEPTED_PHASE3A_EVAL_VERSION) {
    throw new Error("reviewed package version does not match the frozen Phase 3A release");
  }
  const authorRoot = await physicalDirectory(
    config.authorProfileRoot,
    "live author profile",
    0o700,
  );
  const profileManifestPath = `${authorRoot}/package.json`;
  const profileManifest = await readJsonFile(profileManifestPath, "author profile manifest");
  const dependencies = profileManifest.dependencies;
  if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) {
    throw new Error("author profile manifest is missing dependencies");
  }
  const packageSpec = (dependencies as Record<string, unknown>)["dsh-eval-lab"];
  if (
    typeof packageSpec !== "string" ||
    exactLocalPackagePath(packageSpec) !== resolve(input.packageTarPath)
  ) {
    throw new Error("live author profile does not bind the reviewed package tar");
  }
  await verifyFrozenFiles(authorRoot, authorProfileFiles(packageSpec));
  const installedRoot = await physicalDirectory(
    `${authorRoot}/node_modules/dsh-eval-lab`,
    "installed author package",
  );
  const installedManifestPath = `${installedRoot}/package.json`;
  const installedManifest = await readJsonFile(
    installedManifestPath,
    "installed author package manifest",
  );
  const installedContentSha256 = await fingerprintPackageContent(installedRoot);
  if (
    installedManifest.name !== "dsh-eval-lab" ||
    installedManifest.version !== input.packageVersion ||
    installedContentSha256 !== input.packageContentSha256
  ) {
    throw new Error("live author profile package bytes do not match the reviewed tar");
  }
  return {
    authorRoot,
    profileManifestPath,
    installedRoot,
    installedManifestPath,
    installedContentSha256,
  };
}

async function inspectAuthorForwardProductionRuntime(
  input: {
    readonly packageTarPath: string;
    readonly packageContentSha256: string;
    readonly packageVersion: string;
  },
  config: AuthorForwardProductionConfig,
): Promise<RuntimeInspection> {
  await verifySharedModelSettings(config.dshHome);
  const author = await verifyLiveAuthorPackage(input, config);
  if (!/^v24\./.test(config.nodeVersion)) {
    throw new Error("Phase 3A forward carrier requires Node 24");
  }
  const executable = await physicalFile(config.nodeExecutable, "Node executable");
  const dshRuntimeRoot = await physicalDirectory(
    config.dshRuntimeRoot,
    "managed DSH runtime",
    0o700,
  );
  const dshPackageRoot = await physicalDirectory(
    `${dshRuntimeRoot}/node_modules/@deepseek-ai/dsh`,
    "managed DSH package",
  );
  const dshLauncher = `${dshPackageRoot}/lib/bin.js`;
  const dshManifestPath = `${dshPackageRoot}/package.json`;
  const dshManifest = await readJsonFile(dshManifestPath, "managed DSH manifest");
  const bin = dshManifest.bin;
  if (
    dshManifest.name !== "@deepseek-ai/dsh" ||
    dshManifest.version !== PINNED_DSH_VERSION ||
    typeof bin !== "object" ||
    bin === null ||
    Array.isArray(bin) ||
    (bin as Record<string, unknown>).dsh !== "lib/bin.js"
  ) {
    throw new Error("managed DSH package identity does not match the frozen launcher");
  }
  await physicalFile(dshLauncher, "managed DSH launcher");
  const [packageContentSha256, packageClosureSha256] = await Promise.all([
    fingerprintPackageContent(dshPackageRoot),
    fingerprintPackageClosure(dshPackageRoot),
  ]);
  if (
    packageContentSha256 !== config.expectedDshContentSha256 ||
    packageClosureSha256 !== config.expectedDshClosureSha256
  ) {
    throw new Error("managed DSH package closure does not match the frozen rc.6 launcher");
  }
  return {
    executable,
    dshLauncher,
    descriptor: {
      node_version: config.nodeVersion,
      package_version: PINNED_DSH_VERSION,
      package_content_sha256: packageContentSha256,
      package_closure_sha256: packageClosureSha256,
    },
    identity: {
      node: await runtimePathIdentity(executable, "Node executable", "file"),
      author_profile: await runtimePathIdentity(
        author.authorRoot,
        "live author profile",
        "directory",
      ),
      author_manifest: await runtimePathIdentity(
        author.profileManifestPath,
        "author profile manifest",
        "file",
      ),
      author_package: await runtimePathIdentity(
        author.installedRoot,
        "installed author package",
        "directory",
      ),
      author_package_manifest: await runtimePathIdentity(
        author.installedManifestPath,
        "installed author package manifest",
        "file",
      ),
      author_package_content_sha256: author.installedContentSha256,
      dsh_runtime: await runtimePathIdentity(dshRuntimeRoot, "managed DSH runtime", "directory"),
      dsh_package: await runtimePathIdentity(dshPackageRoot, "managed DSH package", "directory"),
      dsh_manifest: await runtimePathIdentity(dshManifestPath, "managed DSH manifest", "file"),
      dsh_launcher: await runtimePathIdentity(dshLauncher, "managed DSH launcher", "file"),
      dsh_package_content_sha256: packageContentSha256,
      dsh_package_closure_sha256: packageClosureSha256,
    },
  };
}

export async function verifyAuthorForwardProductionRuntime(
  input: {
    readonly packageTarPath: string;
    readonly packageContentSha256: string;
    readonly packageVersion: string;
  },
  config: AuthorForwardProductionConfig,
): Promise<AuthorForwardLaunchCapability> {
  const frozenInput = { ...input };
  const frozenConfig = { ...config };
  const inspected = await inspectAuthorForwardProductionRuntime(frozenInput, frozenConfig);
  const identity = canonicalJson(inspected.identity);
  const assertUnchanged = async (): Promise<void> => {
    let current: RuntimeInspection;
    try {
      current = await inspectAuthorForwardProductionRuntime(frozenInput, frozenConfig);
    } catch (error) {
      throw new Error("production runtime identity changed", { cause: error });
    }
    if (canonicalJson(current.identity) !== identity) {
      throw new Error("production runtime identity changed");
    }
  };
  return {
    descriptor: inspected.descriptor,
    assertUnchanged,
    launch: async (launchInput) => {
      try {
        await assertUnchanged();
      } catch (error) {
        throw new Error("production runtime identity changed before launch", { cause: error });
      }
      return spawn(inspected.executable, [inspected.dshLauncher, ...launchInput.argv], {
        cwd: launchInput.cwd,
        env: launchInput.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
  };
}
