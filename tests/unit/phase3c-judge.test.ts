import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  aggregateCodeQualityJudgeRuns,
  aggregateSemanticJudgeRuns,
  validateCodeQualityJudgeRun,
  validateSemanticJudgeRun,
} from "../../src/phase3c/index.js";

const sha = (value: string) => value.repeat(64);

const semanticContract = {
  schema_version: 1 as const,
  judge_contract_id: "phase3c-semantic-judge-v1" as const,
  dimensions: [
    {
      dimension_id: "requirement_intent_alignment" as const,
      applicability: "required" as const,
      decision_rule: "The implementation fulfills the residual requirement intent.",
      blocking: true,
      required_evidence: ["requirement_ref" as const, "code_location" as const],
    },
    {
      dimension_id: "handoff_comprehensibility" as const,
      applicability: "optional" as const,
      decision_rule: "A maintainer can understand the change.",
      blocking: false,
      required_evidence: ["code_location" as const],
    },
  ],
  model_route: { provider: "openai-codex", model: "gpt-5.6-sol", reasoning_effort: "xhigh" },
  prompt_sha256: sha("a"),
  output_schema_sha256: sha("b"),
  calibration_admission_sha256: sha("c"),
  repeats_per_evaluation: 3 as const,
};

const codeQualityContract = {
  schema_version: 1 as const,
  rubric_id: "phase3c-code-quality-v1" as const,
  dimensions: [
    {
      dimension_id: "change_scope_discipline" as const,
      applicability: "required" as const,
      decision_rule: "The diff stays in scope.",
      required_evidence: ["code_location" as const, "base_or_diff_ref" as const],
      conditions: [
        {
          condition_id: "unrelated-production-change",
          level: "blocking" as const,
          statement: "Production behavior outside the Requirement changed.",
          applicability: "Unrelated production files changed.",
          required_evidence: ["code_location" as const, "base_or_diff_ref" as const],
        },
        {
          condition_id: "avoidable-local-duplication",
          level: "concern" as const,
          statement: "The change adds avoidable local duplication.",
          applicability: "Equivalent local rules are repeated.",
          required_evidence: ["code_location" as const],
        },
      ],
    },
  ],
  model_route: semanticContract.model_route,
  prompt_sha256: sha("d"),
  output_schema_sha256: sha("e"),
  calibration_admission_sha256: sha("f"),
  repeats_per_evaluation: 3 as const,
};

const evidence = [
  { source_ref: `artifact://campaign/phase3c/candidate.json`, locator: "src/order.ts:10" },
];

function semanticRun(verdict: "pass" | "fail" | "abstain" = "pass") {
  return {
    schema_version: 1 as const,
    judge_kind: "semantic" as const,
    judge_contract_sha256: canonicalJsonDigest(semanticContract),
    input_manifest_sha256: sha("2"),
    dimensions: [
      {
        dimension_id: "requirement_intent_alignment" as const,
        applicability: "applicable" as const,
        verdict,
        severity: verdict === "fail" ? ("blocking" as const) : ("none" as const),
        matched_condition_ids: [],
        evidence,
        rationale: "Evidence-based result.",
        counterevidence: null,
        abstention_reason: verdict === "abstain" ? ("insufficient_evidence" as const) : null,
      },
      {
        dimension_id: "handoff_comprehensibility" as const,
        applicability: "applicable" as const,
        verdict: "pass" as const,
        severity: "none" as const,
        matched_condition_ids: [],
        evidence,
        rationale: "The change is locally understandable.",
        counterevidence: null,
        abstention_reason: null,
      },
    ],
    protocol_status: "valid" as const,
  };
}

function qualityRun(
  input: {
    verdict?: "pass" | "fail" | "abstain";
    severity?: "blocking" | "concern" | "none";
    conditions?: string[];
  } = {},
) {
  const verdict = input.verdict ?? "pass";
  return {
    schema_version: 1 as const,
    judge_kind: "code_quality" as const,
    rubric_sha256: canonicalJsonDigest(codeQualityContract),
    input_manifest_sha256: sha("4"),
    dimensions: [
      {
        dimension_id: "change_scope_discipline" as const,
        applicability: "applicable" as const,
        verdict,
        severity: input.severity ?? (verdict === "pass" ? "none" : "blocking"),
        matched_condition_ids: input.conditions ?? [],
        evidence,
        rationale: "Evidence-based quality result.",
        counterevidence: null,
        abstention_reason: verdict === "abstain" ? ("insufficient_evidence" as const) : null,
      },
    ],
    protocol_status: "valid" as const,
  };
}

test("Semantic Judge requires contract-authorized severity and evidence", () => {
  assert.equal(validateSemanticJudgeRun(semanticContract, semanticRun()).protocol_status, "valid");
  const bad = structuredClone(semanticRun("fail"));
  (bad.dimensions[0] as { severity: string }).severity = "concern";
  assert.throws(() => validateSemanticJudgeRun(semanticContract, bad), /severity/i);
});

test("three unanimous Semantic runs decide while disagreement abstains", () => {
  const pass = aggregateSemanticJudgeRuns(semanticContract, [
    semanticRun(),
    semanticRun(),
    semanticRun(),
  ]);
  assert.equal(pass.dimensions[0]?.verdict, "pass");
  assert.equal(pass.dimensions[0]?.abstention_reason, null);

  const unstable = aggregateSemanticJudgeRuns(semanticContract, [
    semanticRun(),
    semanticRun("fail"),
    semanticRun(),
  ]);
  assert.equal(unstable.dimensions[0]?.verdict, "abstain");
  assert.equal(unstable.dimensions[0]?.abstention_reason, "unstable_across_repeats");
});

test("Code Quality results must cite exact condition ids and levels", () => {
  assert.equal(
    validateCodeQualityJudgeRun(
      codeQualityContract,
      qualityRun({
        verdict: "fail",
        severity: "blocking",
        conditions: ["unrelated-production-change"],
      }),
    ).protocol_status,
    "valid",
  );
  assert.throws(
    () =>
      validateCodeQualityJudgeRun(
        codeQualityContract,
        qualityRun({ verdict: "fail", severity: "blocking", conditions: ["invented-condition"] }),
      ),
    /condition/i,
  );
  assert.throws(
    () =>
      validateCodeQualityJudgeRun(
        codeQualityContract,
        qualityRun({
          verdict: "fail",
          severity: "concern",
          conditions: ["unrelated-production-change"],
        }),
      ),
    /severity/i,
  );
});

test("three unanimous Code Quality runs preserve blocking authority", () => {
  const run = qualityRun({
    verdict: "fail",
    severity: "concern",
    conditions: ["avoidable-local-duplication"],
  });
  const result = aggregateCodeQualityJudgeRuns(codeQualityContract, [run, run, run]);
  assert.equal(result.dimensions[0]?.verdict, "fail");
  assert.equal(result.dimensions[0]?.severity, "concern");
  assert.deepEqual(result.dimensions[0]?.matched_condition_ids, ["avoidable-local-duplication"]);
});
