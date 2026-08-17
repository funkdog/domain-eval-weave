import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const SOURCE_ROOT = "/Users/slipshod/AIBuild/dsh-eval-lab";
export const DEFAULT_RUNTIME_ROOT = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
export const OAUTH_REFERENCE_ROOT = "/Users/slipshod/AIBuild/dsh-codex-oauth-lab";

export class RuntimeRootInvariantError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeRootInvariantError";
    this.code = code;
  }
}

export interface RuntimeRootInvariantInput {
  readonly sourceRoot: string;
  readonly runtimeRoot: string;
  readonly oauthReferenceRoot?: string;
}

function isSameOrNested(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

async function canonicalPath(path: string): Promise<string> {
  const missingSegments: string[] = [];
  let existingAncestor = resolve(path);

  while (true) {
    try {
      const canonicalAncestor = await realpath(existingAncestor);
      return resolve(canonicalAncestor, ...missingSegments);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      missingSegments.unshift(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

export async function assertRuntimeRootInvariant(input: RuntimeRootInvariantInput): Promise<void> {
  const referenceRoot = input.oauthReferenceRoot ?? OAUTH_REFERENCE_ROOT;
  const namedRoots = [
    ["source", input.sourceRoot],
    ["runtime", input.runtimeRoot],
    ["oauth-reference", referenceRoot],
  ] as const;

  for (const [name, path] of namedRoots) {
    if (!isAbsolute(path)) {
      throw new RuntimeRootInvariantError(
        "ROOT_NOT_ABSOLUTE",
        `${name} root must be an absolute path`,
      );
    }
  }

  const runtimeInputPath = resolve(input.runtimeRoot);
  try {
    const runtimeInputStat = await lstat(runtimeInputPath);
    if (runtimeInputStat.isSymbolicLink()) {
      throw new RuntimeRootInvariantError(
        "RUNTIME_ROOT_SYMLINK",
        "runtime root must not be a symlink",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const sourceRoot = await canonicalPath(input.sourceRoot);
  const runtimeRoot = await canonicalPath(runtimeInputPath);
  const oauthReferenceRoot = await canonicalPath(referenceRoot);
  const canonicalRoots = [
    ["source", sourceRoot],
    ["runtime", runtimeRoot],
    ["oauth-reference", oauthReferenceRoot],
  ] as const;

  for (let leftIndex = 0; leftIndex < canonicalRoots.length; leftIndex += 1) {
    const left = canonicalRoots[leftIndex];
    if (left === undefined) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < canonicalRoots.length; rightIndex += 1) {
      const right = canonicalRoots[rightIndex];
      if (right === undefined) continue;
      if (isSameOrNested(left[1], right[1]) || isSameOrNested(right[1], left[1])) {
        throw new RuntimeRootInvariantError(
          "ROOTS_OVERLAP",
          `${left[0]} and ${right[0]} roots must be physically separate`,
        );
      }
    }
  }

  try {
    const runtimeStat = await lstat(runtimeRoot);
    if (runtimeStat.isSymbolicLink() || !runtimeStat.isDirectory()) {
      throw new RuntimeRootInvariantError(
        "RUNTIME_ROOT_NOT_DIRECTORY",
        "runtime root must be a real directory, not a symlink",
      );
    }

    const permissionBits = runtimeStat.mode & 0o777;
    if (permissionBits !== 0o700) {
      throw new RuntimeRootInvariantError(
        "RUNTIME_ROOT_PERMISSIONS",
        "existing runtime root must have mode 0700",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
