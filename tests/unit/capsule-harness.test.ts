import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationRun } from "../../packages/weave/src/capsule/index.js";
import { buildHarnessExperimentReport } from "../../packages/weave/src/harness/index.js";

function run(candidateId: string, verdict: "accept" | "reject"): EvaluationRun {
  return {
    schema_version: 1,
    run_id: `run-${candidateId}`,
    capsule_release_sha256: "a".repeat(64),
    requirement_id: "self-service-cancellation",
    evaluator: { evaluator_id: "commerce-delivery", version: "2.0.0" },
    candidate_id: candidateId,
    candidate_sha256: "d".repeat(64),
    measurement_validity: "valid",
    verdict,
    claims: [
      {
        claim_id: "cancel-status",
        axis: "requirement_delta",
        status: verdict === "accept" ? "pass" : "fail",
        check_ids: ["cancel-status"],
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

test("Harness projection compares compatible runs without rewriting Candidate verdicts", () => {
  const control = run("control", "reject");
  const treatment = run("treatment", "accept");
  const report = buildHarnessExperimentReport({
    experimentId: "tdd-cancellation-pair-1",
    control,
    treatment,
    intervention: {
      intervention_id: "mattpocock-tdd",
      control: "disabled",
      treatment: "enabled",
    },
    activation: "activated",
    mechanismValidity: "valid",
    costDelta: { elapsed_ms: 1200, input_tokens: 300, output_tokens: 40 },
  });
  assert.equal(report.control.verdict, "reject");
  assert.equal(report.treatment.verdict, "accept");
  assert.equal(report.effect, "improvement_observed");
  assert.equal(report.claim_strength, "descriptive");
  assert.deepEqual(report.changed_claims, ["cancel-status"]);
});

test("Harness projection rejects arm drift", () => {
  const treatment = {
    ...run("treatment", "accept"),
    capsule_release_sha256: "d".repeat(64),
  };
  assert.throws(() =>
    buildHarnessExperimentReport({
      experimentId: "drifted",
      control: run("control", "reject"),
      treatment,
      intervention: {
        intervention_id: "mattpocock-tdd",
        control: "disabled",
        treatment: "enabled",
      },
      activation: "activated",
      mechanismValidity: "valid",
      costDelta: { elapsed_ms: 0, input_tokens: 0, output_tokens: 0 },
    }),
  );
});
