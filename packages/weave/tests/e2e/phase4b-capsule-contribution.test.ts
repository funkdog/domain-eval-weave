import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCapsule } from "../../src/capsule/index.js";
import { runCapsuleCli } from "../../src/cli/index.js";

const example = new URL("../../examples/commerce-cancellation/", import.meta.url);

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (text: string) => (stdout += text),
      stderr: (text: string) => (stderr += text),
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

test("public CLI help uses the DomainEval Weave identity", async () => {
  const help = capture();
  assert.equal(await runCapsuleCli(["--help"], help.io), 0);
  assert.match(help.stdout(), /^DomainEval Weave/m);
  assert.doesNotMatch(help.stdout(), /DSH Eval Capsule/);
});

test("a contributor initializes and understands one truth-empty Capsule draft", async () => {
  const parent = await mkdtemp(join(tmpdir(), "phase4b-capsule-init-"));
  const root = join(parent, "returns-policy");
  try {
    const initialized = capture();
    assert.equal(
      await runCapsuleCli(
        ["init", root, "returns-policy", "commerce.returns", "returns-owner"],
        initialized.io,
      ),
      0,
    );
    assert.match(initialized.stdout(), /returns-policy.*draft/s);
    const capsule = await loadCapsule(root);
    assert.equal(capsule.manifest.sources.length, 0);
    assert.equal(capsule.domain.claims.length, 0);
    assert.equal(capsule.requirements.length, 0);
    assert.equal(capsule.evaluators.length, 0);
    assert.equal(capsule.cases.length, 0);
    assert.deepEqual((await readdir(root)).sort(), [
      ".gitignore",
      "README.md",
      "candidates",
      "capsule.yaml",
      "cases",
      "domain.yaml",
      "evaluators",
      "requirements",
      "sources",
    ]);

    const doctor = capture();
    assert.equal(await runCapsuleCli(["doctor", root], doctor.io), 0);
    const readiness = JSON.parse(doctor.stdout()) as {
      readonly stage: string;
      readonly next_actions: readonly { readonly code: string }[];
    };
    assert.equal(readiness.stage, "draft");
    assert.deepEqual(
      readiness.next_actions.map((action) => action.code),
      ["ADD_SOURCE", "ADD_CLAIM", "ADD_REQUIREMENT", "ADD_EVALUATOR", "ADD_CANDIDATE"],
    );

    const shown = capture();
    assert.equal(await runCapsuleCli(["show", root], shown.io), 0);
    assert.match(shown.stdout(), /# Capsule: returns-policy/);
    assert.match(shown.stdout(), /Readiness: draft/);
    assert.match(shown.stdout(), /Confirmed \| 0/);

    const before = await readFile(join(root, "capsule.yaml"), "utf8");
    const duplicate = capture();
    assert.equal(
      await runCapsuleCli(["init", root, "other", "other.domain", "other-owner"], duplicate.io),
      1,
    );
    assert.match(duplicate.stderr(), /non-empty|already exists/i);
    assert.equal(await readFile(join(root, "capsule.yaml"), "utf8"), before);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("qualified calibration advances a complete Capsule to publishable", async () => {
  const parent = await mkdtemp(join(tmpdir(), "phase4b-capsule-ready-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const before = capture();
    assert.equal(await runCapsuleCli(["doctor", root, "commerce-delivery@2.0.0"], before.io), 0);
    assert.equal((JSON.parse(before.stdout()) as { readonly stage: string }).stage, "runnable");

    const calibrated = capture();
    assert.equal(
      await runCapsuleCli(["calibrate", root, "commerce-delivery@2.0.0"], calibrated.io),
      0,
    );
    assert.match(calibrated.stdout(), /qualified.*true/s);
    assert.match(calibrated.stdout(), /\.eval\/calibrations\/[0-9a-f]{64}\.json/);
    assert.equal((await readdir(join(root, ".eval", "calibrations"))).length, 1);

    const after = capture();
    assert.equal(await runCapsuleCli(["doctor", root, "commerce-delivery@2.0.0"], after.io), 0);
    assert.equal((JSON.parse(after.stdout()) as { readonly stage: string }).stage, "publishable");

    const first = capture();
    const second = capture();
    assert.equal(await runCapsuleCli(["show", root], first.io), 0);
    assert.equal(await runCapsuleCli(["show", root], second.io), 0);
    assert.equal(first.stdout(), second.stdout());
    assert.match(first.stdout(), /Readiness: publishable/);
    assert.match(first.stdout(), /Confirmed \| 3/);
    assert.match(first.stdout(), /Conflicted \| 1/);
    assert.match(first.stdout(), /Observability gap \| 1/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
