import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertContainedPhase2Directory,
  assertCurrentPhase3AuthorProfile,
  PHASE2_INSTANCE,
  PHASE3A_AUTHOR,
  Phase2InstanceError,
  phase2CalibrationPath,
  resolvePhase2Instance,
} from "../../src/instance.js";
import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

test("Phase 2 instance freezes profile and artifact namespaces without changing DSH_HOME", () => {
  assert.deepEqual(
    resolvePhase2Instance({
      DSH_HOME: DEDICATED_DSH_HOME,
      DSH_EVAL_INSTANCE_ID: "clowder-ai",
    }),
    {
      id: "clowder-ai",
      managementProfile: "eval-clowder",
      runnerProfile: "eval-clowder-runner",
      instanceRoot: `${DEDICATED_RUNTIME_ROOT}/instances/clowder-ai`,
      sessionsRoot: `${DEDICATED_DSH_HOME}/sessions/clowder-ai`,
    },
  );
  assert.equal(PHASE2_INSTANCE.id, "clowder-ai");
  assert.deepEqual(PHASE3A_AUTHOR, {
    profile: "eval-clowder-author",
    sessionsRoot: `${DEDICATED_DSH_HOME}/sessions/clowder-ai-author`,
  });
  assert.doesNotThrow(() =>
    assertCurrentPhase3AuthorProfile(
      pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/eval-clowder-author/`).href,
    ),
  );
});

test("Phase 2 instance rejects missing, unknown, and alternate-home inputs", () => {
  for (const env of [
    { DSH_HOME: DEDICATED_DSH_HOME },
    { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "dsh" },
    { DSH_HOME: `${DEDICATED_DSH_HOME}/other`, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
  ]) {
    assert.throws(
      () => resolvePhase2Instance(env),
      (error: unknown) => error instanceof Phase2InstanceError,
    );
  }
});

test("calibration paths bind both Task Pack and eval package revisions", () => {
  const taskPackDigest = "a".repeat(64);
  const first = phase2CalibrationPath(taskPackDigest, "b".repeat(64));
  const second = phase2CalibrationPath(taskPackDigest, "c".repeat(64));
  assert.notEqual(first, second);
  assert.equal(
    first,
    `${PHASE2_INSTANCE.instanceRoot}/calibration/${taskPackDigest}--${"b".repeat(64)}.json`,
  );
  assert.throws(() => phase2CalibrationPath("not-a-digest", "b".repeat(64)));
});

test("Phase 2 layout revalidation rejects a post-init symlink swap", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/phase2-layout-`);
  const root = `${scratch}/root`;
  const target = `${root}/one/two`;
  const outside = `${scratch}/outside`;
  await mkdir(target, { recursive: true, mode: 0o700 });
  await mkdir(outside, { mode: 0o700 });
  try {
    await assertContainedPhase2Directory(root, target);
    await rm(target, { recursive: true });
    await symlink(outside, target);
    await assert.rejects(
      assertContainedPhase2Directory(root, target),
      (error: unknown) =>
        error instanceof Phase2InstanceError && error.code === "PHASE2_PATH_INVALID",
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
