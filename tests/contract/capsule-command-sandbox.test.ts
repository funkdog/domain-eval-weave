import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadCapsule } from "../../src/capsule/index.js";
import { SandboxedCommandRunner } from "../../src/evaluator/index.js";

const example = new URL("../../examples/capsules/commerce-cancellation/", import.meta.url);

test("command Candidate cannot read Capsule evaluator or truth inputs", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-sandbox-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    await writeFile(
      join(root, "candidates", "gold", "candidate.mjs"),
      [
        'import { readFile } from "node:fs/promises";',
        'await readFile("../../evaluators/commerce-delivery-v2.yaml", "utf8");',
        'console.log("unexpected");',
      ].join("\n"),
      "utf8",
    );
    const capsule = await loadCapsule(root);
    const candidate = capsule.manifest.candidates.find((entry) => entry.candidate_id === "gold");
    assert.ok(candidate);
    const execution = await new SandboxedCommandRunner().run({ capsule, candidate });
    assert.notEqual(execution.exitCode, 0);
    assert.doesNotMatch(execution.stdout, /commerce-delivery/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("command Candidate receives fresh scratch for sequential and concurrent executions", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-scratch-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    await writeFile(
      join(root, "candidates", "gold", "candidate.mjs"),
      [
        'import { readdir, writeFile } from "node:fs/promises";',
        'import { dirname, join } from "node:path";',
        "const scratch = process.env.TMPDIR;",
        'if (!scratch) throw new Error("missing scratch");',
        'const seen = (await readdir(scratch)).includes("marker");',
        'await writeFile(join(scratch, "marker"), "synthetic", { flag: "wx" });',
        "await new Promise((resolve) => setTimeout(resolve, 50));",
        "let visibleScratchRoots = [];",
        "try {",
        "  visibleScratchRoots = (await readdir(dirname(scratch))).filter((name) =>",
        '    name.startsWith("gold-"),',
        "  );",
        "} catch {}",
        "process.stdout.write(JSON.stringify({ seen, visibleScratchRoots }));",
      ].join("\n"),
      "utf8",
    );
    const capsule = await loadCapsule(root);
    const candidate = capsule.manifest.candidates.find((entry) => entry.candidate_id === "gold");
    assert.ok(candidate);
    const runner = new SandboxedCommandRunner();

    const first = await runner.run({ capsule, candidate });
    const second = await runner.run({ capsule, candidate });
    assert.equal(first.exitCode, 0, first.stderr);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.deepEqual(
      [JSON.parse(first.stdout), JSON.parse(second.stdout)],
      [
        { seen: false, visibleScratchRoots: [] },
        { seen: false, visibleScratchRoots: [] },
      ],
    );

    const concurrent = await Promise.all([
      runner.run({ capsule, candidate }),
      runner.run({ capsule, candidate }),
    ]);
    assert.ok(concurrent.every((execution) => execution.exitCode === 0));
    assert.ok(concurrent.every((execution) => JSON.parse(execution.stdout).seen === false));
    assert.ok(
      concurrent.every(
        (execution) => JSON.parse(execution.stdout).visibleScratchRoots.length === 0,
      ),
    );
    assert.deepEqual(await readdir(join(root, ".eval", "tmp")), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
