import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";

import { canonicalJson, sha256Hex } from "../contracts/canonical-json.js";

interface PackageManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: unknown;
}

export interface PackageContentEntry {
  readonly path: string;
  readonly executable: boolean;
  readonly sha256: string;
}

function compareCanonicalText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function fingerprintPackageEntries(entries: readonly PackageContentEntry[]): string {
  const paths = new Set<string>();
  const canonical = entries.map((entry) => {
    if (paths.has(entry.path)) throw new Error("package content contains a duplicate path");
    paths.add(entry.path);
    return {
      path: entry.path,
      executable: entry.executable,
      sha256: entry.sha256,
    };
  });
  canonical.sort((left, right) => compareCanonicalText(left.path, right.path));
  return sha256Hex(canonicalJson(canonical));
}

async function packageManifest(root: string): Promise<{
  readonly name: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}> {
  const decoded = JSON.parse(await readFile(`${root}/package.json`, "utf8")) as PackageManifest;
  if (typeof decoded.name !== "string" || typeof decoded.version !== "string") {
    throw new Error("installed package manifest is missing name or version");
  }
  const names = new Set<string>();
  for (const group of [decoded.dependencies]) {
    if (typeof group !== "object" || group === null || Array.isArray(group)) continue;
    for (const name of Object.keys(group)) names.add(name);
  }
  return { name: decoded.name, version: decoded.version, dependencies: [...names].sort() };
}

export async function findPackageRoot(start: string, expectedName: string): Promise<string> {
  let current = await realpath(resolve(start));
  if (!(await lstat(current)).isDirectory()) current = dirname(current);
  while (true) {
    try {
      const manifest = await packageManifest(current);
      if (manifest.name === expectedName) return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`could not locate installed package ${expectedName}`);
    current = parent;
  }
}

export async function fingerprintPackageContent(root: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const files: PackageContentEntry[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      if (name === "node_modules") continue;
      const path = resolve(directory, name);
      const stat = await lstat(path);
      if (
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && !stat.isFile()) ||
        (stat.isFile() && stat.nlink !== 1)
      ) {
        throw new Error("installed package content contains an unsupported entry");
      }
      if (stat.isDirectory()) {
        await visit(path);
        continue;
      }
      files.push({
        path: relative(canonicalRoot, path),
        executable: (stat.mode & 0o111) !== 0,
        sha256: sha256Hex(await readFile(path)),
      });
    }
  };
  await visit(canonicalRoot);
  return fingerprintPackageEntries(files);
}

export async function fingerprintPackageClosure(root: string): Promise<string> {
  const pending = [await realpath(root)];
  const seen = new Set<string>();
  const packages: Array<{
    readonly name: string;
    readonly version: string;
    readonly content: string;
  }> = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const manifest = await packageManifest(current);
    packages.push({
      name: manifest.name,
      version: manifest.version,
      content: await fingerprintPackageContent(current),
    });
    const packageRequire = createRequire(`${current}/package.json`);
    for (const dependency of manifest.dependencies) {
      try {
        let dependencyRoot: string | undefined;
        for (const searchRoot of packageRequire.resolve.paths(dependency) ?? []) {
          try {
            const candidate = await realpath(resolve(searchRoot, dependency));
            if ((await packageManifest(candidate)).name === dependency) {
              dependencyRoot = candidate;
              break;
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        dependencyRoot ??= await findPackageRoot(packageRequire.resolve(dependency), dependency);
        pending.push(dependencyRoot);
      } catch (error) {
        throw new Error(
          `${manifest.name} dependency ${dependency} is not installed in its closure`,
          { cause: error },
        );
      }
    }
  }
  packages.sort((left, right) =>
    compareCanonicalText(
      `${left.name}@${left.version}:${left.content}`,
      `${right.name}@${right.version}:${right.content}`,
    ),
  );
  return sha256Hex(canonicalJson(packages));
}

export interface EvalDeploymentFingerprintInput {
  readonly control: string;
  readonly treatment: string;
  readonly task_pack: string;
  readonly model: {
    readonly provider: "openai-codex";
    readonly model: "gpt-5.6-sol";
    readonly effort: "xhigh";
  };
  readonly dsh_package_tree: string;
  readonly codex_connect_package: string;
  readonly eval_package: string;
  readonly common_patch: string;
}

export function fingerprintEvalDeployment(input: EvalDeploymentFingerprintInput): string {
  return sha256Hex(canonicalJson(input));
}
