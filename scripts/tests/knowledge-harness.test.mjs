import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import { cliArgs } from "../lib/codex-coding-harness.mjs";
import { runKnowledgeArm, verifierNativeConfig } from "../lib/janitor-knowledge-harness.mjs";

test("paired native configuration differs only by the isolated workspace", () => {
  const jdk = "/fixture/jdk";
  const a = verifierNativeConfig("/fixture/a", jdk);
  const b = verifierNativeConfig("/fixture/b", jdk);
  const fsKey = "permissions.weave_probe.filesystem";
  assert.deepEqual(a[fsKey], {
    ":minimal": "read",
    "/fixture/a": "write",
    [dirname(dirname(process.execPath))]: "read",
    [jdk]: "read",
  });
  delete a[fsKey]["/fixture/a"];
  delete b[fsKey]["/fixture/b"];
  assert.deepEqual(a, b);
  assert.equal(a.approval_policy, "never");
  assert.equal(a["permissions.weave_probe.network.enabled"], false);
  assert.equal(a["features.multi_agent"], false);
  assert.equal(a["features.apps"], false);
  assert.equal(a["features.plugins"], false);
  const prompt = "---\n同一需求\n---";
  assert.deepEqual(cliArgs(b, prompt).slice(-2), ["--", prompt]);
});

test("live entry rejects missing operator reference and unknown arm before starting anything", async () => {
  await assert.rejects(runKnowledgeArm("unused", "raw_sources"), /explicit operator message/);
  await assert.rejects(
    runKnowledgeArm("unused", "unregistered", "0000000000000-000000-aaaaaaaa"),
    /unknown arm/,
  );
});

test("the actual padded operator message reference reaches artifact lookup", async () => {
  await assert.rejects(
    runKnowledgeArm(
      "/Users/slipshod/AIBuild/dsh-eval-lab-runtime/nonexistent-knowledge-pair-regression.json",
      "raw_sources",
      "0001789061886456-000354-4b36bb6e",
    ),
    { code: "ENOENT" },
  );
});
