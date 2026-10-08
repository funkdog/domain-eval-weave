import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, sha256Hex } from "../../packages/weave/src/canonical-json.ts";
import { writeExclusiveOrVerify } from "../../packages/weave/src/capsule/artifact-store.ts";
import { loadJanitorTask } from "./janitor-coding-task.mjs";

const repository = new URL("../../", import.meta.url);
const sourceFiles = [
  "scripts/lib/janitor-coding-task.mjs",
  "scripts/lib/janitor-observations.mjs",
  "scripts/lib/killbill-status-profile.mjs",
  "scripts/fixtures/JanitorProbe.java",
  "legacy/dsh-eval-lab/src/process/strict-runner.ts",
  "packages/weave/src/canonical-json.ts",
  "packages/weave/src/capsule/artifact-store.ts",
  "packages/weave/examples/killbill-janitor-recovery/task-contract.json",
  "packages/weave/examples/killbill-janitor-recovery/dependency-lock.json",
];
async function stableBytes(path) {
  assert.equal(await realpath(path), resolve(path), "export refuses symlink inputs");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.nlink === 1 && before.size < 32 * 1024 * 1024);
    const bytes = await handle.readFile(),
      after = await handle.stat();
    assert.ok(
      bytes.length === before.size &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs,
    );
    return bytes;
  } finally {
    await handle.close();
  }
}

// Local, operator-side export. Never enumerate/copy arbitrary runtime content or an auth directory.
export async function exportJanitorConsumerKit(templateRoot) {
  const { root: template, task, preparation } = await loadJanitorTask(templateRoot);
  const root = await mkdtemp("/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-kit.");
  const files = {};
  async function put(name, bytes) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const data = Buffer.from(bytes);
    await writeExclusiveOrVerify(path, data, () => new Error("kit artifact collision"));
    files[name] = { bytes: data.length, sha256: sha256Hex(data) };
  }
  for (const name of sourceFiles) await put(name, await readFile(new URL(name, repository)));
  await put("cli.mjs", await readFile(new URL("scripts/janitor-kit-cli.mjs", repository)));
  await put(
    "README.md",
    await readFile(
      new URL("packages/weave/examples/killbill-janitor-recovery/CONSUMER.md", repository),
    ),
  );
  await put("LICENSE", await readFile(new URL("LICENSE", repository)));
  await put(
    "package.json",
    `${JSON.stringify({ name: "janitor-local-consumer-kit", private: true, type: "module", engines: { node: ">=24 <25" } }, null, 2)}\n`,
  );
  await put("state/seed/control/task.json", `${canonicalJson(task)}\n`);
  await put("state/seed/control/preparation.json", `${canonicalJson(preparation)}\n`);
  for (const [name, digest] of Object.entries(task.protected_files)) {
    const source = name.startsWith("lib/")
      ? join(template, "control/dependencies", name.slice(4))
      : join(template, "workspace", name);
    const bytes = await stableBytes(source);
    assert.equal(sha256Hex(bytes), digest, `protected export input drift: ${name}`);
    await put(`state/seed/workspace/${name}`, bytes);
    if (name.startsWith("lib/"))
      await put(`state/seed/control/dependencies/${name.slice(4)}`, bytes);
  }
  await put(`state/seed/workspace/${task.contract.editable_source}`, task.baseline_source);
  await mkdir(join(root, "state/seed/workspace/build"), { mode: 0o700 });
  const manifest = {
    format: "janitor-local-consumer-kit-v1",
    task_digest: task.digest,
    preparation_digest: preparation.digest,
    scope: "same-host-source-independent-consumer-kit",
    environment_policy: "original-host-and-JDK-fingerprint-required",
    model_execution: "not_included",
    excluded: [
      "credentials",
      "native_sessions",
      "reference_repairs",
      "previous_agent_submissions",
      "development_assessment_sources",
      "original_payment_bytecode",
      "public_release_authority",
    ],
    qualification: "not_qualified",
    files,
  };
  const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`);
  const digest = sha256Hex(manifestBytes);
  await writeExclusiveOrVerify(
    join(root, "kit.json"),
    manifestBytes,
    () => new Error("kit manifest collision"),
  );
  await writeExclusiveOrVerify(
    join(root, "kit.sha256"),
    Buffer.from(`${digest}\n`),
    () => new Error("kit checksum collision"),
  );
  return {
    root,
    digest,
    task_digest: task.digest,
    file_count: Object.keys(files).length,
    payload_bytes: Object.values(files).reduce((sum, file) => sum + file.bytes, 0),
    qualification: "not_qualified",
  };
}
