import assert from "node:assert/strict";
import test from "node:test";

import { PHASE2_INSTANCE, Phase2InstanceError, resolvePhase2Instance } from "../../src/instance.js";
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
