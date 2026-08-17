import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

test("strict process runner sanitizes inherited credential, DSH, and proxy environment", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/strict-runner-`);
  const runner = new StrictProcessRunner();
  try {
    const result = await runner.run({
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify(Object.keys(process.env).filter(k => /TOKEN|AUTH|DSH|PROXY/i.test(k))))",
      ],
      cwd: scratch,
      readableRoots: [scratch],
      writableRoot: scratch,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
    assert.equal(result.timedOut, false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("strict process runner cannot read a synthetic sibling outside its allowlisted roots", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${scratchParent}/strict-boundary-`);
  const allowed = `${root}/allowed`;
  const denied = `${root}/denied`;
  await mkdir(allowed, { mode: 0o700 });
  await mkdir(denied, { mode: 0o700 });
  await writeFile(`${denied}/sentinel.txt`, "synthetic sentinel", "utf8");
  const runner = new StrictProcessRunner();
  try {
    const result = await runner.run({
      executable: process.execPath,
      args: [
        "-e",
        `const fs=require("node:fs");try{fs.readFileSync(${JSON.stringify(`${denied}/sentinel.txt`)});process.stdout.write("LEAK")}catch{process.stdout.write("DENIED")}`,
      ],
      cwd: allowed,
      readableRoots: [allowed],
      writableRoot: allowed,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "DENIED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict process runner can deliver bounded trusted source over stdin without argv exposure", async () => {
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/strict-stdin-`);
  const runner = new StrictProcessRunner();
  try {
    const result = await runner.run({
      executable: process.execPath,
      args: ["--input-type=module", "-", "opaque-argument"],
      stdin:
        'process.stdout.write(JSON.stringify({ argv: process.argv, leaked: process.argv.join(" ").includes("stdout.write") }));',
      cwd: scratch,
      readableRoots: [scratch],
      writableRoot: scratch,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const output = JSON.parse(result.stdout) as { argv: string[]; leaked: boolean };
    assert.equal(output.leaked, false);
    assert.deepEqual(output.argv.slice(1), ["-", "opaque-argument"]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
