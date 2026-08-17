import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";

import { DshRunCarrier } from "../../src/carrier/dsh-run.js";
import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

test("DSH carrier freezes argv and a credential-free dedicated child environment", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(`${parent}/carrier-env-`);
  try {
    const result = await new DshRunCarrier().runEpisode({
      executable: process.execPath,
      launcherArgs: [
        "-e",
        "process.stdout.write(JSON.stringify({args:process.argv.slice(1),env:process.env}))",
        "--",
      ],
      workspace,
      commonPatch: "/frozen/common.patch.yml",
      armPatch: "/frozen/goal-off.patch.yml",
      task: "synthetic public task",
      timeoutMs: 5_000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      args: string[];
      env: Record<string, string>;
    };
    assert.deepEqual(output.args, [
      "--profile",
      "eval-runner",
      "--patch",
      "/frozen/common.patch.yml",
      "--patch",
      "/frozen/goal-off.patch.yml",
      "synthetic public task",
    ]);
    const osInjectedEncoding = output.env.__CF_USER_TEXT_ENCODING;
    delete output.env.__CF_USER_TEXT_ENCODING;
    assert.ok(osInjectedEncoding === undefined || osInjectedEncoding.length > 0);
    assert.deepEqual(output.env, {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      DSH_HOME: DEDICATED_DSH_HOME,
      DSH_TOOLS_MODE: "native",
      DSH_PERMISSION_MODE: "workspace-write",
    });
    assert.equal(result.outputLimitExceeded, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("DSH carrier terminates output floods at the frozen byte cap", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(`${parent}/carrier-output-`);
  try {
    const result = await new DshRunCarrier().runEpisode({
      executable: process.execPath,
      launcherArgs: ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))", "--"],
      workspace,
      commonPatch: "/frozen/common.patch.yml",
      armPatch: "/frozen/goal-off.patch.yml",
      task: "synthetic public task",
      timeoutMs: 5_000,
    });
    assert.equal(result.outputLimitExceeded, true);
    assert.ok(Buffer.byteLength(result.stdout) <= 1024 * 1024);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("DSH carrier closes a completed headless run that retains an active handle", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(`${parent}/carrier-headless-exit-`);
  try {
    const result = await new DshRunCarrier().runEpisode({
      executable: process.execPath,
      launcherArgs: [
        "-e",
        [
          "process.on('SIGTERM',()=>process.exit(0))",
          "process.stdout.write('completed\\n')",
          "setInterval(()=>{},1000)",
        ].join(";"),
        "--",
      ],
      workspace,
      commonPatch: "/frozen/common.patch.yml",
      armPatch: "/frozen/goal-off.patch.yml",
      task: "synthetic public task",
      timeoutMs: 500,
      postOutputExitGraceMs: 25,
    });
    assert.equal(result.stdout, "completed\n");
    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.equal(result.timedOut, false);
    assert.equal(result.outputLimitExceeded, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
