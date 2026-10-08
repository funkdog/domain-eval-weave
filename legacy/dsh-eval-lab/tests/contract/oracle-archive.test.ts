import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import { extractCandidateArchive } from "../../src/oracle/archive.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const execFileAsync = promisify(execFile);

test("Oracle extraction accepts regular candidates and rejects symlink entries", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/oracle-archive-`);
  const source = `${root}/source`;
  await mkdir(`${source}/src`, { recursive: true, mode: 0o700 });
  await writeFile(`${source}/src/ledger.ts`, "export {};\n", "utf8");
  await execFileAsync("/usr/bin/tar", ["-cf", `${root}/safe.tar`, "-C", source, "."]);
  try {
    const extracted = await extractCandidateArchive(`${root}/safe.tar`, `${root}/safe-out`);
    assert.equal(extracted.entries.includes("src/ledger.ts"), true);

    await symlink("/etc/passwd", `${source}/src/escape`);
    await execFileAsync("/usr/bin/tar", ["-cf", `${root}/unsafe.tar`, "-C", source, "."]);
    await assert.rejects(extractCandidateArchive(`${root}/unsafe.tar`, `${root}/unsafe-out`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
