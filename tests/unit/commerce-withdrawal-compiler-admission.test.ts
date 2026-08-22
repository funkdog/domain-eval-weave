import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCommerceGraderAdmission } from "../../src/commerce-withdrawal/admission.js";
import { parseCommerceObservationCatalog } from "../../src/commerce-withdrawal/catalog.js";
import {
  compileCommerceGrader,
  replayCommerceOraclePlan,
} from "../../src/commerce-withdrawal/compiler.js";
import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import type { ValidatedDomainPack } from "../../src/domain/pack.js";
import { calibrateCommercePackDetailed } from "../../src/oracle/commerce-calibration-v2.js";
import { COMMERCE_BEHAVIORS, CommerceOrderOracle } from "../../src/oracle/commerce-order-v2.js";
import { StrictProcessRunner } from "../../src/process/strict-runner.js";
import { DEDICATED_RUNTIME_ROOT } from "../../src/runtime-root.js";

const packRoot = fileURLToPath(
  new URL("../../task-packs/open-coding-ts-commerce-order-v2", import.meta.url),
);
const catalog = parseCommerceObservationCatalog(
  JSON.parse(readFileSync(`${packRoot}/claim-observation-catalog.json`, "utf8")),
);
const digest = (character: string) => character.repeat(64);

const claimInputs = [
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

function observation(index: number) {
  const entry = catalog.behaviors[index];
  assert.ok(entry);
  return {
    source_id: `commerce-v2-observation-${entry.behavior_id}`,
    kind: "test" as const,
    artifact_ref: "sources/commerce-order-observation-catalog.json",
    digest: canonicalJsonDigest(entry),
    locator: `/behaviors/${index}`,
  };
}

function validatedPack(): ValidatedDomainPack {
  const claims = claimInputs.map(([claimId, _effect, observations], index) => ({
    claim_id: claimId,
    domain_id: "commerce-order",
    statement: `Confirmed statement for ${claimId}.`,
    applicability: "Synthetic whole-order self-service cancellation.",
    evidence_card: { ref: `evidence-cards/${claimId}/r1.json`, sha256: digest("3") },
    authority_refs: [
      {
        source_id: `owner-${claimId}`,
        kind: "owner_statement" as const,
        artifact_ref: "sources/owner-policy.md",
        digest: digest(String((index % 6) + 4)),
      },
    ],
    observation_refs: observations.map(observation),
    false_accept_risk: "critical" as const,
    false_reject_risk: "high" as const,
    dependencies: [],
    lifecycle: "active" as const,
  }));
  const contract = {
    schema_version: 1 as const,
    contract_id: "commerce-order-contract",
    product_id: "synthetic-commerce",
    version: 2,
    source_interview: { ref: "interviews/commerce/r1.json", sha256: digest("1") },
    source_snapshot_digest: digest("2"),
    claims,
    state: "issued" as const,
    confirmation: { confirmation_id: "confirm-commerce-v2-contract", sha256: digest("a") },
    decided_by: "commerce-domain-owner",
    decided_at: "2026-08-22T00:00:00.000Z",
  };
  const contractPointer = {
    ref: "contracts/commerce-order-contract/v2.json",
    sha256: canonicalJsonDigest(contract),
  };
  const requirement = {
    schema_version: 1 as const,
    requirement_id: "self-service-order-cancellation",
    version: 2,
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
      uses: claimInputs
        .filter(([, effect]) => effect === "uses")
        .map(([claimId]) => ({ claim_id: claimId, contract_version: 2 })),
      preserves: claimInputs
        .filter(([, effect]) => effect === "preserves")
        .map(([claimId]) => ({ claim_id: claimId, contract_version: 2 })),
      introduces: [],
      modifies: [],
      deprecates: [],
      conflicts_with: [],
    },
    decision_question_refs: [],
    status: "owner_confirmed" as const,
    confirmation: { confirmation_id: "confirm-commerce-v2-requirement", sha256: digest("c") },
  };
  const requirementRef = "requirements/self-service-order-cancellation/v2.json";
  const manifest = {
    schema_version: 1 as const,
    snapshot_id: "commerce-order-withdrawal-v2",
    product_id: "synthetic-commerce",
    contract: contractPointer,
    interviews: [],
    evidence_cards: [],
    confirmations: [],
    decision_questions: [],
    requirements: [{ ref: requirementRef, sha256: canonicalJsonDigest(requirement) }],
    graph: { ref: "graphs/commerce-order-v2.json", sha256: digest("d") },
    readiness_request: { ref: "readiness/requests/commerce-v2.json", sha256: digest("e") },
    readiness_report: { ref: "readiness/reports/commerce-v2.json", sha256: digest("f") },
  };
  return {
    root: "/synthetic/domain-eval",
    manifestRef: "manifests/commerce-order-withdrawal-v2.json",
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

test("fifteen confirmed Claims compile to the exact sixteen-check Oracle Plan", () => {
  const compiled = compileCommerceGrader({
    pack: validatedPack(),
    requirementId: "self-service-order-cancellation",
    taskPackDigest: digest("9"),
    catalog,
  });
  assert.equal(compiled.claimIr.template_id, "commerce-order-cancellation-v2");
  assert.equal(compiled.claimIr.claims.length, 15);
  assert.deepEqual(compiled.claimIr.semantic_residual, []);
  assert.deepEqual(
    compiled.oraclePlan.checks.map((check) => check.behavior_id),
    COMMERCE_BEHAVIORS,
  );
  assert.equal("CLM-COMMERCE-D05" in compiled.claimIr.traceability.claim_to_behaviors, false);
  assert.equal("CLM-COMMERCE-D06" in compiled.claimIr.traceability.claim_to_behaviors, false);
  assert.deepEqual(
    replayCommerceOraclePlan({
      claimIr: compiled.claimIr,
      oraclePlan: compiled.oraclePlan,
      catalog,
    }),
    compiled.oraclePlan,
  );
});

test("the frozen v2 calibration corpus produces an admitted Grader", async () => {
  const parent = `${DEDICATED_RUNTIME_ROOT}/test-tmp`;
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(`${parent}/commerce-withdrawal-admission-`);
  try {
    const compiled = compileCommerceGrader({
      pack: validatedPack(),
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
          "mutant-expired-replay-fresh": calibration.vectors.gold,
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
