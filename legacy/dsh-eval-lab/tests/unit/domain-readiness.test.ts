import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import { buildDomainTruthReadiness } from "../../src/domain/readiness.js";
import {
  validClaimDependencyGraph,
  validDecisionQuestion,
  validEvidenceCard,
  validReadinessRequest,
  validRequirementChangeSet,
} from "../helpers/phase3a-fixtures.js";

const input = {
  contract: { ref: "contracts/synthetic-commerce-contract/v1.json", sha256: "1".repeat(64) },
  requirements: [
    { ref: "requirements/order-cancellation-v1/v1.json", requirement: validRequirementChangeSet },
  ],
  graph: { ref: "graphs/graph-synthetic-commerce-v1.json", graph: validClaimDependencyGraph },
  evidenceCards: [{ ref: "evidence-cards/card-refund-cash-limit.json", card: validEvidenceCard }],
  decisionQuestions: [],
  request: {
    ref: "readiness/requests/readiness-order-cancellation-v1.json",
    request: validReadinessRequest,
  },
  generatedAt: "2026-08-19T00:20:00.000Z",
} as const;

test("readiness is a rule-based vector rather than a score", () => {
  const green = buildDomainTruthReadiness(input);
  assert.equal(green.overall, "green");
  assert.equal("score" in green, false);

  const proposed = structuredClone(validEvidenceCard) as Record<string, unknown>;
  proposed.status = "proposed";
  proposed.false_accept_risk = "medium";
  delete proposed.confirmation;
  const yellow = buildDomainTruthReadiness({
    ...input,
    evidenceCards: [{ ref: "evidence-cards/proposed.json", card: proposed }],
  });
  assert.equal(yellow.overall, "yellow");
  assert.equal(yellow.dimensions.owner_confirmation.status, "warning");

  proposed.false_accept_risk = "critical";
  const red = buildDomainTruthReadiness({
    ...input,
    evidenceCards: [{ ref: "evidence-cards/proposed.json", card: proposed }],
  });
  assert.equal(red.overall, "red");
  assert.equal(red.dimensions.owner_confirmation.status, "fail");

  const blockingQuestion = { ...validDecisionQuestion, blocking: true } as const;
  const blockingRequirement = {
    ...validRequirementChangeSet,
    decision_question_refs: [
      {
        ref: "decision-questions/coupon-restoration-policy/r1.json",
        sha256: canonicalJsonDigest(blockingQuestion),
      },
    ],
  } as const;
  const blocking = buildDomainTruthReadiness({
    ...input,
    requirements: [
      {
        ref: "requirements/order-cancellation-v1/v1.json",
        requirement: blockingRequirement,
      },
    ],
    decisionQuestions: [
      {
        ref: "decision-questions/coupon-restoration-policy/r1.json",
        question: blockingQuestion,
      },
    ],
    request: {
      ref: input.request.ref,
      request: {
        ...validReadinessRequest,
        requirements: [
          {
            ref: "requirements/order-cancellation-v1/v1.json",
            sha256: canonicalJsonDigest(blockingRequirement),
          },
        ],
      },
    },
  });
  assert.equal(blocking.overall, "red");
  assert.equal(blocking.dimensions.requirement_binding.status, "fail");

  const outside = buildDomainTruthReadiness({
    ...input,
    decisionQuestions: [
      {
        ref: "decision-questions/unrelated/r1.json",
        question: {
          ...validDecisionQuestion,
          question_id: "unrelated",
          requirement_id: "unrelated-requirement",
          blocking: true,
          risk: "critical",
        },
      },
    ],
  });
  assert.equal(outside.overall, "green");
});
