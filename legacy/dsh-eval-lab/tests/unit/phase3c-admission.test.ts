import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  buildJudgeAdmission,
  buildJudgeExecutionManifest,
  buildJudgeFreezeReceipt,
  buildJudgeLabelsUnsealReceipt,
} from "../../src/phase3c/index.js";

const sha = (value: string) => value.repeat(64);
const pointer = (name: string) => ({
  ref: `artifact://campaign/phase3c/${name}.json`,
  sha256: sha("a"),
});

const contract = {
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
  ],
  model_route: { provider: "openai-codex", model: "gpt-5.6-sol", reasoning_effort: "xhigh" },
  prompt_sha256: sha("b"),
  output_schema_sha256: sha("c"),
  calibration_admission_sha256: sha("d"),
  repeats_per_evaluation: 3 as const,
};

function caseSet(
  kind: "development" | "locked_admission" | "locked_bias",
  caseId: string,
  digest: string,
) {
  return {
    schema_version: 1 as const,
    set_id: `semantic-${kind}`,
    judge_kind: "semantic" as const,
    set_kind: kind,
    cases: [
      {
        case_id: caseId,
        input_closure_sha256: digest,
        risk_class: "critical" as const,
        canonical_case_id: kind === "locked_bias" ? "admission-case" : null,
        transform_id: kind === "locked_bias" ? "verbosity-transform" : null,
      },
    ],
  };
}

function labelSet(inputSet: ReturnType<typeof caseSet>, caseId: string) {
  return {
    schema_version: 1 as const,
    judge_kind: "semantic" as const,
    set_kind: inputSet.set_kind,
    input_set_sha256: canonicalJsonDigest(inputSet),
    labels: [
      {
        case_id: caseId,
        human_labels: [pointer(`${caseId}-label-a`), pointer(`${caseId}-label-b`)] as const,
        adjudication: pointer(`${caseId}-adjudication`),
        expected_dimensions: [
          {
            dimension_id: "requirement_intent_alignment" as const,
            applicability: "applicable" as const,
            verdict: "pass" as const,
            severity: "none" as const,
            matched_condition_ids: [],
            abstention_reason: null,
          },
        ],
      },
    ],
  };
}

function run(verdict: "pass" | "fail" = "pass") {
  return {
    schema_version: 1 as const,
    judge_kind: "semantic" as const,
    judge_contract_sha256: canonicalJsonDigest(contract),
    input_manifest_sha256: sha("e"),
    dimensions: [
      {
        dimension_id: "requirement_intent_alignment" as const,
        applicability: "applicable" as const,
        verdict,
        severity: verdict === "pass" ? ("none" as const) : ("blocking" as const),
        matched_condition_ids: [],
        evidence: [
          {
            source_ref: "artifact://campaign/phase3c/candidate.json",
            locator: "src/order-service.ts:1",
          },
        ],
        rationale: "Evidence-based result.",
        counterevidence: null,
        abstention_reason: null,
      },
    ],
    protocol_status: "valid" as const,
  };
}

function setup() {
  const development = caseSet("development", "development-case", sha("1"));
  const admission = caseSet("locked_admission", "admission-case", sha("2"));
  const bias = caseSet("locked_bias", "bias-case", sha("3"));
  const freeze = buildJudgeFreezeReceipt({
    judgeContract: contract,
    developmentSet: development,
    lockedAdmissionSet: admission,
    lockedBiasSet: bias,
    frozenAt: "2026-08-24T00:00:00.000Z",
  });
  const admissionExecution = buildJudgeExecutionManifest({
    freezeReceipt: freeze,
    judgeContract: contract,
    inputSet: admission,
    createdAt: "2026-08-24T00:01:00.000Z",
  });
  const biasExecution = buildJudgeExecutionManifest({
    freezeReceipt: freeze,
    judgeContract: contract,
    inputSet: bias,
    createdAt: "2026-08-24T00:01:00.000Z",
  });
  const admissionLabels = labelSet(admission, "admission-case");
  const biasLabels = labelSet(bias, "bias-case");
  const unseal = buildJudgeLabelsUnsealReceipt({
    freezeReceipt: freeze,
    admissionExecution,
    biasExecution,
    admissionLabels,
    biasLabels,
    unsealedAt: "2026-08-24T00:02:00.000Z",
  });
  return {
    development,
    admission,
    bias,
    freeze,
    admissionExecution,
    biasExecution,
    admissionLabels,
    biasLabels,
    unseal,
  };
}

test("Judge inputs are digest-disjoint before Freeze", () => {
  const value = setup();
  assert.equal(value.freeze.judge_kind, "semantic");
  const duplicate = caseSet("locked_bias", "bias-case", sha("2"));
  assert.throws(
    () =>
      buildJudgeFreezeReceipt({
        judgeContract: contract,
        developmentSet: value.development,
        lockedAdmissionSet: value.admission,
        lockedBiasSet: duplicate,
        frozenAt: "2026-08-24T00:00:00.000Z",
      }),
    /disjoint/i,
  );
});

test("Freeze, execution manifests, and label unseal form one ordered closure", () => {
  const value = setup();
  assert.equal(value.admissionExecution.freeze_receipt_sha256, canonicalJsonDigest(value.freeze));
  assert.equal(
    value.unseal.locked_admission_labels_sha256,
    canonicalJsonDigest(value.admissionLabels),
  );
  assert.equal(value.unseal.locked_bias_labels_sha256, canonicalJsonDigest(value.biasLabels));
});

test("Judge Admission requires exact unanimous dimension maps", () => {
  const value = setup();
  const admitted = buildJudgeAdmission({
    judgeContract: contract,
    freezeReceipt: value.freeze,
    admissionExecution: value.admissionExecution,
    biasExecution: value.biasExecution,
    admissionSet: value.admission,
    biasSet: value.bias,
    admissionLabels: value.admissionLabels,
    biasLabels: value.biasLabels,
    labelsUnsealReceipt: value.unseal,
    admissionRuns: { "admission-case": [run(), run(), run()] },
    biasRuns: { "bias-case": [run(), run(), run()] },
    admissionRunReceipts: { "admission-case": [pointer("a1"), pointer("a2"), pointer("a3")] },
    biasRunReceipts: { "bias-case": [pointer("b1"), pointer("b2"), pointer("b3")] },
  });
  assert.equal(admitted.status, "admitted");
  assert.equal(admitted.case_results[0]?.match, "pass");

  const rejected = buildJudgeAdmission({
    judgeContract: contract,
    freezeReceipt: value.freeze,
    admissionExecution: value.admissionExecution,
    biasExecution: value.biasExecution,
    admissionSet: value.admission,
    biasSet: value.bias,
    admissionLabels: value.admissionLabels,
    biasLabels: value.biasLabels,
    labelsUnsealReceipt: value.unseal,
    admissionRuns: { "admission-case": [run(), run("fail"), run()] },
    biasRuns: { "bias-case": [run(), run(), run()] },
    admissionRunReceipts: { "admission-case": [pointer("a1"), pointer("a2"), pointer("a3")] },
    biasRunReceipts: { "bias-case": [pointer("b1"), pointer("b2"), pointer("b3")] },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.case_results[0]?.match, "fail");
});
