import assert from "node:assert/strict";
import test from "node:test";

import {
  renderDeliveryEvaluationMarkdown,
  runRealDeliveryEvaluation,
} from "../../src/delivery/production.js";
import { validPhase3cReport } from "../helpers/phase3c-fixtures.js";

test("Phase 3C production API renders v3 and fails closed before Candidate execution without Skill deployment", async () => {
  const markdown = renderDeliveryEvaluationMarkdown(
    validPhase3cReport,
    "commerce-order-cancellation-v3",
  );
  assert.match(markdown, /Phase 3C Delivery Evaluation/);
  assert.match(markdown, /No cross-axis aggregate score/);

  let confirmed = false;
  await assert.rejects(
    () =>
      runRealDeliveryEvaluation({
        projectRoot: "/synthetic/not-read-before-readiness",
        packRef: "domain-eval",
        manifestRef: "manifests/phase3c.json",
        requirementId: "self-service-order-cancellation",
        timeoutMs: 60_000,
        templateId: "commerce-order-cancellation-v3",
        confirm: async () => {
          confirmed = true;
          return true;
        },
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "PHASE3C_TDD_SKILL_UNAVAILABLE",
  );
  assert.equal(confirmed, false);
});
