import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const PINNED_DSH_VERSION = "0.1.0-rc.6";
export const PINNED_CODEX_CONNECT_VERSION = "0.1.0-alpha.4.7";

export class ProfileContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProfileContractError";
    this.code = code;
  }
}

export interface ComposedRoleRow {
  readonly id: string;
  readonly disabled?: boolean;
}

export function assertProfileRoles(
  rows: readonly ComposedRoleRow[],
  role: "management" | "runner",
): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const appDisabled = byId.get("dsh-eval-app")?.disabled;
  const bridgeDisabled = byId.get("dsh-eval-bridge")?.disabled;
  const expected =
    role === "management"
      ? { appDisabled: false, bridgeDisabled: true }
      : { appDisabled: true, bridgeDisabled: false };
  if (appDisabled !== expected.appDisabled || bridgeDisabled !== expected.bridgeDisabled) {
    throw new ProfileContractError(
      "PROFILE_ROLE_INVALID",
      `${role} profile has an invalid app/bridge role composition`,
    );
  }
}

function frozenJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function runnerProfileFiles(packageSpec: string): ReadonlyMap<string, string> {
  if (packageSpec.length === 0 || packageSpec.includes("\0")) {
    throw new ProfileContractError("PACKAGE_SPEC_INVALID", "package spec must be non-empty");
  }
  return new Map([
    [
      "package.json",
      frozenJson({
        name: "dsh-profile-eval-runner",
        private: true,
        dependencies: {
          "dsh-codex-connect": PINNED_CODEX_CONNECT_VERSION,
          "dsh-eval-lab": packageSpec,
        },
        dsh: {
          profile: {
            bundles: [
              "@deepseek-ai/dsh-base",
              "@deepseek-ai/dsh-headless",
              "dsh-codex-connect",
              "dsh-eval-lab",
            ],
          },
        },
      }),
    ],
    [
      "pnpm-workspace.yaml",
      [
        "packages:",
        "  - .",
        "",
        "nodeLinker: hoisted",
        "autoInstallPeers: false",
        "minimumReleaseAgeExclude:",
        `  - dsh-codex-connect@${PINNED_CODEX_CONNECT_VERSION}`,
        "",
      ].join("\n"),
    ],
    [
      "cordis.patch.yml",
      [
        "- id: dsh-eval-app",
        "  disabled: true",
        "- id: dsh-eval-bridge",
        "  disabled: false",
        "",
      ].join("\n"),
    ],
  ]);
}

function resolveFrozenPath(root: string, relativePath: string): string {
  if (!isAbsolute(root) || relativePath.length === 0 || relativePath.includes("\0")) {
    throw new ProfileContractError(
      "PROFILE_PATH_INVALID",
      "profile paths must be absolute and safe",
    );
  }
  const candidate = resolve(root, relativePath);
  const relation = relative(resolve(root), candidate);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    throw new ProfileContractError("PROFILE_PATH_INVALID", "profile file escapes its root");
  }
  return candidate;
}

async function assertPhysicalDirectory(path: string): Promise<void> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new ProfileContractError("PROFILE_PATH_INVALID", "profile parent is not a directory");
  }
  if (entry.isSymbolicLink() || !entry.isDirectory() || (await realpath(path)) !== resolve(path)) {
    throw new ProfileContractError(
      "PROFILE_PATH_INVALID",
      "profile paths must remain in physical directories without symlinks",
    );
  }
}

async function ensurePhysicalDirectory(path: string): Promise<void> {
  const missing: string[] = [];
  let current = resolve(path);
  while (true) {
    try {
      await assertPhysicalDirectory(current);
      break;
    } catch (error) {
      if (
        !(error instanceof ProfileContractError) ||
        (await lstat(current).catch((cause: NodeJS.ErrnoException) => cause.code)) !== "ENOENT"
      ) {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
  for (const segment of missing) {
    current = join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await assertPhysicalDirectory(current);
  }
}

async function assertPhysicalFile(path: string): Promise<void> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch {
    throw new ProfileContractError(
      "PROFILE_ENTRY_INVALID",
      "profile entry is not a readable regular file",
    );
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new ProfileContractError(
      "PROFILE_ENTRY_INVALID",
      "profile entry is not a readable regular file",
    );
  }
}

export async function materializeFrozenFiles(
  root: string,
  files: ReadonlyMap<string, string>,
): Promise<readonly string[]> {
  await ensurePhysicalDirectory(root);
  const created: string[] = [];
  for (const [relativePath, expected] of files) {
    const path = resolveFrozenPath(root, relativePath);
    const parent = resolve(path, "..");
    await ensurePhysicalDirectory(parent);
    try {
      await writeFile(path, expected, { flag: "wx", mode: 0o600 });
      created.push(relativePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await assertPhysicalFile(path);
      let actual: string;
      try {
        actual = await readFile(path, "utf8");
      } catch {
        throw new ProfileContractError(
          "PROFILE_ENTRY_INVALID",
          "existing profile entry is not a readable regular file",
        );
      }
      if (actual !== expected) {
        throw new ProfileContractError(
          "PROFILE_CONTENT_MISMATCH",
          `existing profile file does not match the frozen content: ${relativePath}`,
        );
      }
    }
  }
  return created;
}

export async function verifyFrozenFiles(
  root: string,
  files: ReadonlyMap<string, string>,
): Promise<void> {
  await assertPhysicalDirectory(root);
  for (const [relativePath, expected] of files) {
    const path = resolveFrozenPath(root, relativePath);
    await assertPhysicalDirectory(resolve(path, ".."));
    await assertPhysicalFile(path);
    let actual: string;
    try {
      actual = await readFile(path, "utf8");
    } catch {
      throw new ProfileContractError(
        "PROFILE_ENTRY_INVALID",
        `profile file is missing or unreadable: ${relativePath}`,
      );
    }
    if (actual !== expected) {
      throw new ProfileContractError(
        "PROFILE_CONTENT_MISMATCH",
        `profile file does not match the frozen content: ${relativePath}`,
      );
    }
  }
}
