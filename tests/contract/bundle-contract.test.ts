import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { parse } from "yaml";

import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const execFileAsync = promisify(execFile);

test("package is a DSH bundle with app/bridge exports and no standalone bin", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;

  assert.equal(manifest.name, "dsh-eval-lab");
  assert.equal("bin" in manifest, false);
  assert.deepEqual(manifest.exports, {
    "./app": "./dist/app/index.js",
    "./bridge": "./dist/bridge/index.js",
  });
  assert.deepEqual(manifest.dsh, { bundle: { patch: "./cordis.patch.yml" } });
  assert.equal(
    (manifest.scripts as Record<string, unknown>).prepare,
    "pnpm build",
    "local or Git plugin installs must build their exported entrypoints",
  );
});

test("bundle defaults to management app enabled and runner bridge disabled", async () => {
  const source = await readFile(new URL("../../cordis.patch.yml", import.meta.url), "utf8");
  assert.deepEqual(parse(source), [
    {
      insert: [
        { id: "dsh-eval-app", name: "dsh-eval-lab/app", disabled: false },
        { id: "dsh-eval-bridge", name: "dsh-eval-lab/bridge", disabled: true },
      ],
    },
  ]);
});

test("both DSH entrypoints default-export side-effect-free plugin functions", async () => {
  const [app, bridge] = await Promise.all([
    import("../../src/app/index.js"),
    import("../../src/bridge/index.js"),
  ]);
  assert.equal(typeof app.default, "function");
  assert.equal(typeof bridge.default, "function");
});

test("clean packed artifact contains importable DSH entrypoints", async () => {
  const pnpmCli = process.env.npm_execpath;
  assert.ok(pnpmCli, "pnpm test must expose npm_execpath for the pack contract");

  const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
  const scratchParent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(scratchParent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${scratchParent}/bundle-pack-`);

  try {
    await execFileAsync(process.execPath, [pnpmCli, "pack", "--pack-destination", scratch], {
      cwd: repositoryRoot,
    });
    const archives = (await readdir(scratch)).filter((entry) => entry.endsWith(".tgz"));
    assert.equal(archives.length, 1);
    const archive = archives[0];
    assert.ok(archive);

    const unpackRoot = join(scratch, "unpacked");
    await mkdir(unpackRoot, { mode: 0o700 });
    await execFileAsync("/usr/bin/tar", ["-xzf", join(scratch, archive), "-C", unpackRoot]);

    const packageRoot = join(unpackRoot, "package");
    const packedManifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal("bin" in packedManifest, false);
    await execFileAsync(process.execPath, [pnpmCli, "install", "--ignore-scripts"], {
      cwd: packageRoot,
    });

    const [app, bridge] = await Promise.all([
      import(pathToFileURL(join(packageRoot, "dist/app/index.js")).href),
      import(pathToFileURL(join(packageRoot, "dist/bridge/index.js")).href),
    ]);
    assert.equal(typeof app.default, "function");
    assert.equal(typeof bridge.default, "function");

    let provided: unknown;
    const exits: number[] = [];
    await app.default(
      {
        cmdlineArgs: { get: () => ["doctor"] },
        appExit: (code: number) => exits.push(code),
        provide: (_name: "dshEvalApp", invocation: unknown) => {
          provided = invocation;
        },
      },
      {
        env: { DSH_HOME: DEDICATED_DSH_HOME },
        executor: { execute: async () => 0 },
      },
    );
    assert.deepEqual(provided, { kind: "doctor" });
    assert.deepEqual(exits, [0]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("app plugin enforces DSH_HOME before consuming immutable app arguments", async () => {
  const app = await import("../../src/app/index.js");
  let argsRead = false;
  let provided: unknown;
  const exits: number[] = [];
  const context = {
    cmdlineArgs: {
      get: () => {
        argsRead = true;
        return ["doctor"];
      },
    },
    appExit: (code: number) => exits.push(code),
    provide: (_name: "dshEvalApp", invocation: unknown) => {
      provided = invocation;
    },
  };

  assert.throws(
    () => app.default(context, { env: {}, executor: { execute: async () => 0 } }),
    /DSH_HOME/,
  );
  assert.equal(argsRead, false);

  await app.default(context, {
    env: { DSH_HOME: DEDICATED_DSH_HOME },
    executor: { execute: async () => 0 },
  });
  assert.equal(argsRead, true);
  assert.deepEqual(provided, { kind: "doctor" });
  assert.deepEqual(exits, [0]);
});

test("app plugin turns invalid immutable arguments into exit 2 before execution", async () => {
  const app = await import("../../src/app/index.js");
  const exits: number[] = [];
  let provided = false;
  let executed = false;
  await app.default(
    {
      cmdlineArgs: { get: () => ["run", "--runtime-root", "/tmp/forbidden"] },
      appExit: (code: number) => exits.push(code),
      provide: () => {
        provided = true;
      },
    },
    {
      env: { DSH_HOME: DEDICATED_DSH_HOME },
      executor: {
        execute: async () => {
          executed = true;
          return 0;
        },
      },
    },
  );
  assert.deepEqual(exits, [2]);
  assert.equal(provided, false);
  assert.equal(executed, false);
});
