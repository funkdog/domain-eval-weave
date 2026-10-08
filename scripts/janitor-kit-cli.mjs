import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This exact file is copied to kit-root/cli.mjs. No repository or npm installation is used there.
const root = dirname(fileURLToPath(import.meta.url));
assert.equal(await realpath(root), root, "kit directory must be physical");
assert.equal(Number(process.versions.node.split(".")[0]), 24, "this kit requires Node 24");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function checkedFile(name, expected) {
  assert.ok(name.split("/").every((part) => part && part !== "." && part !== ".."));
  const path = join(root, name);
  assert.equal(await realpath(path), resolve(path), "kit symlink input denied");
  const stat = await lstat(path);
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.size < 32 * 1024 * 1024);
  const data = await readFile(path);
  if (expected)
    assert.ok(
      data.length === expected.bytes && sha256(data) === expected.sha256,
      `kit file drift: ${name}`,
    );
  return data;
}
const manifestBytes = await checkedFile("kit.json");
const expectedDigest = (await checkedFile("kit.sha256")).toString("utf8").trim();
assert.equal(sha256(manifestBytes), expectedDigest, "kit manifest drift");
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.format, "janitor-local-consumer-kit-v1");
for (const [name, pin] of Object.entries(manifest.files)) await checkedFile(name, pin);
// A relocated kit always uses its own state subtree, ignoring an inherited operator override.
process.env.WEAVE_JANITOR_RUNTIME_ROOT = join(root, "state");
const api = await import(new URL("./scripts/lib/janitor-coding-task.mjs", import.meta.url));
const [command, path, argument] = process.argv.slice(2);
let result;
if (command === "doctor") {
  const { task } = await api.loadJanitorTask(join(root, "state/seed"));
  assert.equal(task.digest, manifest.task_digest);
  assert.deepEqual(
    task.environment.host,
    { platform: platform(), arch: arch(), kernel: release() },
    "this kit has not been rebound to a different host",
  );
  const { fingerprintJdk } = await import(
    new URL("./scripts/lib/killbill-status-profile.mjs", import.meta.url)
  );
  assert.deepEqual(
    await fingerprintJdk(task.environment.java_home),
    task.environment.fingerprint,
    "JDK fingerprint differs",
  );
  result = {
    ready: true,
    task_digest: task.digest,
    kit_digest: expectedDigest,
    qualification: "not_qualified",
    model_execution: "not_included",
  };
} else if (command === "prepare")
  result = await api.materializeJanitorTask(join(root, "state/seed"));
else if (command === "submit") result = await api.submitJanitorSource(path);
else if (command === "evaluate") result = await api.evaluateJanitorSubmission(path, argument);
else if (command === "replay") result = await api.replayJanitorRun(path);
else if (command === "workspace-exec")
  result = await api.runJanitorWorkspaceCommand(path, argument);
else
  throw new Error(
    "usage: node cli.mjs doctor | prepare | submit <instance> | evaluate <instance> <submission-digest> | replay <run.json> | workspace-exec <instance> <command>",
  );
console.log(JSON.stringify(result, null, 2));
