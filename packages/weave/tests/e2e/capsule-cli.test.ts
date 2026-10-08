import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCapsuleCli } from "../../src/cli/index.js";

const example = new URL("../../examples/commerce-cancellation/", import.meta.url);

test("standalone Capsule CLI validates, releases, calibrates and compares offline", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-cli-"));
  const root = join(parent, "capsule");
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: (text: string) => (stdout += text),
    stderr: (text: string) => (stderr += text),
  };
  try {
    await cp(example, root, { recursive: true });
    assert.equal(await runCapsuleCli(["validate", root], io), 0);
    assert.match(stdout, /commerce-cancellation.*valid/s);

    stdout = "";
    assert.equal(await runCapsuleCli(["release", root], io), 0);
    assert.match(stdout, /release_sha256/);

    stdout = "";
    assert.equal(await runCapsuleCli(["calibrate", root, "commerce-delivery@2.0.0"], io), 0);
    assert.match(stdout, /qualified.*true/s);

    stdout = "";
    assert.equal(
      await runCapsuleCli(
        [
          "compare",
          root,
          "self-service-cancellation",
          "commerce-delivery@1.0.0",
          "commerce-delivery@2.0.0",
        ],
        io,
      ),
      0,
    );
    assert.match(stdout, /equivalent-typed-result/);
    assert.equal(stderr, "");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
