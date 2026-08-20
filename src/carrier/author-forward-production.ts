import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintPackageClosure, fingerprintPackageContent } from "../fingerprint/deployment.js";
import {
  ACCEPTED_PHASE3A_EVAL_VERSION,
  authorProfileFiles,
  PINNED_DSH_VERSION,
  verifyFrozenFiles,
  verifySharedModelSettings,
} from "../runtime-profile/init.js";
import type { InternalAuthorForwardRuntime } from "./author-forward-internal.js";

export interface AuthorForwardProductionConfig {
  readonly dshHome: string;
  readonly authorProfileRoot: string;
  readonly dshRuntimeRoot: string;
  readonly nodeExecutable: string;
  readonly nodeVersion: string;
  readonly expectedDshContentSha256: string;
  readonly expectedDshClosureSha256: string;
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
): Promise<void> {
  if (input.packageVersion !== ACCEPTED_PHASE3A_EVAL_VERSION) {
    throw new Error("reviewed package version does not match the frozen Phase 3A release");
  }
  const authorRoot = await physicalDirectory(
    config.authorProfileRoot,
    "live author profile",
    0o700,
  );
  const profileManifest = await readJsonFile(
    `${authorRoot}/package.json`,
    "author profile manifest",
  );
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
  const installedManifest = await readJsonFile(
    `${installedRoot}/package.json`,
    "installed author package manifest",
  );
  if (
    installedManifest.name !== "dsh-eval-lab" ||
    installedManifest.version !== input.packageVersion ||
    (await fingerprintPackageContent(installedRoot)) !== input.packageContentSha256
  ) {
    throw new Error("live author profile package bytes do not match the reviewed tar");
  }
}

export async function verifyAuthorForwardProductionRuntime(
  input: {
    readonly packageTarPath: string;
    readonly packageContentSha256: string;
    readonly packageVersion: string;
  },
  config: AuthorForwardProductionConfig,
): Promise<InternalAuthorForwardRuntime> {
  await verifySharedModelSettings(config.dshHome);
  await verifyLiveAuthorPackage(input, config);
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
  const dshManifest = await readJsonFile(`${dshPackageRoot}/package.json`, "managed DSH manifest");
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
    launcherArgs: [dshLauncher],
    descriptor: {
      node_version: config.nodeVersion,
      package_version: PINNED_DSH_VERSION,
      package_content_sha256: packageContentSha256,
      package_closure_sha256: packageClosureSha256,
    },
  };
}
