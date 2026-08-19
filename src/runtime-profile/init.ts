import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { parse } from "yaml";

import { PHASE3A_AUTHOR } from "../instance.js";

export const PINNED_DSH_VERSION = "0.1.0-rc.6";
export const PINNED_CODEX_CONNECT_VERSION = "0.1.0-alpha.4.7";
export const LEGACY_PHASE2_EVAL_VERSION = "0.2.0-rc.4";

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
  readonly config?: unknown;
}

export function assertProfileRoles(
  rows: readonly ComposedRoleRow[],
  role: "management" | "runner",
): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const appDisabled = byId.get("dsh-eval-app")?.disabled;
  const bridgeDisabled = byId.get("dsh-eval-bridge")?.disabled;
  const authorBridgeDisabled = byId.get("dsh-eval-author-bridge")?.disabled;
  const expected =
    role === "management"
      ? { appDisabled: false, bridgeDisabled: true }
      : { appDisabled: true, bridgeDisabled: false };
  if (
    appDisabled !== expected.appDisabled ||
    bridgeDisabled !== expected.bridgeDisabled ||
    authorBridgeDisabled !== true
  ) {
    throw new ProfileContractError(
      "PROFILE_ROLE_INVALID",
      `${role} profile has an invalid app/bridge role composition`,
    );
  }
}

export function assertAuthorProfileRoles(rows: readonly ComposedRoleRow[]): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const required = new Map<string, boolean>([
    ["dsh-eval-app", true],
    ["dsh-eval-bridge", true],
    ["dsh-eval-author-bridge", false],
    ["dsh-eval-domain-skill", false],
    ["tool-bash", true],
    ["tool-pwsh", true],
    ["tool-jobs", true],
    ["tool-skill", false],
    ["tool-str-replace-editor", false],
    ["tool-web", true],
    ["tool-subagent-control", true],
    ["tool-subagent-list-agents", true],
    ["tool-subagent", true],
    ["tool-subagent-fork", true],
    ["tool-subagent-report", true],
    ["tool-workflow", true],
    ["tool-ralph", true],
  ]);
  for (const [id, disabled] of required) {
    if (byId.get(id)?.disabled !== disabled) {
      throw new ProfileContractError(
        "PROFILE_ROLE_INVALID",
        `author profile has an invalid ${id} role composition`,
      );
    }
  }
  const session = byId.get("session-persistence-jsonl")?.config;
  if (
    typeof session !== "object" ||
    session === null ||
    Array.isArray(session) ||
    (session as Record<string, unknown>).root !== PHASE3A_AUTHOR.sessionsRoot ||
    (session as Record<string, unknown>).compression !== "none" ||
    (session as Record<string, unknown>).packChunks !== false
  ) {
    throw new ProfileContractError(
      "PROFILE_ROLE_INVALID",
      "author profile has an invalid Session persistence boundary",
    );
  }
}

function frozenJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertPackageSpec(packageSpec: string): void {
  if (packageSpec.length === 0 || packageSpec.includes("\0")) {
    throw new ProfileContractError("PACKAGE_SPEC_INVALID", "package spec must be non-empty");
  }
}

export function runnerProfileFiles(packageSpec: string): ReadonlyMap<string, string> {
  assertPackageSpec(packageSpec);
  return new Map([
    [
      "package.json",
      frozenJson({
        name: "dsh-profile-eval-clowder-runner",
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
        "- id: dsh-eval-author-bridge",
        "  disabled: true",
        "",
      ].join("\n"),
    ],
  ]);
}

export function legacyPhase2RunnerProfileFiles(packageSpec: string): ReadonlyMap<string, string> {
  assertPackageSpec(packageSpec);
  return new Map([
    [
      "package.json",
      frozenJson({
        name: "dsh-profile-eval-clowder-runner",
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

export function authorProfileFiles(packageSpec: string): ReadonlyMap<string, string> {
  assertPackageSpec(packageSpec);
  return new Map([
    [
      "package.json",
      frozenJson({
        name: "dsh-profile-eval-clowder-author",
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
        "  disabled: true",
        "- id: dsh-eval-author-bridge",
        "  disabled: false",
        "- id: dsh-eval-domain-skill",
        "  disabled: false",
        "- id: session-persistence-jsonl",
        "  config:",
        `    root: ${PHASE3A_AUTHOR.sessionsRoot}`,
        "    compression: none",
        "    packChunks: false",
        "- id: tool-bash",
        "  disabled: true",
        "- id: tool-pwsh",
        "  disabled: true",
        "- id: tool-jobs",
        "  disabled: true",
        "- id: tool-web",
        "  disabled: true",
        "- id: tool-subagent-control",
        "  disabled: true",
        "- id: tool-subagent-list-agents",
        "  disabled: true",
        "- id: tool-subagent",
        "  disabled: true",
        "- id: tool-subagent-fork",
        "  disabled: true",
        "- id: tool-subagent-report",
        "  disabled: true",
        "- id: tool-workflow",
        "  disabled: true",
        "- id: tool-ralph",
        "  disabled: true",
        "- id: tool-skill",
        "  disabled: false",
        "- id: tool-str-replace-editor",
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

function mapping(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Validate only the shared transport route this Lab depends on. The settings
 * file is owned by the shared DSH control plane, so unrelated keys and bytes
 * must remain untouched for another evaluation implementation to coexist.
 */
export async function verifySharedModelSettings(dshHome: string): Promise<void> {
  await assertPhysicalDirectory(dshHome);
  const path = resolveFrozenPath(dshHome, "settings.yaml");
  await assertPhysicalFile(path);
  let parsed: unknown;
  try {
    parsed = parse(await readFile(path, "utf8"));
  } catch {
    throw new ProfileContractError(
      "MODEL_ROUTE_INVALID",
      "shared settings.yaml must be readable YAML",
    );
  }
  const route = mapping(mapping(parsed)?.["agent-default-model"]);
  if (
    route?.provider !== "openai-codex" ||
    route.model !== "gpt-5.6-sol" ||
    route.reasoningEffort !== "xhigh"
  ) {
    throw new ProfileContractError(
      "MODEL_ROUTE_INVALID",
      "shared settings.yaml does not provide the required Phase 2 model route",
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

type ProfileInstallState = "ready" | "missing";

interface Phase3ProfileTarget {
  readonly root: string;
  readonly files: ReadonlyMap<string, string>;
  readonly role: "runner" | "author";
}

export interface Phase3ProfileInstallInput {
  readonly runnerRoot: string;
  readonly authorRoot: string;
  readonly packageSpec: string;
  readonly packageVersion: string;
  readonly install: (profileRoot: string) => Promise<void>;
  readonly verifyPackageContent: (installedPackageRoot: string) => Promise<void>;
}

interface PreparedProfileTarget extends Phase3ProfileTarget {
  readonly stage: string;
  readonly existed: boolean;
  backup?: string;
}

async function lstatOrUndefined(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readManagedFiles(
  root: string,
  files: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string | undefined>> {
  const actual = new Map<string, string | undefined>();
  for (const relativePath of files.keys()) {
    const path = resolveFrozenPath(root, relativePath);
    const entry = await lstatOrUndefined(path);
    if (entry === undefined) {
      actual.set(relativePath, undefined);
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new ProfileContractError(
        "PROFILE_ENTRY_INVALID",
        `existing profile entry is not a readable regular file: ${relativePath}`,
      );
    }
    actual.set(relativePath, await readFile(path, "utf8"));
  }
  return actual;
}

function frozenFilesMatch(
  actual: ReadonlyMap<string, string | undefined>,
  expected: ReadonlyMap<string, string>,
): boolean {
  return [...expected].every(([relativePath, content]) => actual.get(relativePath) === content);
}

function frozenFilesAreCompatiblePartial(
  actual: ReadonlyMap<string, string | undefined>,
  expected: ReadonlyMap<string, string>,
): boolean {
  return [...expected].every(([relativePath, content]) => {
    const value = actual.get(relativePath);
    return value === undefined || value === content;
  });
}

function profilePackageSpec(packageJson: string | undefined): string | undefined {
  if (packageJson === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(packageJson);
  } catch {
    return undefined;
  }
  const spec = mapping(mapping(manifest)?.dependencies)?.["dsh-eval-lab"];
  return typeof spec === "string" && spec.length > 0 && !spec.includes("\0") ? spec : undefined;
}

async function profileInstallState(
  root: string,
  packageSpec: string,
  packageVersion: string,
  verifyPackageContent?: (installedPackageRoot: string) => Promise<void>,
): Promise<ProfileInstallState> {
  const lockPath = resolveFrozenPath(root, "pnpm-lock.yaml");
  const modulesPath = resolveFrozenPath(root, "node_modules");
  const evalPackagePath = resolveFrozenPath(root, "node_modules/dsh-eval-lab");
  const codexPackagePath = resolveFrozenPath(root, "node_modules/dsh-codex-connect");
  const evalManifestPath = resolveFrozenPath(root, "node_modules/dsh-eval-lab/package.json");
  const codexManifestPath = resolveFrozenPath(root, "node_modules/dsh-codex-connect/package.json");
  const entries = await Promise.all([
    lstatOrUndefined(lockPath),
    lstatOrUndefined(modulesPath),
    lstatOrUndefined(evalPackagePath),
    lstatOrUndefined(codexPackagePath),
    lstatOrUndefined(evalManifestPath),
    lstatOrUndefined(codexManifestPath),
  ]);
  if (entries.some((entry) => entry === undefined)) return "missing";
  const [lockEntry, modulesEntry, evalPackageEntry, codexPackageEntry, evalEntry, codexEntry] =
    entries;
  if (
    lockEntry?.isSymbolicLink() ||
    !lockEntry?.isFile() ||
    modulesEntry?.isSymbolicLink() ||
    !modulesEntry?.isDirectory() ||
    (await realpath(modulesPath)) !== resolve(modulesPath) ||
    evalPackageEntry?.isSymbolicLink() ||
    !evalPackageEntry?.isDirectory() ||
    (await realpath(evalPackagePath)) !== resolve(evalPackagePath) ||
    codexPackageEntry?.isSymbolicLink() ||
    !codexPackageEntry?.isDirectory() ||
    (await realpath(codexPackagePath)) !== resolve(codexPackagePath) ||
    evalEntry?.isSymbolicLink() ||
    !evalEntry?.isFile() ||
    codexEntry?.isSymbolicLink() ||
    !codexEntry?.isFile()
  ) {
    throw new ProfileContractError(
      "PROFILE_INSTALL_INVALID",
      "profile lockfile and installed packages must be physical entries",
    );
  }
  let evalManifest: unknown;
  let codexManifest: unknown;
  try {
    evalManifest = JSON.parse(await readFile(evalManifestPath, "utf8"));
    codexManifest = JSON.parse(await readFile(codexManifestPath, "utf8"));
  } catch {
    throw new ProfileContractError(
      "PROFILE_INSTALL_INVALID",
      "installed profile package manifests must be readable JSON",
    );
  }
  let lockfile: unknown;
  try {
    lockfile = parse(await readFile(lockPath, "utf8"));
  } catch {
    throw new ProfileContractError(
      "PROFILE_INSTALL_INVALID",
      "profile lockfile must be readable YAML",
    );
  }
  const dependencies = mapping(mapping(mapping(lockfile)?.importers)?.["."])?.dependencies;
  const dependencyMap = mapping(dependencies);
  if (
    mapping(evalManifest)?.name !== "dsh-eval-lab" ||
    mapping(evalManifest)?.version !== packageVersion ||
    mapping(codexManifest)?.name !== "dsh-codex-connect" ||
    mapping(codexManifest)?.version !== PINNED_CODEX_CONNECT_VERSION ||
    mapping(dependencyMap?.["dsh-eval-lab"])?.specifier !== packageSpec ||
    mapping(dependencyMap?.["dsh-codex-connect"])?.specifier !== PINNED_CODEX_CONNECT_VERSION
  ) {
    throw new ProfileContractError(
      "PROFILE_INSTALL_MISMATCH",
      "installed profile package versions or lockfile do not match the frozen profile",
    );
  }
  if (verifyPackageContent !== undefined) {
    try {
      await verifyPackageContent(evalPackagePath);
    } catch {
      throw new ProfileContractError(
        "PROFILE_INSTALL_MISMATCH",
        "installed Eval Lab package bytes do not match the management package",
      );
    }
  }
  return "ready";
}

async function inspectPhase3ProfileTarget(
  target: Phase3ProfileTarget,
  packageSpec: string,
  packageVersion: string,
  verifyPackageContent: (installedPackageRoot: string) => Promise<void>,
): Promise<"current" | "replace"> {
  if (!isAbsolute(target.root) || resolve(target.root) !== target.root) {
    throw new ProfileContractError("PROFILE_PATH_INVALID", "profile root must be absolute");
  }
  await assertPhysicalDirectory(dirname(target.root));
  const rootEntry = await lstatOrUndefined(target.root);
  if (rootEntry === undefined) return "replace";
  await assertPhysicalDirectory(target.root);
  const actual = await readManagedFiles(target.root, target.files);
  if (frozenFilesMatch(actual, target.files)) {
    return (await profileInstallState(
      target.root,
      packageSpec,
      packageVersion,
      verifyPackageContent,
    )) === "ready"
      ? "current"
      : "replace";
  }
  if (frozenFilesAreCompatiblePartial(actual, target.files)) return "replace";
  if (target.role === "runner") {
    const previousSpec = profilePackageSpec(actual.get("package.json"));
    if (previousSpec !== undefined) {
      const previous = legacyPhase2RunnerProfileFiles(previousSpec);
      if (frozenFilesMatch(actual, previous)) {
        if (
          (await profileInstallState(target.root, previousSpec, LEGACY_PHASE2_EVAL_VERSION)) !==
          "ready"
        ) {
          throw new ProfileContractError(
            "PROFILE_INSTALL_MISMATCH",
            "legacy Phase 2 runner is not a complete installed profile",
          );
        }
        return "replace";
      }
    }
  }
  throw new ProfileContractError(
    "PROFILE_CONTENT_MISMATCH",
    `existing ${target.role} profile is neither the frozen target nor the accepted Phase 2 predecessor`,
  );
}

async function preserveCordisRoot(sourceRoot: string, stageRoot: string): Promise<void> {
  const source = resolveFrozenPath(sourceRoot, "cordis.yml");
  const entry = await lstatOrUndefined(source);
  if (entry === undefined) return;
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new ProfileContractError(
      "PROFILE_ENTRY_INVALID",
      "existing cordis.yml is not a physical regular file",
    );
  }
  await writeFile(resolveFrozenPath(stageRoot, "cordis.yml"), await readFile(source), {
    flag: "wx",
    mode: 0o600,
  });
}

async function prepareProfileTarget(
  target: Phase3ProfileTarget,
  packageSpec: string,
  packageVersion: string,
  install: (profileRoot: string) => Promise<void>,
  verifyPackageContent: (installedPackageRoot: string) => Promise<void>,
): Promise<PreparedProfileTarget> {
  const existed = (await lstatOrUndefined(target.root)) !== undefined;
  const stage = await mkdtemp(join(dirname(target.root), `.${basename(target.root)}.upgrade-`));
  try {
    await materializeFrozenFiles(stage, target.files);
    if (existed) await preserveCordisRoot(target.root, stage);
    await install(stage);
    await verifyFrozenFiles(stage, target.files);
    if (
      (await profileInstallState(stage, packageSpec, packageVersion, verifyPackageContent)) !==
      "ready"
    ) {
      throw new ProfileContractError(
        "PROFILE_INSTALL_INVALID",
        "staged profile install did not produce a complete package closure",
      );
    }
    return { ...target, stage, existed };
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function rollbackCommittedProfiles(
  committed: readonly PreparedProfileTarget[],
): Promise<void> {
  let rollbackFailure: unknown;
  for (const target of [...committed].reverse()) {
    try {
      await rename(target.root, target.stage);
      if (target.backup !== undefined) await rename(target.backup, target.root);
      await rm(target.stage, { recursive: true, force: true });
    } catch (error) {
      rollbackFailure ??= error;
    }
  }
  if (rollbackFailure !== undefined) {
    throw new ProfileContractError(
      "PROFILE_TRANSACTION_ROLLBACK_FAILED",
      "profile transaction failed and could not restore every live profile",
    );
  }
}

/**
 * Reconcile the runner and author as one staged profile set. Existing Phase 2
 * runner bytes remain live until both replacement installs have passed their
 * frozen-file, lockfile, and package-version checks.
 */
export async function installPhase3ProfilesAtomically(
  input: Phase3ProfileInstallInput,
): Promise<readonly string[]> {
  assertPackageSpec(input.packageSpec);
  if (input.packageVersion.length === 0 || input.packageVersion.includes("\0")) {
    throw new ProfileContractError("PACKAGE_SPEC_INVALID", "package version must be non-empty");
  }
  if (input.runnerRoot === input.authorRoot) {
    throw new ProfileContractError("PROFILE_PATH_INVALID", "runner and author roots must differ");
  }
  const targets: readonly Phase3ProfileTarget[] = [
    { root: input.runnerRoot, files: runnerProfileFiles(input.packageSpec), role: "runner" },
    { root: input.authorRoot, files: authorProfileFiles(input.packageSpec), role: "author" },
  ];
  const states: Array<"current" | "replace"> = [];
  for (const target of targets) {
    states.push(
      await inspectPhase3ProfileTarget(
        target,
        input.packageSpec,
        input.packageVersion,
        input.verifyPackageContent,
      ),
    );
  }
  const replacements = targets.filter((_, index) => states[index] === "replace");
  if (replacements.length === 0) return [];

  const prepared: PreparedProfileTarget[] = [];
  try {
    for (const target of replacements) {
      prepared.push(
        await prepareProfileTarget(
          target,
          input.packageSpec,
          input.packageVersion,
          input.install,
          input.verifyPackageContent,
        ),
      );
    }

    const committed: PreparedProfileTarget[] = [];
    try {
      for (const target of prepared) {
        if (target.existed) {
          target.backup = join(
            dirname(target.root),
            `.${basename(target.root)}.previous-${randomUUID()}`,
          );
          await rename(target.root, target.backup);
        }
        try {
          await rename(target.stage, target.root);
        } catch (error) {
          if (target.backup !== undefined) await rename(target.backup, target.root);
          throw error;
        }
        committed.push(target);
      }
    } catch (error) {
      await rollbackCommittedProfiles(committed);
      throw error;
    }

    for (const target of committed) {
      if (target.backup !== undefined) {
        await rm(target.backup, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    return committed.map((target) => target.root);
  } finally {
    for (const target of prepared) {
      await rm(target.stage, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
