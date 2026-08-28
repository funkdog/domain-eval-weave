import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EvaluationRun } from "../../packages/weave/src/capsule/index.js";
import { loadCapsule, releaseCapsule } from "../../packages/weave/src/capsule/index.js";
import {
  evaluateAndProjectDshTddHarnessExperiment,
  projectDshTddHarnessExperiment,
} from "../../src/adapters/index.js";

const example = new URL("../../examples/capsules/commerce-cancellation/", import.meta.url);

function run(candidateId: string, status: "fail" | "pass"): EvaluationRun {
  return {
    schema_version: 1,
    run_id: `run-${candidateId}`,
    capsule_release_sha256: "a".repeat(64),
    requirement_id: "self-service-cancellation",
    evaluator: { evaluator_id: "commerce-delivery", version: "2.0.0" },
    candidate_id: candidateId,
    candidate_sha256: candidateId === "control" ? "d".repeat(64) : "e".repeat(64),
    measurement_validity: "valid",
    verdict: status === "pass" ? "accept" : "reject",
    claims: [
      {
        claim_id: "cancel-status",
        axis: "requirement_delta",
        status,
        check_ids: ["cancelled-status"],
        diagnostics: [],
      },
    ],
    execution: {
      exit_code: 0,
      signal: null,
      stdout_sha256: "b".repeat(64),
      stderr_sha256: "c".repeat(64),
      timed_out: false,
      output_limit_exceeded: false,
    },
    diagnostics: [],
  };
}

test("DSH adapter projects typed TDD evidence over Capsule Candidate Evaluations", () => {
  const projected = projectDshTddHarnessExperiment({
    experimentId: "phase4a-dsh-pair",
    task: {
      schema_version: 1,
      task_id: "commerce-cancellation-capsule",
      bucket: "TDD-suitable",
      preconfirmed_test_seams: ["OrderService.cancelOrder"],
      allowed_test_roots: ["test/public"],
      allowed_production_roots: ["src"],
    },
    control: run("control", "fail"),
    treatment: run("treatment", "pass"),
    controlEvents: [],
    treatmentEvents: [
      { seq: 1, type: "skill_loaded", skill_id: "mattpocock-tdd" },
      { seq: 2, type: "file_write", path: "test/public/cancel.test.ts" },
      { seq: 3, type: "test_run", scope: "focused", exit_code: 1 },
      { seq: 4, type: "file_write", path: "src/order-service.ts" },
      { seq: 5, type: "test_run", scope: "focused", exit_code: 0 },
      { seq: 6, type: "test_run", scope: "full", exit_code: 0 },
    ],
    controlCost: { elapsed_ms: 5_000, input_tokens: 1_000, output_tokens: 200 },
    treatmentCost: { elapsed_ms: 6_200, input_tokens: 1_300, output_tokens: 240 },
  });
  assert.equal(projected.mechanism.control.activation, "not_activated");
  assert.equal(projected.mechanism.treatment.activation, "activated");
  assert.equal(projected.report.effect, "improvement_observed");
  assert.deepEqual(projected.report.cost_delta, {
    elapsed_ms: 1_200,
    input_tokens: 300,
    output_tokens: 40,
  });
});

test("DSH adapter evaluates external frozen observations through the same Capsule/Evaluator", async () => {
  const parent = await mkdtemp(join(tmpdir(), "dsh-capsule-dsh-adapter-"));
  const root = join(parent, "capsule");
  try {
    await cp(example, root, { recursive: true });
    const capsule = await loadCapsule(root);
    const release = await releaseCapsule(capsule.root);
    const common = {
      state: { status: "cancelled" },
      effects: [{ type: "refund_requested", order_id: "order-1" }],
      repeat: { status: "replayed", effects: [] },
    };
    const projected = await evaluateAndProjectDshTddHarnessExperiment({
      experimentId: "phase4a-observed-dsh-pair",
      capsule,
      release,
      requirementId: "self-service-cancellation",
      evaluatorRef: "commerce-delivery@2.0.0",
      task: {
        schema_version: 1,
        task_id: "commerce-cancellation-capsule",
        bucket: "TDD-suitable",
        preconfirmed_test_seams: ["OrderService.cancelOrder"],
        allowed_test_roots: ["test/public"],
        allowed_production_roots: ["src"],
      },
      control: {
        candidateId: "dsh-control-frozen",
        candidateSha256: "f".repeat(64),
        observation: { ...common, state: { status: "paid" } },
        events: [],
        cost: { elapsed_ms: 5_000, input_tokens: null, output_tokens: null },
      },
      treatment: {
        candidateId: "dsh-treatment-frozen",
        candidateSha256: "e".repeat(64),
        observation: common,
        events: [
          { seq: 1, type: "skill_loaded", skill_id: "mattpocock-tdd" },
          { seq: 2, type: "file_write", path: "test/public/cancel.test.ts" },
          { seq: 3, type: "test_run", scope: "focused", exit_code: 1 },
          { seq: 4, type: "file_write", path: "src/order-service.ts" },
          { seq: 5, type: "test_run", scope: "focused", exit_code: 0 },
          { seq: 6, type: "test_run", scope: "full", exit_code: 0 },
        ],
        cost: { elapsed_ms: 6_200, input_tokens: null, output_tokens: null },
      },
    });
    assert.equal(projected.controlRun.verdict, "reject");
    assert.equal(projected.treatmentRun.verdict, "accept");
    assert.equal(projected.report.effect, "improvement_observed");
    assert.deepEqual(projected.report.cost_delta, {
      elapsed_ms: 1_200,
      input_tokens: null,
      output_tokens: null,
    });
    assert.equal(projected.controlRun.capsule_release_sha256, release.sha256);
    assert.equal(projected.treatmentRun.evaluator.version, "2.0.0");
    assert.equal((await readdir(join(root, ".eval", "runs"))).length, 2);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
