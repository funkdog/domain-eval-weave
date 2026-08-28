import assert from "node:assert/strict";
import test from "node:test";

import { parseTaskEntry } from "../../src/contracts/phase2.js";
import { SuiteArtifactIntegrityError } from "../../src/contracts/suite-artifacts.js";
import { assertTaskPackMatchesRegistry } from "../../src/suite/replay.js";
import { parseTaskPackIdentity } from "../../src/task-pack/loader.js";
import { validTaskPackIdentity } from "../helpers/fixtures.js";
import { validTaskEntry } from "../helpers/phase2-fixtures.js";

function matchingTaskPack() {
  return parseTaskPackIdentity({
    ...structuredClone(validTaskPackIdentity),
    pack: {
      ...structuredClone(validTaskPackIdentity.pack),
      base_tree_sha256: validTaskEntry.effective_base_sha256,
      oracle_version: validTaskEntry.oracle.version,
    },
    public_task_sha256: validTaskEntry.public_task_sha256,
    oracle_runner_sha256: validTaskEntry.oracle.runner_sha256,
  });
}

test("Suite replay binds every Phase 1 Task Pack identity face to the Registry Task", () => {
  const task = parseTaskEntry(validTaskEntry);
  const taskPack = matchingTaskPack();
  assert.doesNotThrow(() => assertTaskPackMatchesRegistry(task, taskPack));

  for (const drifted of [
    { ...taskPack, public_task_sha256: "1".repeat(64) },
    { ...taskPack, oracle_runner_sha256: "2".repeat(64) },
    { ...taskPack, pack: { ...taskPack.pack, base_tree_sha256: "3".repeat(64) } },
  ]) {
    assert.throws(
      () => assertTaskPackMatchesRegistry(task, parseTaskPackIdentity(drifted)),
      (error: unknown) =>
        error instanceof SuiteArtifactIntegrityError &&
        error.code === "SUITE_ARTIFACT_CROSS_REFERENCE_INVALID",
    );
  }

  const behaviorDrift = parseTaskEntry({
    ...structuredClone(task),
    oracle: { ...structuredClone(task.oracle), behavior_keys: ["basic_reservation"] },
  });
  assert.throws(() => assertTaskPackMatchesRegistry(behaviorDrift, taskPack));
});
