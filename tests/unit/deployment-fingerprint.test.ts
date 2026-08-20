import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  findPackageRoot,
  fingerprintPackageClosure,
  fingerprintPackageContent,
  fingerprintPackageEntries,
} from "../../src/fingerprint/deployment.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

test("deployment fingerprint binds package bytes and transitive installed packages", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/deployment-fingerprint-`);
  const dependency = `${root}/node_modules/example-dependency`;
  await mkdir(`${root}/lib`, { recursive: true });
  await mkdir(dependency, { recursive: true });
  await writeFile(
    `${root}/package.json`,
    JSON.stringify({
      name: "example-root",
      version: "1.0.0",
      dependencies: { "example-dependency": "1.0.0" },
    }),
  );
  await writeFile(`${root}/lib/index.js`, "export const value = 1;\n");
  await writeFile(
    `${dependency}/package.json`,
    JSON.stringify({ name: "example-dependency", version: "1.0.0" }),
  );
  await writeFile(`${dependency}/index.js`, "export const dependency = 1;\n");
  try {
    assert.equal(await findPackageRoot(`${root}/lib/index.js`, "example-root"), root);
    const contentBefore = await fingerprintPackageContent(root);
    const closureBefore = await fingerprintPackageClosure(root);
    await writeFile(`${dependency}/index.js`, "export const dependency = 2;\n");
    assert.equal(await fingerprintPackageContent(root), contentBefore);
    assert.notEqual(await fingerprintPackageClosure(root), closureBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("package entry fingerprints use one locale-independent global path order", () => {
  const entries = [
    { path: "a/nested.js", executable: false, sha256: "1".repeat(64) },
    { path: "a.js", executable: false, sha256: "2".repeat(64) },
    { path: "README.md", executable: false, sha256: "3".repeat(64) },
  ] as const;
  assert.equal(
    fingerprintPackageEntries(entries),
    fingerprintPackageEntries([...entries].reverse()),
  );
});
