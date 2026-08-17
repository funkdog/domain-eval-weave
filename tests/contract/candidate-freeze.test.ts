import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import { computeCandidateTree, freezeCandidate } from "../../src/freeze/candidate.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const execFileAsync = promisify(execFile);

test("candidate freeze includes tracked and untracked src changes without using the workspace index", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/freeze-m3-`);
  const workspace = `${root}/workspace`;
  const artifacts = `${root}/artifacts`;
  await mkdir(`${workspace}/src`, { recursive: true, mode: 0o700 });
  await writeFile(`${workspace}/README.md`, "base\n", "utf8");
  await writeFile(`${workspace}/src/ledger.ts`, "export const value = 1;\n", "utf8");
  await execFileAsync("git", ["init", "-q"], { cwd: workspace });
  await execFileAsync("git", ["config", "user.email", "fixture@example.invalid"], {
    cwd: workspace,
  });
  await execFileAsync("git", ["config", "user.name", "Fixture"], { cwd: workspace });
  await execFileAsync("git", ["add", "."], { cwd: workspace });
  await execFileAsync("git", ["commit", "-qm", "base"], { cwd: workspace });
  await writeFile(`${workspace}/src/ledger.ts`, "export const value = 2;\n", "utf8");
  await writeFile(`${workspace}/src/new.ts`, "export const added = true;\n", "utf8");

  try {
    const frozen = await freezeCandidate({ workspace, artifactRoot: artifacts });
    assert.equal(frozen.authorized, true);
    assert.match(frozen.tree, /^[0-9a-f]{40}$/);
    assert.deepEqual(frozen.changedPaths, ["src/ledger.ts", "src/new.ts"]);
    assert.equal(
      (await execFileAsync("git", ["diff", "--cached", "--name-only"], { cwd: workspace })).stdout,
      "",
    );
    assert.match(await readFile(frozen.patchPath, "utf8"), /src\/new\.ts/);
    assert.ok((await readFile(frozen.archivePath)).byteLength > 0);
    assert.equal(await computeCandidateTree(workspace, `${root}/tree-checks`), frozen.tree);
    await writeFile(`${workspace}/src/new.ts`, "export const added = false;\n", "utf8");
    assert.notEqual(await computeCandidateTree(workspace, `${root}/tree-checks`), frozen.tree);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate freeze records unauthorized paths instead of hiding them", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/freeze-boundary-`);
  const workspace = `${root}/workspace`;
  await mkdir(`${workspace}/src`, { recursive: true, mode: 0o700 });
  await writeFile(`${workspace}/README.md`, "base\n", "utf8");
  await writeFile(`${workspace}/src/ledger.ts`, "export {};\n", "utf8");
  await execFileAsync("git", ["init", "-q"], { cwd: workspace });
  await execFileAsync("git", ["config", "user.email", "fixture@example.invalid"], {
    cwd: workspace,
  });
  await execFileAsync("git", ["config", "user.name", "Fixture"], { cwd: workspace });
  await execFileAsync("git", ["add", "."], { cwd: workspace });
  await execFileAsync("git", ["commit", "-qm", "base"], { cwd: workspace });
  await writeFile(`${workspace}/README.md`, "changed\n", "utf8");
  try {
    const frozen = await freezeCandidate({ workspace, artifactRoot: `${root}/artifacts` });
    assert.equal(frozen.authorized, false);
    assert.deepEqual(frozen.unauthorizedPaths, ["README.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
