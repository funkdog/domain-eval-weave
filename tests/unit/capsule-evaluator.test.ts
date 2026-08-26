import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";

import { loadCapsule, previewCapsuleRelease, releaseCapsule } from "../../src/capsule/index.js";
import {
  type CandidateRunner,
  calibrateAndPersistEvaluator,
  calibrateEvaluator,
  compareEvaluators,
  evaluateCandidate,
  findCalibrationReports,
  replayEvaluationRun,
} from "../../src/evaluator/index.js";

const example = new URL("../../examples/capsules/commerce-cancellation/", import.meta.url);

test("Evaluator v2 accepts Gold and equivalents while rejecting targeted mutants", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-evaluator-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const capsule = await loadCapsule(root);
    const release = await releaseCapsule(root);

    const v1 = await calibrateEvaluator({
      capsule,
      release,
      evaluatorRef: "commerce-delivery@1.0.0",
    });
    assert.equal(v1.qualified, false);
    assert.deepEqual(v1.failed_case_ids, ["equivalent-typed-result"]);

    const v2 = await calibrateEvaluator({
      capsule,
      release,
      evaluatorRef: "commerce-delivery@2.0.0",
    });
    assert.equal(v2.qualified, true);
    assert.deepEqual(v2.failed_case_ids, []);

    const gold = await evaluateCandidate({
      capsule,
      release,
      evaluatorRef: "commerce-delivery@2.0.0",
      requirementId: "self-service-cancellation",
      candidateId: "gold",
      persist: true,
    });
    assert.equal(gold.run.verdict, "accept");
    assert.equal(gold.run.measurement_validity, "valid");
    assert.equal(
      gold.run.claims.find((claim) => claim.claim_id === "audit-retention"),
      undefined,
    );

    const mutant = await evaluateCandidate({
      capsule,
      release,
      evaluatorRef: "commerce-delivery@2.0.0",
      requirementId: "self-service-cancellation",
      candidateId: "mutant-double-refund",
      persist: true,
    });
    assert.equal(mutant.run.verdict, "reject");
    assert.equal(
      mutant.run.claims.find((claim) => claim.claim_id === "refund-exactly-once")?.status,
      "fail",
    );

    const replayed = await replayEvaluationRun(root, gold.ref);
    assert.deepEqual(replayed, gold.run);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Evaluator comparison reports the repaired false reject per Claim", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-compare-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const capsule = await loadCapsule(root);
    const release = await releaseCapsule(root);
    const comparison = await compareEvaluators({
      capsule,
      release,
      requirementId: "self-service-cancellation",
      leftEvaluatorRef: "commerce-delivery@1.0.0",
      rightEvaluatorRef: "commerce-delivery@2.0.0",
    });
    assert.deepEqual(comparison.changed_cases, [
      {
        case_id: "equivalent-typed-result",
        claim_changes: [{ claim_id: "cancel-status", left: "fail", right: "pass" }],
      },
    ]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("calibration readiness is bound to one exact Capsule release", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-calibration-release-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const capsule = await loadCapsule(root);
    const release = await releaseCapsule(root);
    const persisted = await calibrateAndPersistEvaluator({
      capsule,
      release,
      evaluatorRef: "commerce-delivery@2.0.0",
    });
    assert.equal(persisted.report.qualified, true);
    assert.equal(
      (
        await findCalibrationReports({
          capsule,
          releaseSha256: release.sha256,
          evaluatorRef: "commerce-delivery@2.0.0",
        })
      ).length,
      1,
    );

    const policy = join(root, "sources", "product-policy.md");
    await writeFile(policy, `${await readFile(policy, "utf8")}\nClarified source.\n`, "utf8");
    const changed = await loadCapsule(root);
    const changedRelease = await previewCapsuleRelease(changed);
    assert.notEqual(changedRelease.sha256, release.sha256);
    assert.equal(
      (
        await findCalibrationReports({
          capsule: changed,
          releaseSha256: changedRelease.sha256,
          evaluatorRef: "commerce-delivery@2.0.0",
        })
      ).length,
      0,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("required unconfirmed Claims remain inconclusive rather than becoming hard failures", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-unconfirmed-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const requirementPath = join(root, "requirements", "self-service-cancellation.yaml");
    const requirement = parse(await readFile(requirementPath, "utf8")) as {
      edges: { claim_id: string; required: boolean }[];
    };
    const proposed = requirement.edges.find((edge) => edge.claim_id === "cancellation-reason-copy");
    assert.ok(proposed);
    proposed.required = true;
    await writeFile(requirementPath, stringify(requirement, { lineWidth: 0 }), "utf8");
    const capsule = await loadCapsule(root);
    const release = await releaseCapsule(root);
    const evaluated = await evaluateCandidate({
      capsule,
      release,
      evaluatorRef: "commerce-delivery@2.0.0",
      requirementId: "self-service-cancellation",
      candidateId: "gold",
      persist: false,
    });
    assert.equal(evaluated.run.verdict, "inconclusive");
    assert.equal(evaluated.run.measurement_validity, "insufficient");
    assert.equal(
      evaluated.run.claims.find((claim) => claim.claim_id === "cancellation-reason-copy")?.status,
      "inconclusive",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("invalid Candidate observation output is measurement error, not Candidate fail", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-invalid-output-"));
  const root = join(parent, "capsule");
  const runner: CandidateRunner = {
    run: async () => ({
      exitCode: 0,
      signal: null,
      stdout: "not-json",
      stderr: "",
      timedOut: false,
      outputLimitExceeded: false,
    }),
  };
  try {
    await cp(example, root, { recursive: true });
    const capsule = await loadCapsule(root);
    const release = await releaseCapsule(root);
    const evaluated = await evaluateCandidate({
      capsule,
      release,
      evaluatorRef: "commerce-delivery@2.0.0",
      requirementId: "self-service-cancellation",
      candidateId: "gold",
      runner,
      persist: false,
    });
    assert.equal(evaluated.run.verdict, "inconclusive");
    assert.equal(evaluated.run.measurement_validity, "invalid");
    assert.ok(evaluated.run.claims.every((claim) => claim.status === "measurement_error"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
