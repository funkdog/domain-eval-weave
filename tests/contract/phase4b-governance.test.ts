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

  for (const path of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "KIMI.md"]) {
    const source = await readFile(`${repositoryRoot}/${path}`, "utf8");
    assert.doesNotMatch(source, /Clowder AI|cat-cafe|\/Users\/slipshod|Redis port 6399/, path);
  }
  assert.equal(
    await lstat(`${repositoryRoot}/cat-cafe-skills`).catch(
      (error: NodeJS.ErrnoException) => error.code,
    ),
    "ENOENT",
  );

  for (const path of [
    "tests/contract/phase4b-lab-package.test.ts",
    "tests/contract/phase4b-dsh-adapter-package.test.ts",
    "tests/contract/phase4b-human-cleanroom-kit.test.ts",
    "tests/e2e/phase4b-packed-cleanroom.test.ts",
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
  assert.equal(await readFile(`${repositoryRoot}/packages/lab/LICENSE`, "utf8"), license);
  assert.equal(await readFile(`${repositoryRoot}/packages/dsh-adapter/LICENSE`, "utf8"), license);
  assert.match(
    await readFile(
      `${repositoryRoot}/examples/capsules/commerce-cancellation/sources/LICENSE`,
      "utf8",
    ),
    /CC0-1\.0/,
  );
  for (const path of [
    "package.json",
    "packages/lab/package.json",
    "packages/dsh-adapter/package.json",
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

test("DomainEval Weave is the public identity while the DSH root stays private legacy", async () => {
  const readManifest = async (path: string) =>
    JSON.parse(await readFile(`${repositoryRoot}/${path}`, "utf8")) as {
      readonly name?: unknown;
      readonly private?: unknown;
      readonly bin?: unknown;
      readonly repository?: { readonly url?: unknown; readonly directory?: unknown };
    };

  const root = await readManifest("package.json");
  const weave = await readManifest("packages/lab/package.json");
  const adapter = await readManifest("packages/dsh-adapter/package.json");
  const readme = await readFile(`${repositoryRoot}/README.md`, "utf8");

  assert.equal(root.name, "dsh-eval-lab");
  assert.equal(root.private, true);
  assert.deepEqual(root.bin, { "dsh-eval-capsule": "./bin/dsh-eval-capsule.mjs" });
  assert.equal(weave.name, "@domaineval/weave");
  assert.deepEqual(weave.bin, { "domain-eval": "./bin/domain-eval.mjs" });
  assert.equal(weave.repository?.url, "git+https://github.com/funkdog/domain-eval-weave.git");
  assert.equal(weave.repository?.directory, "packages/lab");
  assert.equal(adapter.name, "@domaineval/dsh-adapter");
  assert.equal(adapter.repository?.directory, "packages/dsh-adapter");
  assert.match(readme, /^# DomainEval Weave$/m);
  assert.match(readme, /Make domain truth executable\./);
  for (const path of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "KIMI.md"]) {
    assert.match(await readFile(`${repositoryRoot}/${path}`, "utf8"), /^# DomainEval Weave/m, path);
  }
});
