import assert from "node:assert/strict";
import test from "node:test";

import { parseArtifactRef } from "../../src/contracts/artifacts.js";
import { parsePairedImpactReport } from "../../src/contracts/parsers.js";
import { parseActivationArtifact, parseTaskEntry } from "../../src/contracts/phase2.js";
import { parseSuiteArtifactRef } from "../../src/contracts/suite-artifact-ref.js";
import {
  buildSuiteEvaluation,
  buildSuiteReport,
  renderSuiteReportMarkdown,
  type SuiteCampaignEvidence,
} from "../../src/suite/reporter.js";
import { validReport } from "../helpers/fixtures.js";
import { validActivationArtifact, validRegistrySnapshot } from "../helpers/phase2-fixtures.js";

const digest = (character: string): string => character.repeat(64);
const emptyActivation = parseActivationArtifact({
  schema_version: 1,
  harness_id: "dsh-goal-stack",
  session_id: "session-control",
  events: [],
  summary: { activated: false, event_count: 0, continuation_rounds: 0, terminal_phase: "none" },
});

function evidence(
  taskIndex: number,
  activated: boolean,
  reportValidity: "valid" | "invalid" | "insufficient" = "valid",
  reportReason = "GOAL_NOT_ACTIVATED",
): SuiteCampaignEvidence {
  const task = parseTaskEntry(validRegistrySnapshot.tasks[taskIndex]);
  const activation = activated
    ? parseActivationArtifact({
        ...validActivationArtifact,
        session_id: `session-${task.task_id}`,
      })
    : emptyActivation;
  const campaignId = `campaign-${task.task_id}`;
  return {
    task,
    campaignId,
    campaignPointer: {
      ref: parseSuiteArtifactRef(`artifact://suite/tasks/${task.task_id}/campaign-pointer.json`),
      sha256: digest(String(taskIndex + 1)),
    },
    campaignReportPointer: {
      ref: parseArtifactRef("artifact://campaign/report.json"),
      sha256: digest("a"),
    },
    report: parsePairedImpactReport({
      ...structuredClone(validReport),
      campaign_id: campaignId,
      measurement_validity: {
        ...validReport.measurement_validity,
        overall: reportValidity,
        reasons:
          reportValidity === "insufficient"
            ? [
                {
                  code: reportReason,
                  severity: "warning",
                  message: "Goal was not activated.",
                  evidence_refs: ["artifact://campaign/arms/treatment/session.jsonl"],
                },
              ]
            : [],
      },
    }),
    activation: { control: emptyActivation, treatment: activation },
  };
}

test("Suite reporter evaluates trigger, non-trigger, and holdout without effect claims", () => {
  const evaluation = buildSuiteEvaluation("suite-1", [
    evidence(0, true),
    evidence(1, false),
    evidence(2, false),
  ]);
  assert.equal(evaluation.measurement_validity, "valid");
  assert.deepEqual(evaluation.summary, {
    valid_task_count: 3,
    invalid_task_count: 0,
    insufficient_task_count: 0,
    trigger_activation: true,
    non_trigger_guardrail: "pass",
    holdout_activation_observed: false,
  });
  const report = buildSuiteReport(evaluation, {
    manifest: { ref: parseSuiteArtifactRef("artifact://suite/manifest.json"), sha256: digest("b") },
    binding: { ref: parseSuiteArtifactRef("artifact://suite/binding.json"), sha256: digest("c") },
    registry_snapshot: {
      ref: parseSuiteArtifactRef("artifact://suite/registry.json"),
      sha256: digest("d"),
    },
    qualification: {
      ref: parseSuiteArtifactRef("artifact://suite/qualification.json"),
      sha256: digest("f"),
    },
    evaluation: {
      ref: parseSuiteArtifactRef("artifact://suite/evaluation.json"),
      sha256: digest("e"),
    },
  });
  assert.equal(report.recommendation.action, "keep");
  assert.equal(report.effect_claim_eligible, false);
  assert.match(renderSuiteReportMarkdown(report), /Non-trigger guardrail: pass/);
});

test("Suite reporter distinguishes missing trigger, over-activation, and invalid evidence", () => {
  const missingTrigger = buildSuiteEvaluation("suite-1", [
    evidence(0, false),
    evidence(1, false),
    evidence(2, false),
  ]);
  assert.equal(missingTrigger.measurement_validity, "insufficient");
  assert.equal(missingTrigger.tasks[0]?.activation_assessment.code, "TRIGGER_ACTIVATION_MISSING");
  assert.equal(
    buildSuiteReport(missingTrigger, {
      manifest: {
        ref: parseSuiteArtifactRef("artifact://suite/manifest.json"),
        sha256: digest("b"),
      },
      binding: { ref: parseSuiteArtifactRef("artifact://suite/binding.json"), sha256: digest("c") },
      registry_snapshot: {
        ref: parseSuiteArtifactRef("artifact://suite/registry.json"),
        sha256: digest("d"),
      },
      qualification: {
        ref: parseSuiteArtifactRef("artifact://suite/qualification.json"),
        sha256: digest("f"),
      },
      evaluation: {
        ref: parseSuiteArtifactRef("artifact://suite/evaluation.json"),
        sha256: digest("e"),
      },
    }).recommendation.action,
    "iterate_binding",
  );

  const overActivation = buildSuiteEvaluation("suite-1", [
    evidence(0, true),
    evidence(1, true),
    evidence(2, false),
  ]);
  assert.equal(overActivation.measurement_validity, "valid");
  assert.equal(overActivation.summary.non_trigger_guardrail, "fail");
  assert.ok(overActivation.reasons.includes("NON_TRIGGER_OVER_ACTIVATION"));

  const invalid = buildSuiteEvaluation("suite-1", [
    evidence(0, true, "invalid"),
    evidence(1, false),
    evidence(2, false),
  ]);
  assert.equal(invalid.measurement_validity, "invalid");
  assert.ok(invalid.reasons.includes("CAMPAIGN_INVALID"));
});

test("expected no-activation normalizes only the Phase 1 Goal-only insufficiency", () => {
  const expectedAbsence = buildSuiteEvaluation("suite-1", [
    evidence(0, true),
    evidence(1, false, "insufficient"),
    evidence(2, false, "insufficient"),
  ]);
  assert.equal(expectedAbsence.measurement_validity, "valid");
  assert.equal(expectedAbsence.tasks[1]?.paired_overall, "insufficient");
  assert.equal(expectedAbsence.tasks[1]?.suite_overall, "valid");
});

test("Suite reporter preserves Campaign insufficiency reasons when activation passes", () => {
  const evaluation = buildSuiteEvaluation("suite-usage-missing", [
    evidence(0, true, "insufficient", "USAGE_MISSING"),
    evidence(1, false),
    evidence(2, false),
  ]);

  assert.equal(evaluation.measurement_validity, "insufficient");
  assert.deepEqual(evaluation.reasons, ["USAGE_MISSING"]);
  assert.ok(!evaluation.reasons.includes("ACTIVATION_EXPECTED_OBSERVED"));
});
