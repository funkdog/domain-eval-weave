import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parse, stringify } from "yaml";

import {
  confirmCapsuleClaim,
  initializeCapsule,
  loadCapsule,
  releaseCapsule,
} from "../../src/capsule/index.js";
import {
  calibrateAndPersistEvaluator,
  compareEvaluators,
  evaluateCandidate,
} from "../../src/evaluator/index.js";

const expectedPass = [
  { claim_id: "return-status", status: "pass" },
  { claim_id: "refund-once", status: "pass" },
  { claim_id: "return-idempotent", status: "pass" },
] as const;

export async function buildSyntheticCleanroomSubmission(input: {
  readonly root: string;
  readonly materializedRoot: string;
  readonly labPackageSha256: string;
}) {
  await initializeCapsule({
    root: input.root,
    capsuleId: "returns-cleanroom",
    domainId: "commerce.returns",
    ownerId: "returns-owner",
  });
  const kit = join(input.materializedRoot, "inputs");
  for (const source of ["product-policy.md", "owner-interview.md", "runtime-observation.md"]) {
    await cp(join(kit, "sources", source), join(input.root, "sources", source));
  }
  for (const candidate of ["alpha", "beta", "gamma", "delta", "epsilon"]) {
    await cp(join(kit, "candidate-pool", candidate), join(input.root, "candidates", candidate), {
      recursive: true,
    });
  }

  const manifestPath = join(input.root, "capsule.yaml");
  const manifest = parse(await readFile(manifestPath, "utf8"));
  manifest.sources = [
    {
      source_id: "policy",
      kind: "product_doc",
      path: "sources/product-policy.md",
      description: "Synthetic return policy supplied by the clean-room kit.",
      license: "CC0-1.0",
    },
    {
      source_id: "interview",
      kind: "owner_statement",
      path: "sources/owner-interview.md",
      description: "Synthetic owner interview supplied by the clean-room kit.",
      license: "CC0-1.0",
    },
    {
      source_id: "runtime",
      kind: "runtime_observation",
      path: "sources/runtime-observation.md",
      description: "Synthetic observation boundary supplied by the clean-room kit.",
      license: "CC0-1.0",
    },
  ];
  await writeFile(manifestPath, stringify(manifest, { lineWidth: 0 }), "utf8");

  await writeFile(
    join(input.root, "domain.yaml"),
    stringify(
      {
        schema_version: 1,
        domain_id: "commerce.returns",
        version: "1.0.0",
        owners: [{ owner_id: "returns-owner", display_name: "Returns owner" }],
        claims: [
          {
            claim_id: "return-status",
            statement: "An accepted eligible return exposes return_accepted.",
            applicability: "Delivered consumer orders requested within 14 calendar days.",
            status: "proposed",
            source_ids: ["policy"],
            false_accept_risk: "critical",
            false_reject_risk: "high",
          },
          {
            claim_id: "refund-once",
            statement: "An accepted eligible return requests exactly one refund.",
            applicability: "Delivered consumer orders requested within 14 calendar days.",
            status: "proposed",
            source_ids: ["policy"],
            false_accept_risk: "critical",
            false_reject_risk: "medium",
          },
          {
            claim_id: "return-idempotent",
            statement: "Retrying an accepted return replays it without another refund.",
            applicability: "The same order and request id.",
            status: "proposed",
            source_ids: ["interview", "runtime"],
            false_accept_risk: "critical",
            false_reject_risk: "medium",
          },
          {
            claim_id: "opened-package-policy",
            statement: "Opened packages are accepted without inspection.",
            applicability: "Opened packages in the return window.",
            status: "conflicted",
            source_ids: ["policy", "interview"],
            conflict_source_ids: ["policy", "interview"],
            false_accept_risk: "high",
            false_reject_risk: "high",
          },
          {
            claim_id: "audit-retention",
            statement: "Return audit evidence is retained for 90 days.",
            applicability: "Every return request.",
            status: "observability_gap",
            source_ids: ["runtime"],
            false_accept_risk: "high",
            false_reject_risk: "medium",
          },
        ],
      },
      { lineWidth: 0 },
    ),
    "utf8",
  );
  for (const claimId of ["return-status", "refund-once", "return-idempotent"]) {
    await confirmCapsuleClaim({ root: input.root, claimId, ownerId: "returns-owner" });
  }

  const requirementPath = "requirements/eligible-return.yaml";
  const evaluatorV1Path = "evaluators/returns-delivery-v1.yaml";
  const evaluatorV2Path = "evaluators/returns-delivery-v2.yaml";
  const cases = [
    ["alpha", "gold", undefined, expectedPass],
    ["beta", "equivalent", undefined, expectedPass],
    [
      "gamma",
      "mutant",
      ["return-status"],
      expectedPass.map((entry) =>
        entry.claim_id === "return-status" ? { ...entry, status: "fail" } : entry,
      ),
    ],
    [
      "delta",
      "mutant",
      ["refund-once"],
      expectedPass.map((entry) =>
        entry.claim_id === "refund-once" ? { ...entry, status: "fail" } : entry,
      ),
    ],
    [
      "epsilon",
      "mutant",
      ["return-idempotent"],
      expectedPass.map((entry) =>
        entry.claim_id === "return-idempotent" ? { ...entry, status: "fail" } : entry,
      ),
    ],
  ] as const;
  await writeFile(
    join(input.root, requirementPath),
    stringify(
      {
        schema_version: 1,
        requirement_id: "eligible-return",
        version: "1.0.0",
        title: "Accept an eligible customer return",
        source_ids: ["policy", "interview"],
        edges: [
          { claim_id: "return-status", relation: "uses", required: true },
          { claim_id: "refund-once", relation: "uses", required: true },
          { claim_id: "return-idempotent", relation: "preserves", required: true },
          { claim_id: "opened-package-policy", relation: "conflicts_with", required: false },
          { claim_id: "audit-retention", relation: "preserves", required: false },
        ],
      },
      { lineWidth: 0 },
    ),
    "utf8",
  );
  const commonChecks = [
    {
      check_id: "return-status",
      claim_id: "return-status",
      kind: "json_path_equals",
      path: ["state", "status"],
      expected: "return_accepted",
    },
    {
      check_id: "refund-count",
      claim_id: "refund-once",
      kind: "json_array_count_equals",
      path: ["effects"],
      where: { type: "refund_requested" },
      expected_count: 1,
    },
    {
      check_id: "repeat-refund-count",
      claim_id: "return-idempotent",
      kind: "json_array_count_equals",
      path: ["repeat", "effects"],
      where: { type: "refund_requested" },
      expected_count: 0,
    },
    {
      check_id: "replay-observed",
      claim_id: "return-idempotent",
      kind: "json_path_equals",
      path: ["repeat", "status"],
      expected: "replayed",
    },
  ];
  await writeFile(
    join(input.root, evaluatorV1Path),
    stringify(
      {
        schema_version: 1,
        evaluator_id: "returns-delivery",
        version: "1.0.0",
        requirement_id: "eligible-return",
        checks: [
          ...commonChecks,
          {
            check_id: "implementation-transport",
            claim_id: "return-status",
            kind: "json_path_equals",
            path: ["transport"],
            expected: "throw",
          },
        ],
      },
      { lineWidth: 0 },
    ),
    "utf8",
  );
  await writeFile(
    join(input.root, evaluatorV2Path),
    stringify(
      {
        schema_version: 1,
        evaluator_id: "returns-delivery",
        version: "2.0.0",
        requirement_id: "eligible-return",
        checks: commonChecks,
      },
      { lineWidth: 0 },
    ),
    "utf8",
  );
  for (const [candidateId, kind, targets, expectedClaims] of cases) {
    await writeFile(
      join(input.root, "cases", `${candidateId}.yaml`),
      stringify(
        {
          schema_version: 1,
          case_id: candidateId,
          kind,
          candidate_id: candidateId,
          ...(targets === undefined ? {} : { target_claim_ids: targets }),
          expected_claims: expectedClaims,
        },
        { lineWidth: 0 },
      ),
      "utf8",
    );
  }
  manifest.requirements = [requirementPath];
  manifest.evaluators = [evaluatorV1Path, evaluatorV2Path];
  manifest.candidates = ["alpha", "beta", "gamma", "delta", "epsilon"].map((candidateId) => ({
    candidate_id: candidateId,
    path: `candidates/${candidateId}`,
    command: ["node", "candidate.mjs"],
  }));
  manifest.cases = cases.map(([candidateId]) => `cases/${candidateId}.yaml`);
  await writeFile(manifestPath, stringify(manifest, { lineWidth: 0 }), "utf8");

  const capsule = await loadCapsule(input.root);
  const release = await releaseCapsule(input.root);
  const calibration = await calibrateAndPersistEvaluator({
    capsule,
    release,
    evaluatorRef: "returns-delivery@2.0.0",
  });
  await compareEvaluators({
    capsule,
    release,
    requirementId: "eligible-return",
    leftEvaluatorRef: "returns-delivery@1.0.0",
    rightEvaluatorRef: "returns-delivery@2.0.0",
  });
  const run = await evaluateCandidate({
    capsule,
    release,
    evaluatorRef: "returns-delivery@2.0.0",
    requirementId: "eligible-return",
    candidateId: "alpha",
    persist: true,
  });
  const receipt = {
    schema_version: 1,
    kit_id: "phase4b-contributor-v1",
    participant_id: "synthetic-test-participant",
    observer_id: "synthetic-test-observer",
    participant_prior_experience: "none",
    oral_help_received: false,
    repository_source_read: false,
    compare_completed: true,
    started_at: "2026-08-27T00:00:00.000Z",
    completed_at: "2026-08-27T01:00:00.000Z",
    lab_package_sha256: input.labPackageSha256,
    capsule_release_sha256: release.sha256,
    calibration_ref: calibration.ref,
    run_ref: run.ref,
    observer_attestation: "observed_no_oral_help",
    notes: "Synthetic positive verifier contract test; never external acceptance evidence.",
  };
  const receiptPath = join(input.root, "..", "synthetic-positive-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");
  return { receiptPath };
}
