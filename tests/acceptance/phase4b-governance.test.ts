import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("open-source governance and CI expose one portable public gate", async () => {
  for (const path of [
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "GOVERNANCE.md",
    "docs/support-matrix.md",
  ]) {
    assert.ok((await readFile(`${repositoryRoot}/${path}`, "utf8")).length > 100, path);
  }
  const workflow = await readFile(`${repositoryRoot}/.github/workflows/ci.yml`, "utf8");
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /bubblewrap/);
  assert.match(workflow, /apparmor_restrict_unprivileged_userns/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(workflow, /pnpm rebuild esbuild/);
  assert.match(workflow, /pnpm check:public && pnpm lint:public/);
  assert.match(workflow, /pnpm test:public/);
  assert.match(workflow, /pnpm build:packages/);
  assert.doesNotMatch(workflow, /\/Users\/slipshod|Initialize isolated legacy runtime/);
  assert.doesNotMatch(workflow, /^\s*run: pnpm (?:build|check|lint)\s*$/m);

  const rootManifest = JSON.parse(await readFile(`${repositoryRoot}/package.json`, "utf8")) as {
    readonly scripts?: Readonly<Record<string, unknown>>;
  };
  assert.equal(typeof rootManifest.scripts?.["check:public"], "string");
  assert.equal(typeof rootManifest.scripts?.["lint:public"], "string");
  assert.equal(typeof rootManifest.scripts?.["test:public"], "string");

  const contributing = await readFile(`${repositoryRoot}/CONTRIBUTING.md`, "utf8");
  assert.match(contributing, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(contributing, /pnpm rebuild esbuild/);
  assert.match(contributing, /pnpm check:public/);
  assert.match(contributing, /pnpm lint:public/);
  assert.match(contributing, /pnpm test:public/);
  assert.doesNotMatch(contributing, /\npnpm test\n/);

  assert.doesNotMatch(
    await readFile(`${repositoryRoot}/AGENTS.md`, "utf8"),
    /Clowder AI|cat-cafe|\/Users\/slipshod|Redis port 6399/,
  );
  for (const path of ["CLAUDE.md", "GEMINI.md", "KIMI.md"]) {
    assert.equal(
      await lstat(`${repositoryRoot}/${path}`).catch((error: NodeJS.ErrnoException) => error.code),
      "ENOENT",
      path,
    );
  }
  assert.equal(
    await lstat(`${repositoryRoot}/cat-cafe-skills`).catch(
      (error: NodeJS.ErrnoException) => error.code,
    ),
    "ENOENT",
  );

  for (const path of [
    "packages/weave/tests/contract/phase4b-weave-package.test.ts",
    "packages/dsh-adapter/tests/contract/phase4b-dsh-adapter-package.test.ts",
    "tests/acceptance/phase4b-human-cleanroom-kit.test.ts",
    "tests/acceptance/phase4b-packed-cleanroom.test.ts",
  ]) {
    assert.doesNotMatch(
      await readFile(`${repositoryRoot}/${path}`, "utf8"),
      /DEDICATED_RUNTIME_ROOT|\/Users\/slipshod/,
      path,
    );
  }

  const license = await readFile(`${repositoryRoot}/LICENSE`, "utf8");
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /3\. Grant of Patent License/);
  assert.equal(await readFile(`${repositoryRoot}/packages/weave/LICENSE`, "utf8"), license);
  assert.equal(await readFile(`${repositoryRoot}/packages/dsh-adapter/LICENSE`, "utf8"), license);
  assert.match(
    await readFile(
      `${repositoryRoot}/packages/weave/examples/commerce-cancellation/sources/LICENSE`,
      "utf8",
    ),
    /CC0-1\.0/,
  );
  for (const path of [
    "package.json",
    "packages/weave/package.json",
    "packages/dsh-adapter/package.json",
    "legacy/dsh-eval-lab/package.json",
  ]) {
    assert.equal(
      (
        JSON.parse(await readFile(`${repositoryRoot}/${path}`, "utf8")) as {
          readonly license?: unknown;
        }
      ).license,
      "Apache-2.0",
      path,
    );
  }

  const readiness = await execFileAsync(
    process.execPath,
    [`${repositoryRoot}/scripts/open-source-readiness.mjs`],
    { cwd: repositoryRoot },
  );
  const report = JSON.parse(readiness.stdout) as {
    readonly implementation_ready?: unknown;
    readonly developer_preview_ready?: unknown;
    readonly public_alpha_ready?: unknown;
    readonly blockers?: unknown;
  };
  assert.equal(report.implementation_ready, true);
  assert.equal(report.developer_preview_ready, true);
  assert.equal(report.public_alpha_ready, false);
  assert.deepEqual(report.blockers, ["HUMAN_CLEANROOM_PENDING"]);
});

test("DomainEval Weave is the workspace identity while DSH is an isolated legacy package", async () => {
  const readManifest = async (path: string) =>
    JSON.parse(await readFile(`${repositoryRoot}/${path}`, "utf8")) as {
      readonly name?: unknown;
      readonly private?: unknown;
      readonly bin?: unknown;
      readonly exports?: unknown;
      readonly dependencies?: unknown;
      readonly scripts?: Readonly<Record<string, unknown>>;
      readonly repository?: { readonly url?: unknown; readonly directory?: unknown };
    };

  const root = await readManifest("package.json");
  const legacy = await readManifest("legacy/dsh-eval-lab/package.json");
  const weave = await readManifest("packages/weave/package.json");
  const adapter = await readManifest("packages/dsh-adapter/package.json");
  const readme = await readFile(`${repositoryRoot}/README.md`, "utf8");

  assert.equal(root.name, "domain-eval-weave-workspace");
  assert.equal(root.private, true);
  assert.equal(root.bin, undefined);
  assert.equal(root.exports, undefined);
  assert.equal(root.dependencies, undefined);
  assert.equal(root.scripts?.prepare, undefined);
  assert.equal(legacy.name, "dsh-eval-lab");
  assert.equal(legacy.private, true);
  assert.deepEqual(legacy.bin, { "dsh-eval-capsule": "./bin/dsh-eval-capsule.mjs" });
  assert.equal(legacy.repository?.directory, "legacy/dsh-eval-lab");
  assert.equal(weave.name, "@domaineval/weave");
  assert.deepEqual(weave.bin, { "domain-eval": "./bin/domain-eval.mjs" });
  assert.equal(weave.repository?.url, "git+https://github.com/funkdog/domain-eval-weave.git");
  assert.equal(weave.repository?.directory, "packages/weave");
  assert.equal(adapter.name, "@domaineval/dsh-adapter");
  assert.equal(adapter.repository?.directory, "packages/dsh-adapter");
  assert.match(readme, /^# DomainEval Weave$/m);
  assert.match(readme, /Make domain truth executable\./);
  assert.match(await readFile(`${repositoryRoot}/AGENTS.md`, "utf8"), /^# DomainEval Weave/m);
});

test("the public package physically owns its implementation and schemas", async () => {
  for (const path of [
    "packages/weave/src/capsule/index.ts",
    "packages/weave/src/evaluator/index.ts",
    "packages/weave/src/harness/index.ts",
    "packages/weave/src/cli/index.ts",
    "packages/weave/schemas/capsule-manifest.schema.json",
    "docs/research/2026-08-27-open-source-license-boundary/codex-synthesis.md",
  ]) {
    assert.ok((await lstat(`${repositoryRoot}/${path}`)).isFile(), path);
  }
  assert.doesNotMatch(
    await readFile(`${repositoryRoot}/packages/weave/src/canonical-json.ts`, "utf8"),
    /legacy\/|dsh-eval-lab/,
  );
  assert.doesNotMatch(
    await readFile(`${repositoryRoot}/tsconfig.public.json`, "utf8"),
    /legacy\/|tests\/(?:unit|contract|e2e|helpers)\//,
  );
  for (const path of [
    "legacy/dsh-eval-lab/src/app/index.ts",
    "legacy/dsh-eval-lab/contracts/episode.schema.json",
    "legacy/dsh-eval-lab/task-packs/open-coding-ts-ledger-v1/pack.json",
    "legacy/dsh-eval-lab/scripts/bundle-delivery.mjs",
    "legacy/dsh-eval-lab/tests/contract/bundle-contract.test.ts",
  ]) {
    assert.ok((await lstat(`${repositoryRoot}/${path}`)).isFile(), path);
  }
  for (const path of [
    "packages/lab",
    "bin",
    "contracts",
    "cordis.patch.yml",
    "eval-packs",
    "examples",
    "harnesses",
    "registry",
    "runtime-profile",
    "skills",
    "src",
    "task-packs",
    "variants",
    "tsconfig.json",
    "tsconfig.test.json",
    "project-research",
    "BACKLOG.md",
  ]) {
    assert.equal(
      await lstat(`${repositoryRoot}/${path}`).catch((error: NodeJS.ErrnoException) => error.code),
      "ENOENT",
      path,
    );
  }
});
