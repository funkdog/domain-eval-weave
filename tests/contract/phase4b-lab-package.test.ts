import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const labRoot = join(repositoryRoot, "packages/lab");

test("@domaineval/weave packs one importable no-DSH public closure", async () => {
  const manifest = JSON.parse(await readFile(join(labRoot, "package.json"), "utf8")) as {
    readonly name?: unknown;
    readonly bin?: unknown;
    readonly dependencies?: unknown;
    readonly license?: unknown;
    readonly exports?: Readonly<Record<string, unknown>>;
  };
  assert.equal(manifest.name, "@domaineval/weave");
  assert.deepEqual(manifest.bin, { "domain-eval": "./bin/domain-eval.mjs" });
  assert.equal(manifest.license, "Apache-2.0");
  assert.deepEqual(manifest.dependencies, { yaml: "2.9.0", zod: "4.4.3" });
  assert.ok(manifest.exports?.["./canonical-json"]);
  assert.equal(manifest.exports?.["./internal/canonical-json"], undefined);

  const scratch = await mkdtemp(join(tmpdir(), "phase4b-lab-pack-"));
  try {
    const pnpmCli = process.env.npm_execpath;
    assert.ok(pnpmCli);
    await execFileAsync(process.execPath, [pnpmCli, "pack", "--pack-destination", scratch], {
      cwd: labRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    const archive = (await readdir(scratch)).find((entry) => entry.endsWith(".tgz"));
    assert.ok(archive);
    const listing = (
      await execFileAsync("/usr/bin/tar", ["-tzf", join(scratch, archive)], {
        maxBuffer: 32 * 1024 * 1024,
      })
    ).stdout
      .split("\n")
      .filter(Boolean);
    assert.ok(listing.some((entry) => entry.endsWith("dist/index.js")));
    assert.ok(listing.includes("package/LICENSE"));
    assert.ok(listing.some((entry) => entry.includes("contracts/capsule-manifest.schema.json")));
    assert.ok(
      listing.some((entry) => entry.includes("examples/commerce-cancellation/capsule.yaml")),
    );
    for (const entry of listing) {
      assert.doesNotMatch(
        entry,
        /phase3c|commerce-withdrawal|task-packs|runtime-profile|registry|skills\/|author-|dsh-session/i,
      );
    }

    const unpacked = join(scratch, "unpacked");
    await mkdir(unpacked, { mode: 0o700 });
    await execFileAsync("/usr/bin/tar", ["-xzf", join(scratch, archive), "-C", unpacked]);
    const packageRoot = join(unpacked, "package");
    assert.equal(
      (
        JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
          readonly license?: unknown;
        }
      ).license,
      "Apache-2.0",
    );
    await execFileAsync(process.execPath, [pnpmCli, "install", "--ignore-scripts"], {
      cwd: packageRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    const api = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
    assert.equal(typeof api.loadCapsule, "function");
    assert.equal(typeof api.calibrateEvaluator, "function");
    assert.equal(typeof api.buildHarnessExperimentReport, "function");

    const validation = await execFileAsync(
      process.execPath,
      [
        join(packageRoot, "bin/domain-eval.mjs"),
        "validate",
        join(packageRoot, "dist/examples/commerce-cancellation"),
      ],
      { cwd: packageRoot },
    );
    assert.equal((JSON.parse(validation.stdout) as { readonly status?: unknown }).status, "valid");

    const emitted = (await readdir(join(packageRoot, "dist"), { recursive: true }))
      .filter((entry) => entry.endsWith(".js") || entry.endsWith(".d.ts"))
      .map((entry) => join(packageRoot, "dist", entry));
    for (const path of emitted) {
      const source = await readFile(path, "utf8");
      assert.doesNotMatch(source, /@deepseek-ai|src\/phase3c|commerce-withdrawal/);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
