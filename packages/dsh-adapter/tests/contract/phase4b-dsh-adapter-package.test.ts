import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const adapterRoot = join(repositoryRoot, "packages/dsh-adapter");

test("DSH adapter owns TDD projection without importing Phase 3C", async () => {
  const manifest = JSON.parse(await readFile(join(adapterRoot, "package.json"), "utf8")) as {
    readonly name?: unknown;
    readonly dependencies?: unknown;
    readonly license?: unknown;
  };
  assert.equal(manifest.name, "@domaineval/dsh-adapter");
  assert.equal(manifest.license, "Apache-2.0");
  assert.deepEqual(manifest.dependencies, {
    "@domaineval/weave": "workspace:*",
    zod: "4.4.3",
  });
  const sourceFiles = (await readdir(join(adapterRoot, "src"), { recursive: true })).filter(
    (entry) => entry.endsWith(".ts"),
  );
  for (const file of sourceFiles) {
    assert.doesNotMatch(
      await readFile(join(adapterRoot, "src", file), "utf8"),
      /(?:from|import).*phase3c/i,
    );
  }
  assert.match(
    await readFile(join(repositoryRoot, "legacy/dsh-eval-lab/src/phase3c/tdd-binding.ts"), "utf8"),
    /packages\/dsh-adapter\/dist\/tdd/,
  );

  const pnpmCli = process.env.npm_execpath;
  assert.ok(pnpmCli);
  await execFileAsync(process.execPath, [pnpmCli, "build:packages"], { cwd: repositoryRoot });
  const adapter = await import(pathToFileURL(join(adapterRoot, "dist/index.js")).href);
  assert.equal(typeof adapter.projectRawDshTddEvents, "function");
  assert.equal(typeof adapter.projectTddMechanism, "function");
  assert.equal(typeof adapter.evaluateAndProjectDshTddHarnessExperiment, "function");

  const scratch = await mkdtemp(join(tmpdir(), "phase4b-adapter-pack-"));
  try {
    await execFileAsync(process.execPath, [pnpmCli, "pack", "--pack-destination", scratch], {
      cwd: adapterRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    const archive = (await readdir(scratch)).find((entry) => entry.endsWith(".tgz"));
    assert.ok(archive);
    const listing = (
      await execFileAsync("/usr/bin/tar", ["-tzf", join(scratch, archive)], {
        maxBuffer: 32 * 1024 * 1024,
      })
    ).stdout;
    assert.match(listing, /package\/dist\/tdd\.js/);
    assert.match(listing, /package\/LICENSE/);
    assert.doesNotMatch(listing, /phase3c|task-packs|runtime-profile|contracts\//i);
    const unpacked = join(scratch, "unpacked");
    await mkdir(unpacked, { mode: 0o700 });
    await execFileAsync("/usr/bin/tar", ["-xzf", join(scratch, archive), "-C", unpacked]);
    const packedManifest = JSON.parse(
      await readFile(join(unpacked, "package/package.json"), "utf8"),
    ) as { readonly dependencies?: unknown; readonly license?: unknown };
    assert.equal(packedManifest.license, "Apache-2.0");
    assert.deepEqual(packedManifest.dependencies, {
      "@domaineval/weave": "0.1.0-alpha.0",
      zod: "4.4.3",
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
