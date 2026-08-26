import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCalibrationCase,
  parseCapsuleDomain,
  parseCapsuleManifest,
  parseEvaluationRun,
  parseEvaluatorPackage,
  parseRequirementDelta,
} from "../../src/capsule/index.js";

const source = {
  source_id: "policy",
  kind: "product_doc",
  path: "sources/policy.md",
};

test("Capsule v0 exposes six strict public contracts", () => {
  const manifest = parseCapsuleManifest({
    schema_version: 1,
    capsule_id: "commerce-cancellation",
    version: "1.0.0",
    title: "Commerce cancellation",
    domain: "domain.yaml",
    sources: [source],
    requirements: ["requirements/cancellation.yaml"],
    evaluators: ["evaluators/v1.yaml"],
    candidates: [
      {
        candidate_id: "gold",
        path: "candidates/gold",
        command: ["node", "candidate.mjs"],
      },
    ],
    cases: ["cases/gold.yaml"],
  });
  assert.equal(manifest.capsule_id, "commerce-cancellation");

  const domain = parseCapsuleDomain({
    schema_version: 1,
    domain_id: "commerce.orders",
    version: "1.0.0",
    owners: [{ owner_id: "commerce-owner", display_name: "Commerce owner" }],
    claims: [
      {
        claim_id: "cancel-status",
        statement: "Accepted cancellation ends in cancelled state.",
        applicability: "Paid orders before fulfillment.",
        status: "confirmed",
        source_ids: ["policy"],
        false_accept_risk: "high",
        false_reject_risk: "medium",
        confirmation: {
          owner_id: "commerce-owner",
          projection_sha256: "a".repeat(64),
        },
      },
    ],
  });
  assert.equal(domain.claims[0]?.status, "confirmed");

  const requirement = parseRequirementDelta({
    schema_version: 1,
    requirement_id: "self-service-cancellation",
    version: "1.0.0",
    title: "Self-service cancellation",
    source_ids: ["policy"],
    edges: [{ claim_id: "cancel-status", relation: "uses", required: true }],
  });
  assert.equal(requirement.edges[0]?.required, true);

  const evaluator = parseEvaluatorPackage({
    schema_version: 1,
    evaluator_id: "commerce-delivery",
    version: "1.0.0",
    requirement_id: "self-service-cancellation",
    checks: [
      {
        check_id: "cancel-status",
        claim_id: "cancel-status",
        kind: "json_path_equals",
        path: ["state", "status"],
        expected: "cancelled",
      },
    ],
  });
  assert.equal(evaluator.checks[0]?.kind, "json_path_equals");

  const calibrationCase = parseCalibrationCase({
    schema_version: 1,
    case_id: "gold",
    kind: "gold",
    candidate_id: "gold",
    expected_claims: [{ claim_id: "cancel-status", status: "pass" }],
  });
  assert.equal(calibrationCase.kind, "gold");

  const run = parseEvaluationRun({
    schema_version: 1,
    run_id: "run-1",
    capsule_release_sha256: "b".repeat(64),
    requirement_id: "self-service-cancellation",
    evaluator: { evaluator_id: "commerce-delivery", version: "1.0.0" },
    candidate_id: "gold",
    candidate_sha256: "e".repeat(64),
    measurement_validity: "valid",
    verdict: "accept",
    claims: [
      {
        claim_id: "cancel-status",
        axis: "requirement_delta",
        status: "pass",
        check_ids: ["cancel-status"],
        diagnostics: [],
      },
    ],
    execution: {
      exit_code: 0,
      signal: null,
      stdout_sha256: "c".repeat(64),
      stderr_sha256: "d".repeat(64),
      timed_out: false,
      output_limit_exceeded: false,
    },
    diagnostics: [],
  });
  assert.equal(run.verdict, "accept");
});

test("Claim authority and conflict semantics fail closed", () => {
  const base = {
    schema_version: 1,
    domain_id: "commerce.orders",
    version: "1.0.0",
    owners: [{ owner_id: "commerce-owner", display_name: "Commerce owner" }],
  };
  assert.throws(() =>
    parseCapsuleDomain({
      ...base,
      claims: [
        {
          claim_id: "missing-confirmation",
          statement: "A confirmed claim.",
          applicability: "Always.",
          status: "confirmed",
          source_ids: ["policy"],
          false_accept_risk: "high",
          false_reject_risk: "low",
        },
      ],
    }),
  );
  assert.throws(() =>
    parseCapsuleDomain({
      ...base,
      claims: [
        {
          claim_id: "missing-conflict",
          statement: "A conflicted claim.",
          applicability: "Always.",
          status: "conflicted",
          source_ids: ["policy", "interview"],
          false_accept_risk: "high",
          false_reject_risk: "low",
        },
      ],
    }),
  );
  assert.throws(() =>
    parseCapsuleManifest({
      schema_version: 1,
      capsule_id: "x",
      version: "1",
      title: "x",
      domain: "domain.yaml",
      sources: [source],
      requirements: [],
      evaluators: [],
      candidates: [],
      cases: [],
      unexpected: true,
    }),
  );
});
