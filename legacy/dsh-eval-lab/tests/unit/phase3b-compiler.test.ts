import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { compileValidatedDeterministicGrader } from "../../src/delivery/compiler.js";
import type { ValidatedDomainPack } from "../../src/domain/pack.js";
import { LEDGER_BEHAVIORS } from "../../src/oracle/ledger.js";
import { validObservationCatalog } from "../helpers/phase3b-fixtures.js";

const digest = (character: string): string => character.repeat(64);

function source(index: number) {
  const entry = validObservationCatalog.behaviors[index];
  assert.ok(entry);
  return {
    source_id: `ledger-observation-${entry.behavior_id}`,
    kind: "test" as const,
    artifact_ref: "sources/claim-observation-catalog.json",
    digest: canonicalJsonDigest(entry),
    locator: `/behaviors/${index}`,
  };
}

function validatedPack(): ValidatedDomainPack {
  const commandSources = [source(0), source(1), source(2), source(4)];
  const preservationSources = [source(3), source(5), source(6), source(7)];
  const contract = {
    schema_version: 1 as const,
    contract_id: "reservation-ledger-contract",
    product_id: "synthetic-reservations",
    version: 1,
    source_interview: { ref: "interviews/reservation/r1.json", sha256: digest("a") },
    source_snapshot_digest: digest("b"),
    claims: [
      {
        claim_id: "reservation-command-contract",
        domain_id: "reservations",
        statement: "Commands reserve and replay with a stable idempotency contract.",
        applicability: "Every reservation command.",
        evidence_card: { ref: "evidence-cards/commands/r1.json", sha256: digest("c") },
        authority_refs: [
          {
            source_id: "owner-command-contract",
            kind: "owner_statement" as const,
            artifact_ref: "sources/owner-command-contract.md",
            digest: digest("d"),
          },
        ],
        observation_refs: commandSources,
        false_accept_risk: "high" as const,
        false_reject_risk: "medium" as const,
        dependencies: [],
        lifecycle: "active" as const,
      },
      {
        claim_id: "reservation-state-integrity",
        domain_id: "reliability",
        statement: "State remains bounded, durable, fail-closed, and deterministic.",
        applicability: "Every persisted reservation ledger.",
        evidence_card: { ref: "evidence-cards/state/r1.json", sha256: digest("e") },
        authority_refs: [
          {
            source_id: "owner-state-integrity",
            kind: "owner_statement" as const,
            artifact_ref: "sources/owner-state-integrity.md",
            digest: digest("f"),
          },
        ],
        observation_refs: preservationSources,
        false_accept_risk: "critical" as const,
        false_reject_risk: "high" as const,
        dependencies: [],
        lifecycle: "active" as const,
      },
    ],
    state: "issued" as const,
    confirmation: { confirmation_id: "confirm-reservation-contract", sha256: digest("1") },
    decided_by: "domain-owner-reservations",
    decided_at: "2026-08-21T00:00:00.000Z",
  };
  const requirement = {
    schema_version: 1 as const,
    requirement_id: "implement-reservation-ledger",
    version: 1,
    product_id: "synthetic-reservations",
    requirement_refs: [
      {
        source_id: "requirement-implement-ledger",
        kind: "requirement" as const,
        artifact_ref: "sources/implement-ledger.md",
        digest: digest("2"),
      },
    ],
    base_contract: {
      ref: "contracts/reservation-ledger-contract/v1.json",
      sha256: canonicalJsonDigest(contract),
    },
    effects: {
      uses: [{ claim_id: "reservation-command-contract", contract_version: 1 }],
      preserves: [{ claim_id: "reservation-state-integrity", contract_version: 1 }],
      introduces: [],
      modifies: [],
      deprecates: [],
      conflicts_with: [],
    },
    decision_question_refs: [],
    status: "owner_confirmed" as const,
    confirmation: { confirmation_id: "confirm-implement-ledger", sha256: digest("3") },
  };
  const requirementRef = "requirements/implement-reservation-ledger/v1.json";
  const manifest = {
    schema_version: 1 as const,
    snapshot_id: "reservation-ledger-domain-v1",
    product_id: "synthetic-reservations",
    contract: {
      ref: "contracts/reservation-ledger-contract/v1.json",
      sha256: canonicalJsonDigest(contract),
    },
    interviews: [],
    evidence_cards: [],
    confirmations: [],
    decision_questions: [],
    requirements: [{ ref: requirementRef, sha256: canonicalJsonDigest(requirement) }],
    graph: { ref: "graphs/reservation-ledger-v1.json", sha256: digest("4") },
    readiness_request: {
      ref: "readiness/requests/reservation-ledger-v1.json",
      sha256: digest("5"),
    },
    readiness_report: { ref: "readiness/reports/reservation-ledger-v1.json", sha256: digest("6") },
  };
  return {
    root: "/synthetic/domain-eval",
    manifestRef: "manifests/reservation-ledger-domain-v1.json",
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

function rebindPack(
  pack: ValidatedDomainPack,
  contract: ValidatedDomainPack["contract"] = pack.contract,
  requirement: ValidatedDomainPack["requirements"][number]["value"] = pack.requirements[0]
    ?.value as ValidatedDomainPack["requirements"][number]["value"],
): ValidatedDomainPack {
  const artifact = pack.requirements[0];
  assert.ok(artifact);
  const contractPointer = {
    ...pack.manifest.contract,
    sha256: canonicalJsonDigest(contract),
  };
  const reboundRequirement = { ...requirement, base_contract: contractPointer };
  const requirementPointer = {
    ref: artifact.ref,
    sha256: canonicalJsonDigest(reboundRequirement),
  };
  return {
    ...pack,
    contract,
    requirements: [{ ref: artifact.ref, value: reboundRequirement }],
    manifest: {
      ...pack.manifest,
      contract: contractPointer,
      requirements: [requirementPointer],
    },
  };
}

test("confirmed Claim observations compile to one full deterministic Oracle Plan", () => {
  const compiled = compileValidatedDeterministicGrader({
    pack: validatedPack(),
    requirementId: "implement-reservation-ledger",
    taskPackDigest: digest("7"),
    catalog: validObservationCatalog,
  });
  assert.deepEqual(
    compiled.oraclePlan.checks.map((check) => check.behavior_id),
    LEDGER_BEHAVIORS,
  );
  assert.deepEqual(compiled.claimIr.semantic_residual, []);
  assert.deepEqual(compiled.claimIr.traceability.claim_to_behaviors, {
    "reservation-command-contract": [
      "basic_reservation",
      "idempotent_replay",
      "conflicting_replay_rejected",
      "terminal_transition_idempotency",
    ],
    "reservation-state-integrity": [
      "no_oversubscription_concurrent",
      "restart_recovery",
      "corrupt_state_fail_closed",
      "deterministic_snapshot",
    ],
  });
});

test("compiler does not infer behavior from Claim wording", () => {
  const pack = validatedPack();
  const rewritten = {
    ...pack.contract,
    claims: pack.contract.claims.map((claim) => ({
      ...claim,
      statement: `Completely different prose for ${claim.claim_id}.`,
    })),
  };
  const original = compileValidatedDeterministicGrader({
    pack,
    requirementId: "implement-reservation-ledger",
    taskPackDigest: digest("7"),
    catalog: validObservationCatalog,
  });
  const changed = compileValidatedDeterministicGrader({
    pack: rebindPack(pack, rewritten),
    requirementId: "implement-reservation-ledger",
    taskPackDigest: digest("7"),
    catalog: validObservationCatalog,
  });
  assert.deepEqual(changed.claimIr.traceability, original.claimIr.traceability);
  assert.notEqual(
    changed.claimIr.claims[0]?.statement_sha256,
    original.claimIr.claims[0]?.statement_sha256,
  );
});

test("catalog-entry digest drift fails before an Oracle Plan exists", () => {
  const pack = validatedPack();
  const firstClaim = pack.contract.claims[0];
  assert.ok(firstClaim);
  const tamperedContract = {
    ...pack.contract,
    claims: [
      {
        ...firstClaim,
        observation_refs: firstClaim.observation_refs.map((ref, index) =>
          index === 0 ? { ...ref, digest: digest("8") } : ref,
        ),
      },
      ...pack.contract.claims.slice(1),
    ],
  };
  const tampered = rebindPack(pack, tamperedContract);
  assert.throws(
    () =>
      compileValidatedDeterministicGrader({
        pack: tampered,
        requirementId: "implement-reservation-ledger",
        taskPackDigest: digest("7"),
        catalog: validObservationCatalog,
      }),
    /observation binding digest/,
  );
});

test("deprecation and declared Claim conflict fail closed in v1", () => {
  const pack = validatedPack();
  const requirementArtifact = pack.requirements[0];
  assert.ok(requirementArtifact);
  const conflict = {
    ...requirementArtifact.value,
    effects: {
      ...requirementArtifact.value.effects,
      conflicts_with: [
        {
          claim: { claim_id: "reservation-state-integrity", contract_version: 1 },
          reason: "Synthetic unresolved conflict.",
          source_ref_ids: ["requirement-implement-ledger"],
        },
      ],
    },
  };
  assert.throws(
    () =>
      compileValidatedDeterministicGrader({
        pack: rebindPack(pack, pack.contract, conflict),
        requirementId: "implement-reservation-ledger",
        taskPackDigest: digest("7"),
        catalog: validObservationCatalog,
      }),
    /conflicts or deprecations/,
  );
});
