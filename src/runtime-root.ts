import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const DEDICATED_RUNTIME_ROOT = "/Users/slipshod/AIBuild/dsh-eval-lab-runtime";
export const DEDICATED_DSH_HOME = `${DEDICATED_RUNTIME_ROOT}/dsh-home`;
export const OAUTH_REFERENCE_ROOT = "/Users/slipshod/AIBuild/dsh-codex-oauth-lab";

export class RuntimeRootInvariantError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeRootInvariantError";
    this.code = code;
  }
}

export interface RuntimeLayoutInput {
  readonly sourceRoot: string;
  readonly runtimeRoot: string;
  readonly dshHome: string;
  readonly oauthReferenceRoot: string;
}

function isSameOrNested(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

async function canonicalizeMissingPath(path: string): Promise<string> {
  const missing: string[] = [];
  let current = resolve(path);

  while (true) {
    try {
      return join(await realpath(current), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

async function assertSecureDirectory(path: string, label: string): Promise<void> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new RuntimeRootInvariantError(
        "RUNTIME_DIRECTORY_MISSING",
        `${label} must exist before the DSH process boots`,
      );
    }
    throw error;
  }

  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new RuntimeRootInvariantError(
      "RUNTIME_DIRECTORY_INVALID",
      `${label} must be a real directory, not a symlink`,
    );
  }
  if ((entry.mode & 0o777) !== 0o700) {
    throw new RuntimeRootInvariantError(
      "RUNTIME_DIRECTORY_PERMISSIONS",
      `${label} must have mode 0700`,
    );
  }
}

export function assertDedicatedDshHomePreBoot(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const configured = env.DSH_HOME;
  if (configured === undefined || configured.length === 0) {
    throw new RuntimeRootInvariantError(
      "DSH_HOME_REQUIRED",
      "DSH_HOME must be set before the DSH process boots",
    );
  }
  if (configured !== DEDICATED_DSH_HOME) {
    throw new RuntimeRootInvariantError(
      "DSH_HOME_MISMATCH",
      "DSH_HOME does not match the dedicated Eval Lab home",
    );
  }
}

export async function assertRuntimeLayoutInvariant(input: RuntimeLayoutInput): Promise<void> {
  const namedRoots = [
    ["source", input.sourceRoot],
    ["runtime", input.runtimeRoot],
    ["oauth-reference", input.oauthReferenceRoot],
  ] as const;
  for (const [label, path] of [...namedRoots, ["dsh-home", input.dshHome] as const]) {
    if (!isAbsolute(path)) {
      throw new RuntimeRootInvariantError("ROOT_NOT_ABSOLUTE", `${label} root must be absolute`);
    }
  }

  if (resolve(input.dshHome) !== join(resolve(input.runtimeRoot), "dsh-home")) {
    throw new RuntimeRootInvariantError(
      "DSH_HOME_LAYOUT_INVALID",
      "DSH home must be the dedicated runtime root's dsh-home child",
    );
  }

  const canonicalRoots = await Promise.all(
    namedRoots.map(async ([label, path]) => [label, await canonicalizeMissingPath(path)] as const),
  );
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

  await assertSecureDirectory(resolve(input.runtimeRoot), "runtime root");
  await assertSecureDirectory(resolve(input.dshHome), "DSH home");
}
