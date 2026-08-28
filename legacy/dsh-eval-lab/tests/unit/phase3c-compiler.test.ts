import assert from "node:assert/strict";
import test from "node:test";
import { parseCommerceClaimIr } from "../../src/commerce-withdrawal/delivery-contracts.js";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { COMMERCE_BEHAVIORS } from "../../src/oracle/commerce-order-v2.js";
import { compilePhase3cObservationBoundary, PHASE3C_DIMENSIONS } from "../../src/phase3c/index.js";

const sha = (value: string) => value.repeat(64);
const claimBehaviors = [
  ["CLM-COMMERCE-R01", "uses", [3, 4, 8, 9, 12, 13]],
  ["CLM-COMMERCE-R02", "uses", [3]],
  ["CLM-COMMERCE-R07", "uses", [3, 4, 5, 6, 7, 8, 9, 12]],
  ["CLM-COMMERCE-D01", "uses", [0, 1, 2, 4]],
  ["CLM-COMMERCE-D02", "uses", [4, 5, 6, 7]],
  ["CLM-COMMERCE-R03", "preserves", [1, 13]],
  ["CLM-COMMERCE-R04", "preserves", [13]],
  ["CLM-COMMERCE-R05", "preserves", [10]],
  ["CLM-COMMERCE-R06", "preserves", [8, 11, 12, 14]],
  ["CLM-COMMERCE-R08", "preserves", [11, 12, 14, 15]],
  ["CLM-COMMERCE-D03", "preserves", [6, 7, 8]],
  ["CLM-COMMERCE-D04", "preserves", [9]],
  ["CLM-COMMERCE-D07", "preserves", [11, 14]],
  ["CLM-COMMERCE-D08", "preserves", [4, 5, 6, 7, 12]],
  ["CLM-COMMERCE-D09", "preserves", [12, 15]],
] as const;

function claimIr() {
  const claims = claimBehaviors.map(([claimId, effect, behaviorIndexes]) => ({
    claim_id: claimId,
    contract_version: 2,
    domain_id: "commerce-order",
    effect,
    axis: effect === "uses" ? ("requirement_delta" as const) : ("domain_preservation" as const),
    statement_sha256: sha("1"),
    false_accept_risk: "critical" as const,
    false_reject_risk: "high" as const,
    dependencies: [],
    observation_bindings: behaviorIndexes.map((index) => ({
      behavior_id: COMMERCE_BEHAVIORS[index],
      entry_sha256: sha("2"),
    })),
  }));
  const claimToBehaviors = Object.fromEntries(
    claims.map((claim) => [
      claim.claim_id,
      claim.observation_bindings.map((binding) => binding.behavior_id),
    ]),
  );
  const behaviorToClaims = Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [
      behavior,
      claims
        .filter((claim) =>
          claim.observation_bindings.some((binding) => binding.behavior_id === behavior),
        )
        .map((claim) => claim.claim_id),
    ]),
  );
  return parseCommerceClaimIr({
    schema_version: 2,
    template_id: "commerce-order-cancellation-v2",
    compiler: { compiler_id: "phase3b2-commerce-compiler", compiler_version: 1 },
    source: {
      domain_manifest: { ref: "domain-eval/manifest.json", sha256: sha("3") },
      contract: { ref: "domain-eval/contract.json", sha256: sha("4") },
      requirement: { ref: "domain-eval/requirement.json", sha256: sha("5") },
      task_pack_sha256: sha("6"),
      observation_catalog_sha256: sha("7"),
    },
    requirement: {
      requirement_id: "self-service-order-cancellation",
      requirement_version: 2,
      product_id: "commerce-product",
    },
    claims,
    semantic_residual: [],
    traceability: {
      claim_to_behaviors: claimToBehaviors,
      behavior_to_claims: behaviorToClaims,
    },
  });
}

const source = {
  domain_manifest: { ref: "artifact://campaign/source/domain.json", sha256: sha("8") },
  requirement: { ref: "artifact://campaign/source/requirement.json", sha256: sha("9") },
  claim_ir: { ref: "artifact://campaign/source/claim-ir.json", sha256: sha("a") },
  task_pack: { ref: "artifact://campaign/source/task-pack.json", sha256: sha("b") },
};

test("Phase 3C compiler derives a total Authority Map and exact binding dimensions", () => {
  const ir = claimIr();
  const compiled = compilePhase3cObservationBoundary({
    claimIr: ir,
    source: { ...source, claim_ir: { ...source.claim_ir, sha256: canonicalJsonDigest(ir) } },
    publicSurfaceSha256: sha("c"),
    runnerSha256: sha("d"),
    authorityRef: source.requirement,
  });
  assert.deepEqual(
    compiled.authorityMap.dimensions.map((entry) => entry.dimension_id),
    PHASE3C_DIMENSIONS,
  );
  assert.ok(
    compiled.authorityMap.dimensions.every(
      (entry) => entry.disposition === "deterministic" && entry.claim_ids.length > 0,
    ),
  );
  assert.equal(new Set(compiled.boundary.bindings.map((entry) => entry.claim_id)).size, 15);
});

test("Phase 3C compiler rejects a Claim rebound to an unrelated scenario", () => {
  const original = claimIr();
  const claims = original.claims.map((claim) =>
    claim.claim_id === "CLM-COMMERCE-R02"
      ? {
          ...claim,
          observation_bindings: [
            { behavior_id: "customer_ownership_is_enforced" as const, entry_sha256: sha("2") },
          ],
        }
      : claim,
  );
  const claimToBehaviors = {
    ...original.traceability.claim_to_behaviors,
    "CLM-COMMERCE-R02": ["customer_ownership_is_enforced" as const],
  };
  const behaviorToClaims = Object.fromEntries(
    COMMERCE_BEHAVIORS.map((behavior) => [
      behavior,
      claims
        .filter((claim) =>
          claim.observation_bindings.some((binding) => binding.behavior_id === behavior),
        )
        .map((claim) => claim.claim_id),
    ]),
  );
  const rebound = parseCommerceClaimIr({
    ...original,
    claims,
    traceability: { claim_to_behaviors: claimToBehaviors, behavior_to_claims: behaviorToClaims },
  });
  assert.throws(
    () =>
      compilePhase3cObservationBoundary({
        claimIr: rebound,
        source,
        publicSurfaceSha256: sha("c"),
        runnerSha256: sha("d"),
        authorityRef: source.requirement,
      }),
    /lacks Claim authority/i,
  );
});
