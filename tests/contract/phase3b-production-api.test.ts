import assert from "node:assert/strict";
import test from "node:test";

import * as delivery from "../../src/delivery/index.js";

test("the public Delivery API exposes one production runner and no injectable builders", () => {
  assert.deepEqual(Object.keys(delivery).sort(), [
    "DeliveryProductionError",
    "parseClaimIr",
    "parseDeliveryEvaluationReport",
    "parseGraderAdmission",
    "parseObservationCatalog",
    "parseOraclePlan",
    "renderDeliveryEvaluationMarkdown",
    "replayRealDeliveryEvaluation",
    "runRealDeliveryEvaluation",
  ]);
  for (const unsafe of [
    "buildDeliveryEvaluationReport",
    "buildGraderAdmission",
    "compileValidatedDeterministicGrader",
    "persistDeliveryEvaluation",
  ]) {
    assert.equal(unsafe in delivery, false);
  }
});

test("the production runner rejects invalid execution bounds before reading project inputs", async () => {
  await assert.rejects(
    delivery.runRealDeliveryEvaluation({
      projectRoot: "/does-not-exist",
      packRef: "domain-eval",
      manifestRef: "manifests/missing.json",
      requirementId: "missing-requirement",
      timeoutMs: 0,
      confirm: async () => true,
    }),
    (error: unknown) =>
      error instanceof delivery.DeliveryProductionError &&
      error.code === "DELIVERY_TIMEOUT_INVALID",
  );
});
