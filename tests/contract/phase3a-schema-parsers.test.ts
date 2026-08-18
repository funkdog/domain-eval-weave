import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import * as addFormatsModule from "ajv-formats";
import {
  parseClaimDependencyGraph,
  parseDomainEvidenceCard,
  parseDomainInterviewSession,
  parseDomainTruthReadiness,
  parseProductDomainContract,
  parseRequirementChangeSet,
} from "../../src/domain/contracts.js";
import {
  validClaimDependencyGraph,
  validDomainTruthReadiness,
  validEvidenceCard,
  validInterviewSession,
  validProductDomainContract,
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
    ["domain-evidence-card.schema.json", validEvidenceCard, parseDomainEvidenceCard],
    ["domain-interview-session.schema.json", validInterviewSession, parseDomainInterviewSession],
    ["product-domain-contract.schema.json", validProductDomainContract, parseProductDomainContract],
    ["requirement-change-set.schema.json", validRequirementChangeSet, parseRequirementChangeSet],
    ["claim-dependency-graph.schema.json", validClaimDependencyGraph, parseClaimDependencyGraph],
    ["domain-truth-readiness.schema.json", validDomainTruthReadiness, parseDomainTruthReadiness],
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

test("confirmed Evidence Cards require owner confirmation and non-knowledge authority", () => {
  const missingConfirmation = structuredClone(validEvidenceCard) as Record<string, unknown>;
  delete missingConfirmation.confirmed_by;
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
  delete conflicted.confirmed_by;
  delete conflicted.confirmed_at;
  assert.throws(() => parseDomainEvidenceCard(conflicted));

  const proposed = structuredClone(validEvidenceCard) as Record<string, unknown>;
  proposed.status = "proposed";
  assert.throws(() => parseDomainEvidenceCard(proposed));
});

test("owner-confirmed Requirement ChangeSets cannot retain blocking decision questions", () => {
  const requirement = structuredClone(validRequirementChangeSet) as Record<string, unknown>;
  requirement.decision_question_ids = ["coupon-restoration-policy"];
  assert.throws(() => parseRequirementChangeSet(requirement));
});

test("interview completion and readiness overall remain semantically bound", () => {
  const interview = structuredClone(validInterviewSession) as Record<string, unknown>;
  delete interview.ended_at;
  assert.throws(() => parseDomainInterviewSession(interview));

  const readiness = structuredClone(validDomainTruthReadiness) as Record<string, unknown>;
  const dimensions = readiness.dimensions as Record<string, { status: string }>;
  const conflict = dimensions.conflict_state;
  assert.ok(conflict);
  conflict.status = "fail";
  assert.throws(() => parseDomainTruthReadiness(readiness));
});
