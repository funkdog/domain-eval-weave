import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("open-source governance and CI have one explicit license gate", async () => {
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
  const legacyInitializer = await readFile(
    `${repositoryRoot}/scripts/initialize-legacy-ci-runtime.mjs`,
    "utf8",
  );
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /bubblewrap/);
  assert.match(workflow, /Initialize isolated legacy runtime/);
  assert.match(workflow, /sudo install -d -m 700/);
  assert.match(workflow, /dsh-eval-lab-runtime\/dsh-home/);
  assert.match(legacyInitializer, /ensurePhase2InstanceLayout/);
  assert.match(workflow, /apparmor_restrict_unprivileged_userns/);
  assert.match(workflow, /pnpm test:portable/);
  assert.match(workflow, /runner\.os != 'Linux'[\s\S]*pnpm test/);
  assert.match(workflow, /initialize-legacy-ci-runtime\.mjs/);
  assert.match(workflow, /runner\.os == 'Linux'[\s\S]*pnpm test:portable/);
  assert.equal(
    (
      JSON.parse(await readFile(`${repositoryRoot}/package.json`, "utf8")) as {
        readonly scripts?: Readonly<Record<string, unknown>>;
      }
    ).scripts?.["test:portable"],
    "node --import tsx --test --test-concurrency=1 tests/unit/canonical-json.test.ts tests/unit/capsule-*.test.ts tests/contract/capsule-*.test.ts tests/contract/phase4b-*.test.ts tests/e2e/capsule-cli.test.ts tests/e2e/phase4b-*.test.ts",
  );

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
  assert.equal(report.developer_preview_ready, false);
  assert.equal(report.public_alpha_ready, false);
  assert.deepEqual(report.blockers, ["REMOTE_CI_PENDING", "HUMAN_CLEANROOM_PENDING"]);
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
