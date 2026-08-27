import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("open-source governance and CI have one explicit license gate", async () => {
  for (const path of [
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "GOVERNANCE.md",
    "docs/support-matrix.md",
  ]) {
    assert.ok((await readFile(`${repositoryRoot}/${path}`, "utf8")).length > 100, path);
  }
  const workflow = await readFile(`${repositoryRoot}/.github/workflows/ci.yml`, "utf8");
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /bubblewrap/);

  const readiness = await execFileAsync(
    process.execPath,
    [`${repositoryRoot}/scripts/open-source-readiness.mjs`],
    { cwd: repositoryRoot },
  );
  const report = JSON.parse(readiness.stdout) as {
    readonly implementation_ready?: unknown;
    readonly developer_preview_ready?: unknown;
    readonly public_alpha_ready?: unknown;
    readonly blockers?: unknown;
  };
  assert.equal(report.implementation_ready, true);
  assert.equal(report.developer_preview_ready, false);
  assert.equal(report.public_alpha_ready, false);
  assert.deepEqual(report.blockers, [
    "LICENSE_UNSELECTED",
    "REMOTE_CI_PENDING",
    "HUMAN_CLEANROOM_PENDING",
  ]);
});
