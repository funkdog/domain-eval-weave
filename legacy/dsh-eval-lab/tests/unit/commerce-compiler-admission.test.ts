import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCommerceGraderAdmission } from "../../src/commerce/admission.js";
import { parseCommerceObservationCatalog } from "../../src/commerce/catalog.js";
import { compileCommerceGrader } from "../../src/commerce/compiler.js";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import type { ValidatedDomainPack } from "../../src/domain/pack.js";
import { calibrateCommercePackDetailed } from "../../src/oracle/commerce-calibration.js";
import { COMMERCE_BEHAVIORS, CommerceOrderOracle } from "../../src/oracle/commerce-order.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v1", import.meta.url),
);
const catalog = parseCommerceObservationCatalog(
  JSON.parse(readFileSync(`${packRoot}/claim-observation-catalog.json`, "utf8")),
);
const digest = (character: string) => character.repeat(64);

function observation(index: number) {
  const entry = catalog.behaviors[index];
  assert.ok(entry);
  return {
    source_id: `commerce-observation-${entry.behavior_id}`,
    kind: "test" as const,
    artifact_ref: "sources/commerce-order-observation-catalog.json",
    digest: canonicalJsonDigest(entry),
    locator: `/behaviors/${index}`,
  };
}

function validatedCommercePack(): ValidatedDomainPack {
  const claimInputs = [
    {
      claimId: "order-cancellation-eligibility",
      domainId: "order-lifecycle",
      statement: "Cancellation eligibility depends on payment and shipment state.",
      observations: [0, 2],
      risk: "critical" as const,
    },
    {
      claimId: "refund-settlement-contract",
      domainId: "payments",
      statement: "Refund requests use paid amount and remain separate from cancellation.",
      observations: [1, 3],
      risk: "critical" as const,
    },
    {
      claimId: "inventory-release-once",
      domainId: "inventory",
      statement: "Inventory reservation releases exactly once after cancellation.",
      observations: [4],
      risk: "high" as const,
    },
    {
      claimId: "coupon-restoration-policy",
      domainId: "promotions",
      statement: "Only currently eligible coupons are restored.",
      observations: [5],
      risk: "high" as const,
    },
    {
      claimId: "customer-order-ownership",
      domainId: "authorization",
      statement: "Only an order owner can request cancellation.",
      observations: [6],
      risk: "critical" as const,
    },
    {
      claimId: "cancellation-durability-audit",
      domainId: "reliability",
      statement: "Cancellation, effects, request identity, and audit survive restart.",
      observations: [7],
      risk: "critical" as const,
    },
  ];
  const contract = {
    schema_version: 1 as const,
    contract_id: "commerce-order-contract",
    product_id: "synthetic-commerce",
    version: 1,
    source_interview: { ref: "interviews/commerce/r1.json", sha256: digest("1") },
    source_snapshot_digest: digest("2"),
    claims: claimInputs.map((input, index) => ({
      claim_id: input.claimId,
      domain_id: input.domainId,
      statement: input.statement,
      applicability: "Synthetic self-service order cancellation.",
      evidence_card: { ref: `evidence-cards/${input.claimId}/r1.json`, sha256: digest("3") },
      authority_refs: [
        {
          source_id: `owner-${input.claimId}`,
          kind: "owner_statement" as const,
          artifact_ref: "sources/owner-policy.md",
          digest: digest(String((index % 6) + 4)),
        },
      ],
      observation_refs: input.observations.map(observation),
      false_accept_risk: input.risk,
      false_reject_risk: "medium" as const,
      dependencies: [],
      lifecycle: "active" as const,
    })),
    state: "issued" as const,
    confirmation: { confirmation_id: "confirm-commerce-contract", sha256: digest("a") },
    decided_by: "commerce-domain-owner",
    decided_at: "2026-08-21T00:00:00.000Z",
  };
  const contractPointer = {
    ref: "contracts/commerce-order-contract/v1.json",
    sha256: canonicalJsonDigest(contract),
  };
  const requirement = {
    schema_version: 1 as const,
    requirement_id: "self-service-order-cancellation",
    version: 1,
    product_id: "synthetic-commerce",
    requirement_refs: [
      {
        source_id: "requirement-self-service-cancellation",
        kind: "requirement" as const,
        artifact_ref: "sources/self-service-cancellation.md",
        digest: digest("b"),
      },
    ],
    base_contract: contractPointer,
    effects: {
      uses: [
        { claim_id: "order-cancellation-eligibility", contract_version: 1 },
        { claim_id: "refund-settlement-contract", contract_version: 1 },
      ],
      preserves: claimInputs.slice(2).map((input) => ({
        claim_id: input.claimId,
        contract_version: 1,
      })),
      introduces: [],
      modifies: [],
      deprecates: [],
      conflicts_with: [],
    },
    decision_question_refs: [],
    status: "owner_confirmed" as const,
    confirmation: { confirmation_id: "confirm-commerce-requirement", sha256: digest("c") },
  };
  const requirementRef = "requirements/self-service-order-cancellation/v1.json";
  const manifest = {
    schema_version: 1 as const,
    snapshot_id: "commerce-order-domain-v1",
    product_id: "synthetic-commerce",
    contract: contractPointer,
    interviews: [],
    evidence_cards: [],
    confirmations: [],
    decision_questions: [],
    requirements: [{ ref: requirementRef, sha256: canonicalJsonDigest(requirement) }],
    graph: { ref: "graphs/commerce-order-v1.json", sha256: digest("d") },
    readiness_request: { ref: "readiness/requests/commerce-v1.json", sha256: digest("e") },
    readiness_report: { ref: "readiness/reports/commerce-v1.json", sha256: digest("f") },
  };
  return {
    root: "/synthetic/domain-eval",
    manifestRef: "manifests/commerce-order-domain-v1.json",
    manifest,
    interviews: [],
    evidenceCards: [],
    confirmations: [],
    decisionQuestions: [],
    contract,
    requirements: [{ ref: requirementRef, value: requirement }],
    graph: {} as ValidatedDomainPack["graph"],
    request: {} as ValidatedDomainPack["request"],
    readiness: {} as ValidatedDomainPack["readiness"],
  };
}

test("commerce Claims compile to the exact commerce Oracle Plan", () => {
  const compiled = compileCommerceGrader({
    pack: validatedCommercePack(),
    requirementId: "self-service-order-cancellation",
    taskPackDigest: digest("9"),
    catalog,
  });
  assert.deepEqual(
    compiled.oraclePlan.checks.map((check) => check.behavior_id),
    COMMERCE_BEHAVIORS,
  );
  assert.equal(compiled.claimIr.template_id, "commerce-order-cancellation-v1");
  assert.deepEqual(compiled.claimIr.semantic_residual, []);
  assert.deepEqual(Object.keys(compiled.claimIr.traceability.claim_to_behaviors), [
    "order-cancellation-eligibility",
    "refund-settlement-contract",
    "inventory-release-once",
    "coupon-restoration-policy",
    "customer-order-ownership",
    "cancellation-durability-audit",
  ]);
});

test("commerce calibration produces a non-self-certified admitted Grader", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/commerce-admission-`);
  try {
    const compiled = compileCommerceGrader({
      pack: validatedCommercePack(),
      requirementId: "self-service-order-cancellation",
      taskPackDigest: digest("9"),
      catalog,
    });
    const calibration = await calibrateCommercePackDetailed({
      oracle: new CommerceOrderOracle({
        runner: new StrictProcessRunner(),
        oracleRunnerPath: `${packRoot}/oracle/runner.mjs`,
      }),
      packRoot,
      scratchRoot: scratch,
      seed: 1729,
    });
    const admission = buildCommerceGraderAdmission({
      oraclePlan: compiled.oraclePlan,
      catalog,
      calibration,
      seed: 1729,
      evalPackageDigest: digest("8"),
    });
    assert.equal(admission.status, "admitted");
    assert.equal(Object.values(admission.checks).every(Boolean), true);
    const rejected = buildCommerceGraderAdmission({
      oraclePlan: compiled.oraclePlan,
      catalog,
      calibration: {
        ...calibration,
        vectors: {
          ...calibration.vectors,
          "mutant-overrefund": calibration.vectors.gold,
        },
      },
      seed: 1729,
      evalPackageDigest: digest("8"),
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.checks.counterexamples_matched, false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
