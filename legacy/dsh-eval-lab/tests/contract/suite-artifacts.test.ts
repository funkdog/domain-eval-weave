import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import test from "node:test";

import { parseSuiteReport } from "../../src/contracts/phase2.js";
import { parseSuiteArtifactRef } from "../../src/contracts/suite-artifact-ref.js";
import {
  readCanonicalSuiteArtifact,
  SuiteArtifactIntegrityError,
  writeCanonicalSuiteArtifact,
} from "../../src/contracts/suite-artifacts.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { validSuiteReport } from "../helpers/phase2-fixtures.js";

async function scratch(label: string): Promise<string> {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(`${parent}/${label}-`);
}

test("Suite artifact refs are isolated from Campaign artifact refs", () => {
  assert.equal(
    parseSuiteArtifactRef("artifact://suite/report.json"),
    "artifact://suite/report.json",
  );
  assert.throws(() => parseSuiteArtifactRef("artifact://campaign/report.json"));
  assert.throws(() => parseSuiteArtifactRef("artifact://suite/../report.json"));
});

test("Suite artifacts are canonical, immutable, and digest verified", async () => {
  const root = await scratch("suite-artifacts");
  try {
    const pointer = await writeCanonicalSuiteArtifact(
      root,
      "artifact://suite/report.json",
      validSuiteReport,
    );
    assert.deepEqual(
      await readCanonicalSuiteArtifact(root, pointer, parseSuiteReport),
      validSuiteReport,
    );
    assert.deepEqual(
      await writeCanonicalSuiteArtifact(root, "artifact://suite/report.json", validSuiteReport),
      pointer,
    );
    await assert.rejects(
      writeCanonicalSuiteArtifact(root, "artifact://suite/report.json", {
        ...validSuiteReport,
        reasons: ["DRIFT"],
      }),
      (error: unknown) =>
        error instanceof SuiteArtifactIntegrityError &&
        error.code === "SUITE_ARTIFACT_ALREADY_EXISTS",
    );
    await assert.rejects(
      readCanonicalSuiteArtifact(root, { ...pointer, sha256: "0".repeat(64) }, parseSuiteReport),
      (error: unknown) =>
        error instanceof SuiteArtifactIntegrityError &&
        error.code === "SUITE_ARTIFACT_DIGEST_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Suite artifact writes reject symlinked parents", async () => {
  const root = await scratch("suite-artifact-symlink");
  const outside = await scratch("suite-artifact-outside");
  try {
    await symlink(outside, `${root}/tasks`);
    await assert.rejects(
      writeCanonicalSuiteArtifact(root, "artifact://suite/tasks/task/report.json", {}),
      (error: unknown) =>
        error instanceof SuiteArtifactIntegrityError &&
        error.code === "SUITE_ARTIFACT_PARENT_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
