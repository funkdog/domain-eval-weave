import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { EXIT_CODE } from "../../src/app/args.js";
import { DefaultAppExecutor } from "../../src/app/default-executor.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";
import { writeSyntheticDomainPack } from "../helpers/domain-pack-fixture.js";

test("domain validate and impact are deterministic artifact-only commands", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/domain-cli-`);
  try {
    const { manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    let stdout = "";
    const executor = new DefaultAppExecutor({
      cwd: project,
      confirmationLedger,
      stdout: (text) => (stdout += text),
    });
    assert.equal(
      await executor.execute({
        kind: "domain-validate",
        packPath: "domain-eval",
        manifestPath: manifestRef,
      }),
      EXIT_CODE.OK,
    );
    const readiness = JSON.parse(stdout) as { overall: string; claim_strength: string };
    assert.deepEqual(
      { overall: readiness.overall, claim_strength: readiness.claim_strength },
      { overall: "green", claim_strength: "domain_truth_ready" },
    );

    stdout = "";
    assert.equal(
      await executor.execute({
        kind: "domain-impact",
        packPath: "domain-eval",
        manifestPath: manifestRef,
        claimId: "refund-cash-limit",
      }),
      EXIT_CODE.OK,
    );
    assert.deepEqual(JSON.parse(stdout), {
      dependent_claim_ids: [],
      proposed_claim_ids: [],
      requirement_ids: ["order-cancellation-v1", "partial-refund-v1"],
    });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("domain impact returns a distinct non-ready exit for an unknown Claim", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const project = await mkdtemp(`${parent}/domain-cli-red-`);
  try {
    const { manifestRef, confirmationLedger } = await writeSyntheticDomainPack(project);
    let stderr = "";
    const executor = new DefaultAppExecutor({
      cwd: project,
      confirmationLedger,
      stderr: (text) => (stderr += text),
    });
    assert.equal(
      await executor.execute({
        kind: "domain-impact",
        packPath: "domain-eval",
        manifestPath: manifestRef,
        claimId: "missing",
      }),
      EXIT_CODE.DOMAIN_TRUTH_NOT_READY,
    );
    assert.match(stderr, /DOMAIN_TRUTH_NOT_READY/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
