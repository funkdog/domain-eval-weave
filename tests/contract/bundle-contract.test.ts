import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { parse } from "yaml";

import { fingerprintPackageTarContent } from "../../src/carrier/author-forward-internal.js";
import { fingerprintPackageContent } from "../../src/fingerprint/deployment.js";
import { DEDICATED_DSH_HOME, DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const execFileAsync = promisify(execFile);
const managementProfileBaseUrl = pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/eval-clowder/`).href;
const authorProfileBaseUrl = pathToFileURL(
  `${DEDICATED_DSH_HOME}/profiles/eval-clowder-author/`,
).href;

async function loadCordisContext(): Promise<
  new () => {
    baseUrl?: string;
    readonly fiber: { dispose(): Promise<void> };
    plugin(plugin: unknown, config?: unknown): { await(): Promise<unknown> };
    provide(name: string, value: unknown): void;
  }
> {
  const packageRequire = createRequire(import.meta.url);
  const dshToolsRequire = createRequire(
    packageRequire.resolve("@deepseek-ai/dsh-tools/package.json"),
  );
  const cordis = (await import(
    pathToFileURL(dshToolsRequire.resolve("@deepseek-ai/cordis")).href
  )) as {
    Context: new () => {
      baseUrl?: string;
      readonly fiber: { dispose(): Promise<void> };
      plugin(plugin: unknown, config?: unknown): { await(): Promise<unknown> };
      provide(name: string, value: unknown): void;
    };
  };
  return cordis.Context;
}

test("package is a DSH bundle with app/bridge exports and no standalone bin", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;

  assert.equal(manifest.name, "dsh-eval-lab");
  assert.equal("bin" in manifest, false);
  assert.deepEqual(manifest.exports, {
    "./app": "./dist/app/index.js",
    "./author-bridge": "./dist/author-bridge/index.js",
    "./author-evidence": "./dist/author-evidence/index.js",
    "./author-forward-carrier": "./dist/carrier/author-forward.js",
    "./bridge": "./dist/bridge/index.js",
    "./delivery": "./dist/delivery/index.js",
    "./domain-skill": "./dist/domain/skill-provider.js",
  });
  assert.deepEqual(manifest.dsh, { bundle: { patch: "./cordis.patch.yml" } });
  assert.equal(
    (manifest.scripts as Record<string, unknown>).prepare,
    "pnpm build",
    "local or Git plugin installs must build their exported entrypoints",
  );
  assert.equal(
    (manifest.scripts as Record<string, unknown>).build,
    "node scripts/clean-dist.mjs && tsc -p tsconfig.json",
    "every package build must remove ignored output from older compiler layouts",
  );
});

test("Phase 3 package advances while the accepted Phase 2 Harness/Registry stay immutable", async () => {
  const [manifestSource, harnessSource, registrySource] = await Promise.all([
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../harnesses/dsh-goal-stack/harness.json", import.meta.url), "utf8"),
    readFile(new URL("../../registry/registry.json", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource) as Record<string, unknown>;
  const harness = JSON.parse(harnessSource) as Record<string, unknown>;
  const registry = JSON.parse(registrySource) as Record<string, unknown>;

  assert.equal(manifest.version, "0.3.0-alpha.1");
  assert.equal(harness.harness_version, "0.2.0-rc.4");
  assert.equal(registry.registry_id, "dsh-eval-lab-phase2-v4");
});

test("bundle defaults to management app only and keeps Candidate/authoring surfaces disabled", async () => {
  const source = await readFile(new URL("../../cordis.patch.yml", import.meta.url), "utf8");
  assert.deepEqual(parse(source), [
    {
      insert: [
        { id: "dsh-eval-app", name: "dsh-eval-lab/app", disabled: false },
        { id: "dsh-eval-bridge", name: "dsh-eval-lab/bridge", disabled: true },
        {
          id: "dsh-eval-author-bridge",
          name: "dsh-eval-lab/author-bridge",
          disabled: true,
        },
        {
          id: "dsh-eval-domain-skill",
          name: "dsh-eval-lab/domain-skill",
          disabled: true,
        },
      ],
    },
  ]);
});

test("all DSH entrypoints default-export side-effect-free plugin functions", async () => {
  const [app, authorBridge, bridge, domainSkill] = await Promise.all([
    import("../../src/app/index.js"),
    import("../../src/author-bridge/index.js"),
    import("../../src/bridge/index.js"),
    import("../../src/domain/skill-provider.js"),
  ]);
  assert.equal(typeof app.default, "function");
  assert.equal(typeof authorBridge.default, "function");
  assert.equal(typeof bridge.default, "function");
  assert.equal(typeof domainSkill.default, "function");
  assert.deepEqual(
    (bridge.default as typeof bridge.default & { readonly inject?: readonly string[] }).inject,
    bridge.inject,
    "the Cordis loader unwraps the default export, so bridge injection metadata must live on it",
  );
  assert.deepEqual(
    (
      authorBridge.default as typeof authorBridge.default & {
        readonly inject?: readonly string[];
      }
    ).inject,
    authorBridge.inject,
    "the packed author bridge must expose tool injection metadata on its default export",
  );
  assert.deepEqual(
    (domainSkill.default as typeof domainSkill.default & { readonly inject?: readonly string[] })
      .inject,
    domainSkill.inject,
    "the Cordis loader unwraps the default export, so domain Skill injection metadata must live on it",
  );
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
    const packedDistEntries = await readdir(join(packageRoot, "dist"));
    assert.equal(packedDistEntries.includes("src"), false);
    assert.equal(packedDistEntries.includes("tests"), false);
    const packedManifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal("bin" in packedManifest, false);
    assert.equal(
      fingerprintPackageTarContent(await readFile(join(scratch, archive))).contentSha256,
      await fingerprintPackageContent(packageRoot),
      "the reviewed tar and its installed package must share one canonical content ordering",
    );
    await execFileAsync(process.execPath, [pnpmCli, "install", "--ignore-scripts"], {
      cwd: packageRoot,
    });

    const [
      app,
      authorBridge,
      authorEvidence,
      authorForwardCarrier,
      bridge,
      delivery,
      domainSkill,
      skillBody,
    ] = await Promise.all([
      import(pathToFileURL(join(packageRoot, "dist/app/index.js")).href),
      import(pathToFileURL(join(packageRoot, "dist/author-bridge/index.js")).href),
      import(pathToFileURL(join(packageRoot, "dist/author-evidence/index.js")).href),
      import(pathToFileURL(join(packageRoot, "dist/carrier/author-forward.js")).href),
      import(pathToFileURL(join(packageRoot, "dist/bridge/index.js")).href),
      import(pathToFileURL(join(packageRoot, "dist/delivery/index.js")).href),
      import(pathToFileURL(join(packageRoot, "dist/domain/skill-provider.js")).href),
      readFile(join(packageRoot, "skills/design-domain-grader/SKILL.md"), "utf8"),
    ]);
    assert.equal(typeof app.default, "function");
    assert.equal(typeof authorBridge.default, "function");
    assert.equal(typeof authorEvidence.readForwardEvidenceRoot, "function");
    assert.equal(typeof authorEvidence.evaluateUnauthorizedTruth, "function");
    assert.equal(typeof authorForwardCarrier.AuthorForwardCarrier, "function");
    assert.equal("InternalAuthorForwardCarrier" in authorForwardCarrier, false);
    const facadeUrl = pathToFileURL(join(packageRoot, "dist/carrier/author-forward.js"));
    const packedInternalCarrier = await import(
      new URL("./author-forward-internal.js", facadeUrl).href
    );
    assert.equal(
      "InternalAuthorForwardCarrier" in packedInternalCarrier,
      false,
      "a sibling file URL must not expose the test-only carrier constructor",
    );
    assert.throws(
      () => Reflect.construct(authorForwardCarrier.AuthorForwardCarrier, [{}]),
      /does not accept injected dependencies/,
    );
    assert.throws(
      () =>
        new authorForwardCarrier.AuthorForwardCarrier().run({
          executable: process.execPath,
        } as never),
      /input contains an unknown field/,
    );
    assert.equal(typeof bridge.default, "function");
    assert.equal(typeof delivery.runRealDeliveryEvaluation, "function");
    assert.equal(typeof delivery.replayRealDeliveryEvaluation, "function");
    assert.equal("compileValidatedDeterministicGrader" in delivery, false);
    assert.equal("buildGraderAdmission" in delivery, false);
    assert.equal("persistDeliveryEvaluation" in delivery, false);
    assert.equal(typeof domainSkill.default, "function");
    assert.match(skillBody, /name: design-domain-grader/);
    assert.deepEqual(
      (bridge.default as typeof bridge.default & { readonly inject?: readonly string[] }).inject,
      bridge.inject,
    );
    assert.deepEqual(
      (
        authorBridge.default as typeof authorBridge.default & {
          readonly inject?: readonly string[];
        }
      ).inject,
      authorBridge.inject,
    );
    assert.deepEqual(
      (domainSkill.default as typeof domainSkill.default & { readonly inject?: readonly string[] })
        .inject,
      domainSkill.inject,
    );

    const CordisContext = await loadCordisContext();
    const cordis = new CordisContext();
    cordis.baseUrl = authorProfileBaseUrl;
    let registeredSkill: unknown;
    let registeredTool: unknown;
    let installedGuard: unknown;
    try {
      await cordis
        .plugin((context: { provide(name: string, value: unknown): void }) => {
          context.provide("skills", {
            register: (skill: unknown) => {
              registeredSkill = skill;
              return () => undefined;
            },
          });
          context.provide("tools", {
            guard: (guard: unknown) => {
              installedGuard = guard;
            },
            register: (tool: unknown) => {
              registeredTool = tool;
            },
          });
        })
        .await();
      await cordis
        .plugin(authorBridge.default, {
          workspaceRoot: packageRoot,
          env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
          assertLayout: async () => undefined,
        })
        .await();
      await cordis
        .plugin(domainSkill.default, {
          env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
        })
        .await();
      assert.equal((registeredSkill as { readonly name?: string })?.name, "design-domain-grader");
      assert.equal((registeredTool as { readonly name?: string })?.name, "domain_artifact");
      assert.equal(typeof installedGuard, "function");
    } finally {
      await cordis.fiber.dispose();
    }

    const unannotatedCordis = new CordisContext();
    unannotatedCordis.baseUrl = authorProfileBaseUrl;
    const unannotatedDefault = (...args: unknown[]) =>
      (domainSkill.default as (...input: unknown[]) => unknown)(...args);
    try {
      await unannotatedCordis
        .plugin((context: { provide(name: string, value: unknown): void }) =>
          context.provide("skills", { register: () => () => undefined }),
        )
        .await();
      await assert.rejects(
        unannotatedCordis
          .plugin(unannotatedDefault, {
            env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
          })
          .await(),
        /without inject/,
      );
    } finally {
      await unannotatedCordis.fiber.dispose();
    }

    let provided: unknown;
    const exits: number[] = [];
    await app.default(
      {
        root: { baseUrl: managementProfileBaseUrl },
        cmdlineArgs: { get: () => ["doctor"] },
        appExit: (code: number) => exits.push(code),
        provide: (_name: "dshEvalApp", invocation: unknown) => {
          provided = invocation;
        },
      },
      {
        env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
        executor: { execute: async () => 0 },
      },
    );
    assert.deepEqual(provided, { kind: "doctor" });
    assert.deepEqual(exits, [0]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("app plugin enforces DSH_HOME and instance id before consuming immutable arguments", async () => {
  const app = await import("../../src/app/index.js");
  let argsRead = false;
  let provided: unknown;
  const exits: number[] = [];
  const context = {
    root: { baseUrl: managementProfileBaseUrl },
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

  assert.throws(
    () =>
      app.default(
        {
          ...context,
          root: { baseUrl: pathToFileURL(`${DEDICATED_DSH_HOME}/profiles/eval-dsh/`).href },
        },
        {
          env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
          executor: { execute: async () => 0 },
        },
      ),
    /profile/i,
  );
  assert.equal(argsRead, false);

  assert.throws(
    () =>
      app.default(context, {
        env: { DSH_HOME: DEDICATED_DSH_HOME },
        executor: { execute: async () => 0 },
      }),
    /DSH_EVAL_INSTANCE_ID/,
  );
  assert.equal(argsRead, false);

  await app.default(context, {
    env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
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
      root: { baseUrl: managementProfileBaseUrl },
      cmdlineArgs: { get: () => ["run", "--runtime-root", "/tmp/forbidden"] },
      appExit: (code: number) => exits.push(code),
      provide: () => {
        provided = true;
      },
    },
    {
      env: { DSH_HOME: DEDICATED_DSH_HOME, DSH_EVAL_INSTANCE_ID: "clowder-ai" },
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
