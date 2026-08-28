import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const weaveRoot = join(repositoryRoot, "packages/weave");

test("packed Weave completes the contributor and replay journey without repository imports", async () => {
  const pnpmCli = process.env.npm_execpath;
  assert.ok(pnpmCli);
  const scratch = await mkdtemp(join(tmpdir(), "phase4b-cleanroom-"));
  try {
    const packRoot = join(scratch, "pack");
    await mkdir(packRoot, { mode: 0o700 });
    await execFileAsync(process.execPath, [pnpmCli, "pack", "--pack-destination", packRoot], {
      cwd: weaveRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    const archive = (await readdir(packRoot)).find((entry) => entry.endsWith(".tgz"));
    assert.ok(archive);
    const consumer = join(scratch, "consumer");
    await mkdir(consumer, { mode: 0o700 });
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify(
        {
          name: "phase4b-cleanroom-consumer",
          private: true,
          type: "module",
          dependencies: { "@domaineval/weave": `file:${join(packRoot, archive)}` },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await execFileAsync(process.execPath, [pnpmCli, "install", "--ignore-scripts"], {
      cwd: consumer,
      maxBuffer: 32 * 1024 * 1024,
    });
    const installed = join(consumer, "node_modules/@domaineval/weave");
    const installedManifest = JSON.parse(
      await readFile(join(installed, "package.json"), "utf8"),
    ) as {
      readonly dependencies?: unknown;
    };
    assert.deepEqual(installedManifest.dependencies, { yaml: "2.9.0", zod: "4.4.3" });
    const binary = join(installed, "bin/domain-eval.mjs");

    const draft = join(consumer, "returns-policy");
    const initialized = await execFileAsync(
      process.execPath,
      [binary, "init", draft, "returns-policy", "commerce.returns", "returns-owner"],
      { cwd: consumer },
    );
    assert.equal((JSON.parse(initialized.stdout) as { readonly stage?: unknown }).stage, "draft");
    const draftDoctor = await execFileAsync(process.execPath, [binary, "doctor", draft], {
      cwd: consumer,
    });
    assert.equal((JSON.parse(draftDoctor.stdout) as { readonly stage?: unknown }).stage, "draft");

    const capsule = join(consumer, "commerce-cancellation");
    await cp(join(installed, "dist/examples/commerce-cancellation"), capsule, { recursive: true });
    const before = await execFileAsync(
      process.execPath,
      [binary, "doctor", capsule, "commerce-delivery@2.0.0"],
      { cwd: consumer },
    );
    assert.equal((JSON.parse(before.stdout) as { readonly stage?: unknown }).stage, "runnable");
    await execFileAsync(
      process.execPath,
      [binary, "calibrate", capsule, "commerce-delivery@2.0.0"],
      { cwd: consumer, maxBuffer: 32 * 1024 * 1024 },
    );
    const after = await execFileAsync(
      process.execPath,
      [binary, "doctor", capsule, "commerce-delivery@2.0.0"],
      { cwd: consumer },
    );
    assert.equal((JSON.parse(after.stdout) as { readonly stage?: unknown }).stage, "publishable");
    const comparison = await execFileAsync(
      process.execPath,
      [
        binary,
        "compare",
        capsule,
        "self-service-cancellation",
        "commerce-delivery@1.0.0",
        "commerce-delivery@2.0.0",
      ],
      { cwd: consumer, maxBuffer: 32 * 1024 * 1024 },
    );
    assert.match(comparison.stdout, /equivalent-typed-result/);
    const evaluated = await execFileAsync(
      process.execPath,
      [binary, "run", capsule, "self-service-cancellation", "commerce-delivery@2.0.0", "gold"],
      { cwd: consumer, maxBuffer: 32 * 1024 * 1024 },
    );
    const run = JSON.parse(evaluated.stdout) as {
      readonly ref: string;
      readonly run: { readonly run_id: string; readonly verdict: string };
    };
    assert.equal(run.run.verdict, "accept");
    const replayed = await execFileAsync(process.execPath, [binary, "replay", capsule, run.ref], {
      cwd: consumer,
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(
      (JSON.parse(replayed.stdout) as { readonly run_id?: unknown }).run_id,
      run.run.run_id,
    );

    const emitted = (await readdir(join(installed, "dist"), { recursive: true }))
      .filter((entry) => entry.endsWith(".js") || entry.endsWith(".d.ts"))
      .map((entry) => join(installed, "dist", entry));
    for (const path of emitted) {
      const source = await readFile(path, "utf8");
      assert.doesNotMatch(source, /dsh-eval-lab-phase4b|@deepseek-ai\/dsh-session/);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
