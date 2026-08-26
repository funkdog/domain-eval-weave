import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
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
