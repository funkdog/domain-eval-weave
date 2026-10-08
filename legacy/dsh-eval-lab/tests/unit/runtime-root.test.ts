import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertDedicatedDshHomePreBoot,
  assertRuntimeLayoutInvariant,
  DEDICATED_DSH_HOME,
  DEDICATED_RUNTIME_ROOT,
  OAUTH_REFERENCE_ROOT,
  RuntimeRootInvariantError,
} from "../../src/runtime-root.js";

const SOURCE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("pre-boot contract accepts only the exact inherited dedicated DSH_HOME", () => {
  assert.doesNotThrow(() => assertDedicatedDshHomePreBoot({ DSH_HOME: DEDICATED_DSH_HOME }));
  assert.throws(
    () => assertDedicatedDshHomePreBoot({}),
    (error: unknown) =>
      error instanceof RuntimeRootInvariantError && error.code === "DSH_HOME_REQUIRED",
  );
  assert.throws(
    () => assertDedicatedDshHomePreBoot({ DSH_HOME: `${DEDICATED_DSH_HOME}/other` }),
    (error: unknown) =>
      error instanceof RuntimeRootInvariantError && error.code === "DSH_HOME_MISMATCH",
  );
});

test("approved source/runtime/reference roots and 0700 modes satisfy the invariant", async () => {
  await assertRuntimeLayoutInvariant({
    sourceRoot: SOURCE_ROOT,
    runtimeRoot: DEDICATED_RUNTIME_ROOT,
    dshHome: DEDICATED_DSH_HOME,
    oauthReferenceRoot: OAUTH_REFERENCE_ROOT,
  });
});

test("layout rejects overlap, permissive modes, and a symlinked missing ancestor", async () => {
  await assert.rejects(
    assertRuntimeLayoutInvariant({
      sourceRoot: SOURCE_ROOT,
      runtimeRoot: SOURCE_ROOT,
      dshHome: `${SOURCE_ROOT}/dsh-home`,
      oauthReferenceRoot: OAUTH_REFERENCE_ROOT,
    }),
    /physically separate/,
  );

  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const testRoot = await mkdtemp(`${scratchParent}/layout-`);
  const permissiveRoot = `${testRoot}/permissive`;
  const linkedAncestor = `${testRoot}/source-link`;

  try {
    await mkdir(permissiveRoot, { mode: 0o700 });
    await chmod(permissiveRoot, 0o755);
    await assert.rejects(
      assertRuntimeLayoutInvariant({
        sourceRoot: SOURCE_ROOT,
        runtimeRoot: permissiveRoot,
        dshHome: `${permissiveRoot}/dsh-home`,
        oauthReferenceRoot: OAUTH_REFERENCE_ROOT,
      }),
      /0700/,
    );

    await symlink(SOURCE_ROOT, linkedAncestor);
    await assert.rejects(
      assertRuntimeLayoutInvariant({
        sourceRoot: SOURCE_ROOT,
        runtimeRoot: `${linkedAncestor}/not-created`,
        dshHome: `${linkedAncestor}/not-created/dsh-home`,
        oauthReferenceRoot: OAUTH_REFERENCE_ROOT,
      }),
      /physically separate/,
    );
  } finally {
    await chmod(permissiveRoot, 0o700);
    await rm(testRoot, { recursive: true, force: true });
  }
});
