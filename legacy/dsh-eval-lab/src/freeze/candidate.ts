import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { sha256Hex } from "../contracts/canonical-json.js";

const execFileAsync = promisify(execFile);

export interface FrozenCandidate {
  readonly tree: string;
  readonly treeSha256: string;
  readonly patchPath: string;
  readonly patchSha256: string;
  readonly archivePath: string;
  readonly archiveSha256: string;
  readonly changedPaths: readonly string[];
  readonly unauthorizedPaths: readonly string[];
  readonly forbiddenEntries: readonly string[];
  readonly authorized: boolean;
}

export class CandidateFreezeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CandidateFreezeError";
    this.code = code;
  }
}

function gitEnvironment(indexFile: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    GIT_INDEX_FILE: indexFile,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

async function git(workspace: string, indexFile: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd: workspace,
    env: gitEnvironment(indexFile),
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

function parseRawDiff(raw: string): {
  changedPaths: string[];
  forbiddenEntries: string[];
} {
  const fields = raw.split("\0").filter((field) => field.length > 0);
  const changedPaths: string[] = [];
  const forbiddenEntries: string[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const metadata = fields[index];
    const path = fields[index + 1];
    if (metadata === undefined || path === undefined) {
      throw new CandidateFreezeError("GIT_DIFF_INVALID", "Git returned an incomplete raw diff");
    }
    const parts = metadata.split(" ");
    const newMode = parts[1];
    changedPaths.push(path);
    if (newMode === "120000" || newMode === "160000") forbiddenEntries.push(path);
  }
  return { changedPaths: changedPaths.sort(), forbiddenEntries: forbiddenEntries.sort() };
}

export async function computeCandidateTree(
  workspace: string,
  scratchParent: string,
): Promise<string> {
  const canonicalWorkspace = resolve(workspace);
  const canonicalScratch = resolve(scratchParent);
  await mkdir(canonicalScratch, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(canonicalScratch, ".tree-"));
  const indexFile = join(temporary, "index");
  try {
    await git(canonicalWorkspace, indexFile, ["read-tree", "HEAD"]);
    await git(canonicalWorkspace, indexFile, ["add", "-A"]);
    const tree = (await git(canonicalWorkspace, indexFile, ["write-tree"])).trim();
    if (!/^[0-9a-f]{40}$/.test(tree)) {
      throw new CandidateFreezeError("GIT_TREE_INVALID", "Git returned an invalid candidate tree");
    }
    return tree;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function freezeCandidate(input: {
  readonly workspace: string;
  readonly artifactRoot: string;
}): Promise<FrozenCandidate> {
  const workspace = resolve(input.workspace);
  const artifactRoot = resolve(input.artifactRoot);
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(artifactRoot, ".freeze-"));
  const indexFile = join(temporary, "index");
  const patchPath = join(artifactRoot, "candidate.patch");
  const archivePath = join(artifactRoot, "candidate.tar");
  const treePath = join(artifactRoot, "candidate.tree");

  try {
    await git(workspace, indexFile, ["read-tree", "HEAD"]);
    await git(workspace, indexFile, ["add", "-A"]);
    const tree = (await git(workspace, indexFile, ["write-tree"])).trim();
    if (!/^[0-9a-f]{40}$/.test(tree)) {
      throw new CandidateFreezeError("GIT_TREE_INVALID", "Git returned an invalid candidate tree");
    }
    const raw = await git(workspace, indexFile, [
      "diff",
      "--no-renames",
      "--raw",
      "-z",
      "HEAD",
      tree,
    ]);
    const { changedPaths, forbiddenEntries } = parseRawDiff(raw);
    const unauthorizedPaths = changedPaths.filter(
      (path) => path !== "src" && !path.startsWith("src/"),
    );
    const patch = await git(workspace, indexFile, [
      "diff",
      "--no-renames",
      "--binary",
      "HEAD",
      tree,
    ]);
    await writeFile(patchPath, patch, { flag: "wx", mode: 0o600 });
    await execFileAsync("git", ["archive", "--format=tar", "--output", archivePath, tree], {
      cwd: workspace,
      env: gitEnvironment(indexFile),
    });
    await writeFile(treePath, `${tree}\n`, { flag: "wx", mode: 0o600 });
    const [patchBytes, archiveBytes] = await Promise.all([
      readFile(patchPath),
      readFile(archivePath),
    ]);
    return {
      tree,
      treeSha256: sha256Hex(tree),
      patchPath,
      patchSha256: sha256Hex(patchBytes),
      archivePath,
      archiveSha256: sha256Hex(archiveBytes),
      changedPaths,
      unauthorizedPaths,
      forbiddenEntries,
      authorized: unauthorizedPaths.length === 0 && forbiddenEntries.length === 0,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
