import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/canonical-json.js";
import {
  freezeRecoveryEvaluation,
  gradeRecoveryDecisions,
  replayRecoveryArtifact,
} from "../../src/evaluator/recovery-decision.js";

const example = new URL("../../examples/payment-recovery-eval/", import.meta.url);
const submission = JSON.parse(await readFile(new URL("example-decisions.json", example), "utf8"));

test("recovery decision evidence is replayable without promoting domain or financial truth", async () => {
  const closure = await freezeRecoveryEvaluation();
  const artifact = gradeRecoveryDecisions(closure, submission);
  assert.equal(artifact.result.decision_verdict, "retain_for_development");
  assert.equal(artifact.result.qualification, "not_qualified");
  assert.equal(artifact.result.episodes.length, 5);
  assert.ok(
    artifact.result.episodes.every((episode) => episode.financial_effect === "indeterminate"),
  );
  assert.ok(closure.selected_claims.every((claim) => claim.epistemicState === "grounded"));
  assert.deepEqual(replayRecoveryArtifact(artifact), artifact.result);
  const changed = structuredClone(artifact);
  assert.ok(changed.submission.decisions[0]);
  changed.submission.decisions[0].action = "CREATE_NEW_PURCHASE";
  assert.throws(() => replayRecoveryArtifact(changed), /digest/);
  const wrongTask = structuredClone(submission);
  wrongTask.task_sha256 = "0".repeat(64);
  assert.throws(() => gradeRecoveryDecisions(closure, wrongTask), /task/);
});

test("unsafe debit, changed replay keys and always-wait cannot pass decision evaluation", async () => {
  const closure = await freezeRecoveryEvaluation();
  const unsafe = structuredClone(submission);
  unsafe.decisions[0].action = "CREATE_NEW_PURCHASE";
  assert.equal(
    gradeRecoveryDecisions(closure, unsafe).result.episodes[0]?.atoms.action_safety,
    "fail",
  );
  const wrongKey = structuredClone(submission);
  wrongKey.decisions[2].replay.idempotency_key = "SYNTHETIC-NEW-KEY";
  const wrongKeyResult = gradeRecoveryDecisions(closure, wrongKey).result;
  assert.equal(wrongKeyResult.episodes[2]?.atoms.replay_fidelity, "fail");
  assert.equal(wrongKeyResult.decision_verdict, "revise_decision_artifact");
  const waiting = structuredClone(submission);
  for (const decision of waiting.decisions) {
    decision.action = "WAIT_FOR_EVIDENCE";
    delete decision.replay;
  }
  const result = gradeRecoveryDecisions(closure, waiting).result;
  assert.ok(result.episodes.every((episode) => episode.atoms.action_safety === "pass"));
  assert.equal(
    result.episodes.filter((episode) => episode.atoms.decision_progress === "fail").length,
    4,
  );
  assert.equal(result.decision_verdict, "revise_decision_artifact");
});

test("missing or malformed capture is not converted into an observed behavioral failure", async () => {
  const closure = await freezeRecoveryEvaluation();
  const missing = structuredClone(submission);
  missing.decisions = [];
  const result = gradeRecoveryDecisions(closure, missing).result;
  assert.equal(result.decision_verdict, "collect_more_evidence");
  assert.ok(
    result.episodes.every((episode) => episode.decision_outcome === "insufficient_evidence"),
  );
  const malformed = structuredClone(submission);
  delete malformed.decisions[0].reason;
  const malformedResult = gradeRecoveryDecisions(closure, malformed).result;
  assert.equal(malformedResult.episodes[0]?.decision_outcome, "indeterminate");
  assert.equal(malformedResult.decision_verdict, "collect_more_evidence");
  const duplicate = structuredClone(submission);
  duplicate.decisions.push(duplicate.decisions[0]);
  assert.throws(() => gradeRecoveryDecisions(closure, duplicate), /duplicate/);
  assert.equal(canonicalJsonDigest(closure.task), submission.task_sha256);
});
