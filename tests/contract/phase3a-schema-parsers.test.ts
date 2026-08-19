import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import * as addFormatsModule from "ajv-formats";
import {
  parseClaimDependencyGraph,
  parseDomainDecisionQuestion,
  parseDomainEvidenceCard,
  parseDomainInterviewSession,
  parseDomainPackManifest,
  parseDomainReadinessRequest,
  parseDomainTruthReadiness,
  parseOwnerConfirmationEvent,
  parseProductDomainContract,
  parseProductDomainContractCandidate,
  parseRequirementChangeSet,
} from "../../src/domain/contracts.js";
import {
  validClaimDependencyGraph,
  validDecisionQuestion,
  validDomainPackManifest,
  validDomainTruthReadiness,
  validEvidenceCard,
  validInterviewSession,
  validOwnerConfirmation,
  validProductDomainContract,
  validProductDomainContractCandidate,
  validReadinessRequest,
  validRequirementChangeSet,
} from "../helpers/phase3a-fixtures.js";

const CONTRACT_ROOT = new URL("../../contracts/", import.meta.url);
const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as FormatsPlugin;

async function validator(name: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = JSON.parse(await readFile(new URL(name, CONTRACT_ROOT), "utf8"));
  ajv.addSchema(schema);
  const validate = ajv.getSchema(`https://dsh-eval-lab.local/contracts/${name}`);
  assert.ok(validate, `missing validator for ${name}`);
  return validate;
}

test("Phase 3A persisted faces have JSON Schema and Zod parser parity", async () => {
  const faces = [
    ["owner-confirmation.schema.json", validOwnerConfirmation, parseOwnerConfirmationEvent],
    ["domain-evidence-card.schema.json", validEvidenceCard, parseDomainEvidenceCard],
    ["domain-interview-session.schema.json", validInterviewSession, parseDomainInterviewSession],
    ["domain-decision-question.schema.json", validDecisionQuestion, parseDomainDecisionQuestion],
    ["product-domain-contract.schema.json", validProductDomainContract, parseProductDomainContract],
    [
      "product-domain-contract-candidate.schema.json",
      validProductDomainContractCandidate,
      parseProductDomainContractCandidate,
    ],
    ["requirement-change-set.schema.json", validRequirementChangeSet, parseRequirementChangeSet],
    ["claim-dependency-graph.schema.json", validClaimDependencyGraph, parseClaimDependencyGraph],
    ["domain-readiness-request.schema.json", validReadinessRequest, parseDomainReadinessRequest],
    ["domain-truth-readiness.schema.json", validDomainTruthReadiness, parseDomainTruthReadiness],
    ["domain-pack-manifest.schema.json", validDomainPackManifest, parseDomainPackManifest],
  ] as const;

  for (const [schemaName, value, parser] of faces) {
    const validate = await validator(schemaName);
    assert.equal(validate(value), true, `${schemaName}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(parser(value), value);
  }
});

test("Phase 3A portable refs reject absolute, traversal, backslash, and empty segments", () => {
  for (const ref of [
    "/tmp/source.md",
    "../source.md",
    "sources\\source.md",
    "sources//source.md",
  ]) {
    const card = structuredClone(validEvidenceCard) as Record<string, unknown>;
    const sources = card.source_refs as Record<string, unknown>[];
    const source = sources[0];
    assert.ok(source);
    source.artifact_ref = ref;
    assert.throws(() => parseDomainEvidenceCard(card));
  }
});

test("SourceRef locator and confirm-only authority invariants have schema parity", async () => {
  const cardValidator = await validator("domain-evidence-card.schema.json");
  const card = structuredClone(validEvidenceCard) as Record<string, unknown>;
  const sources = card.source_refs as Record<string, unknown>[];
  const source = sources[0];
  assert.ok(source);
  source.locator = "https://example.invalid/policy";
  assert.throws(() => parseDomainEvidenceCard(card));
  assert.equal(cardValidator(card), false, JSON.stringify(cardValidator.errors));

  const eventValidator = await validator("owner-confirmation.schema.json");
  const event = structuredClone(validOwnerConfirmation) as Record<string, unknown>;
  event.decision = "reject";
  assert.throws(() => parseOwnerConfirmationEvent(event));
  assert.equal(eventValidator(event), false, JSON.stringify(eventValidator.errors));
});

test("confirmed Evidence Cards require owner confirmation and non-knowledge authority", () => {
  const missingConfirmation = structuredClone(validEvidenceCard) as Record<string, unknown>;
  delete missingConfirmation.confirmation;
  assert.throws(() => parseDomainEvidenceCard(missingConfirmation));

  const knowledgeOnly = structuredClone(validEvidenceCard) as Record<string, unknown>;
  knowledgeOnly.source_refs = [
    {
      source_id: "industry-practice",
      kind: "domain_knowledge",
      artifact_ref: "knowledge/payments.json",
      digest: "e".repeat(64),
    },
  ];
  knowledgeOnly.authority_ref_ids = ["industry-practice"];
  knowledgeOnly.observation_ref_ids = [];
  assert.throws(() => parseDomainEvidenceCard(knowledgeOnly));
});

test("conflicted cards require distinct conflicting sources and cannot carry confirmation", () => {
  const conflicted = structuredClone(validEvidenceCard) as Record<string, unknown>;
  conflicted.status = "conflicted";
  conflicted.conflict = {
    source_ref_ids: ["owner-refund-policy"],
    reason: "The owner statement and product document disagree.",
  };
  delete conflicted.confirmation;
  assert.throws(() => parseDomainEvidenceCard(conflicted));

  const proposed = structuredClone(validEvidenceCard) as Record<string, unknown>;
  proposed.status = "proposed";
  assert.throws(() => parseDomainEvidenceCard(proposed));
});

test("draft Requirement ChangeSets cannot self-attach confirmation evidence", () => {
  const requirement = structuredClone(validRequirementChangeSet) as Record<string, unknown>;
  requirement.status = "draft";
  assert.throws(() => parseRequirementChangeSet(requirement));
});

test("interview completion and readiness overall remain semantically bound", () => {
  const interview = structuredClone(validInterviewSession) as Record<string, unknown>;
  delete interview.ended_at;
  assert.throws(() => parseDomainInterviewSession(interview));

  const missingAnswer = structuredClone(validInterviewSession) as Record<string, unknown>;
  const turns = missingAnswer.turns as Record<string, unknown>[];
  const firstTurn = turns[0];
  assert.ok(firstTurn);
  delete firstTurn.answer;
  assert.throws(() => parseDomainInterviewSession(missingAnswer));

  const overwrittenRevision = {
    ...validInterviewSession,
    revision: 2,
  };
  assert.throws(() => parseDomainInterviewSession(overwrittenRevision));

  const readiness = structuredClone(validDomainTruthReadiness) as Record<string, unknown>;
  const dimensions = readiness.dimensions as Record<string, { status: string }>;
  const conflict = dimensions.conflict_state;
  assert.ok(conflict);
  conflict.status = "fail";
  assert.throws(() => parseDomainTruthReadiness(readiness));
});

test("representable authority-state invariants have JSON Schema and parser parity", async () => {
  const cases = [
    [
      "domain-evidence-card.schema.json",
      (() => {
        const value = structuredClone(validEvidenceCard) as Record<string, unknown>;
        delete value.confirmation;
        return value;
      })(),
      parseDomainEvidenceCard,
    ],
    [
      "domain-decision-question.schema.json",
      { ...validDecisionQuestion, status: "resolved" },
      parseDomainDecisionQuestion,
    ],
    [
      "product-domain-contract.schema.json",
      (() => {
        const value = structuredClone(validProductDomainContract) as Record<string, unknown>;
        delete value.confirmation;
        return value;
      })(),
      parseProductDomainContract,
    ],
    [
      "requirement-change-set.schema.json",
      (() => {
        const value = structuredClone(validRequirementChangeSet) as Record<string, unknown>;
        delete value.confirmation;
        return value;
      })(),
      parseRequirementChangeSet,
    ],
  ] as const;

  for (const [schemaName, value, parser] of cases) {
    const validate = await validator(schemaName);
    assert.equal(validate(value), false, `${schemaName}: ${JSON.stringify(validate.errors)}`);
    assert.throws(() => parser(value));
  }
});
