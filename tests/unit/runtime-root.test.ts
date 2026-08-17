import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import test from "node:test";

import {
  assertRuntimeRootInvariant,
  DEFAULT_RUNTIME_ROOT,
  SOURCE_ROOT,
} from "../../src/runtime-root.js";

test("the frozen source and runtime roots are separate and the runtime root is 0700", async () => {
  await assertRuntimeRootInvariant({
    sourceRoot: SOURCE_ROOT,
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
  });
});

test("runtime-root invariant rejects equal or nested roots", async () => {
  await assert.rejects(
    assertRuntimeRootInvariant({ sourceRoot: SOURCE_ROOT, runtimeRoot: SOURCE_ROOT }),
  );
  await assert.rejects(
    assertRuntimeRootInvariant({
      sourceRoot: SOURCE_ROOT,
      runtimeRoot: `${SOURCE_ROOT}/runtime`,
    }),
  );
  await assert.rejects(
    assertRuntimeRootInvariant({
      sourceRoot: `${DEFAULT_RUNTIME_ROOT}/source`,
      runtimeRoot: DEFAULT_RUNTIME_ROOT,
    }),
  );
});

test("runtime-root invariant fails closed when an existing root is not 0700", async () => {
  const scratchParent = `${DEFAULT_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const runtimeRoot = await mkdtemp(`${scratchParent}/mode-`);

  try {
    await chmod(runtimeRoot, 0o755);
    await assert.rejects(
      assertRuntimeRootInvariant({ sourceRoot: SOURCE_ROOT, runtimeRoot }),
      /0700/,
    );
  } finally {
    await chmod(runtimeRoot, 0o700);
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("runtime-root invariant rejects a symlinked runtime root", async () => {
  const scratchParent = `${DEFAULT_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const testRoot = await mkdtemp(`${scratchParent}/symlink-`);
  const realRuntime = `${testRoot}/real-runtime`;
  const linkedRuntime = `${testRoot}/linked-runtime`;

  try {
    await mkdir(realRuntime, { mode: 0o700 });
    await symlink(realRuntime, linkedRuntime);
    await assert.rejects(
      assertRuntimeRootInvariant({ sourceRoot: SOURCE_ROOT, runtimeRoot: linkedRuntime }),
      /must not be a symlink/,
    );
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});

test("runtime-root invariant resolves symlinked ancestors for a missing runtime leaf", async () => {
  const scratchParent = `${DEFAULT_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const testRoot = await mkdtemp(`${scratchParent}/ancestor-symlink-`);
  const linkedAncestor = `${testRoot}/source-link`;

  try {
    await symlink(SOURCE_ROOT, linkedAncestor);
    await assert.rejects(
      assertRuntimeRootInvariant({
        sourceRoot: SOURCE_ROOT,
        runtimeRoot: `${linkedAncestor}/not-created`,
      }),
      /physically separate/,
    );
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
