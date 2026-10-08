import { canonicalJsonDigest } from "../../src/contracts/canonical-json.js";
import {
  buildPhase3cDeliveryReport,
  judgeDefinitionDigest,
  PHASE3C_DIMENSIONS,
  PHASE3C_PUBLIC_OBSERVATION_CATALOG,
  TDD_SKILL_BINDING,
} from "../../src/phase3c/index.js";

export const phase3cSha = (value: string) => value.repeat(64);
export const phase3cPointer = (ref: string, sha256: string) => ({ ref, sha256 });
function tuple3<T>(values: readonly T[]): [T, T, T] {
  const [first, second, third, ...extra] = values;
  if (first === undefined || second === undefined || third === undefined || extra.length !== 0) {
    throw new Error("fixture requires exactly three values");
  }
  return [first, second, third];
}

export const validPhase3cAuthorityMap = {
  schema_version: 1 as const,
  catalog_sha256: canonicalJsonDigest(PHASE3C_PUBLIC_OBSERVATION_CATALOG),
  claim_ir_sha256: phase3cSha("1"),
  dimensions: PHASE3C_DIMENSIONS.map((dimensionId) => ({
    dimension_id: dimensionId,
    disposition:
      dimensionId === "cancel_order_outcome"
        ? ("deterministic" as const)
        : ("out_of_scope" as const),
    claim_ids: dimensionId === "cancel_order_outcome" ? ["claim-cancel"] : [],
    authority_refs: [
      phase3cPointer(`artifact://campaign/phase3c/authority/${dimensionId}.json`, phase3cSha("2")),
    ],
  })),
};

export const validPhase3cBoundary = {
  schema_version: 3 as const,
  boundary_id: "commerce-order-observation-boundary-v3" as const,
  template_id: "commerce-order-cancellation-v3" as const,
  source: {
    domain_manifest: phase3cPointer(
      "artifact://campaign/phase3c/source/domain.json",
      phase3cSha("3"),
    ),
    requirement: phase3cPointer(
      "artifact://campaign/phase3c/source/requirement.json",
      phase3cSha("4"),
    ),
    claim_ir: phase3cPointer(
      "artifact://campaign/phase3c/source/claim-ir.json",
      validPhase3cAuthorityMap.claim_ir_sha256,
    ),
    task_pack: phase3cPointer("artifact://campaign/phase3c/source/task-pack.json", phase3cSha("5")),
  },
  public_surface_sha256: phase3cSha("6"),
  public_observation_catalog_sha256: validPhase3cAuthorityMap.catalog_sha256,
  authority_map_sha256: canonicalJsonDigest(validPhase3cAuthorityMap),
  bindings: [
    {
      observation_id: "cancel-outcome",
      claim_id: "claim-cancel",
      axis: "requirement_delta" as const,
      dimension_ids: ["cancel_order_outcome" as const],
      stimulus_id: "paid_order" as const,
      expression: {
        type: "operation_status_is" as const,
        operation_id: "cancel_order" as const,
        expected_status: "accepted" as const,
      },
    },
  ],
  normal_form_version: "domain-observation-normal-form-v1" as const,
  runner_sha256: phase3cSha("7"),
};

export const validPhase3cDeterministicResult = {
  schema_version: 3 as const,
  template_id: "commerce-order-cancellation-v3" as const,
  boundary_sha256: canonicalJsonDigest(validPhase3cBoundary),
  candidate_archive: phase3cPointer(
    "artifact://campaign/phase3c/candidate/archive.tar.gz",
    phase3cSha("d"),
  ),
  candidate_tree_sha256_before: phase3cSha("e"),
  candidate_tree_sha256_after: phase3cSha("e"),
  seed: 1729,
  observations: [
    {
      observation_id: "cancel-outcome",
      claim_id: "claim-cancel",
      axis: "requirement_delta" as const,
      dimension_ids: ["cancel_order_outcome" as const],
      status: "pass" as const,
      normal_form_ref: phase3cPointer(
        "artifact://campaign/phase3c/deterministic-results/normal-form.json",
        phase3cSha("7"),
      ),
      evidence_refs: [
        phase3cPointer(
          "artifact://campaign/phase3c/deterministic-results/evidence.json",
          phase3cSha("8"),
        ),
      ],
    },
  ],
  measurement_validity: "valid" as const,
};

export const validPhase3cTaskRegistry = {
  schema_version: 1 as const,
  registry_id: "phase3c-tdd-task-registry-v1" as const,
  skill_binding_sha256: canonicalJsonDigest(TDD_SKILL_BINDING),
  tasks: [
    ["tdd-suitable", "TDD-suitable"],
    ["borderline", "borderline"],
    ["non-trigger", "non-trigger"],
    ["holdout", "holdout"],
  ].map(([taskId, bucket]) => ({
    schema_version: 1 as const,
    task_id: taskId,
    bucket,
    preconfirmed_test_seams: ["OrderService public API"],
    allowed_test_roots: ["tests"],
    allowed_production_roots: ["src"],
  })),
};

const judgeEvidence = [
  {
    source_ref: "artifact://campaign/phase3c/candidate.json",
    locator: "src/order-service.ts:1",
  },
];

const semanticExpectedDimension = {
  dimension_id: "requirement_intent_alignment" as const,
  applicability: "applicable" as const,
  verdict: "pass" as const,
  severity: "none" as const,
  matched_condition_ids: [],
  abstention_reason: null,
};

const codeQualityExpectedDimension = {
  dimension_id: "change_scope_discipline" as const,
  applicability: "applicable" as const,
  verdict: "pass" as const,
  severity: "none" as const,
  matched_condition_ids: [],
  abstention_reason: null,
};

function admittedJudge(
  judgeKind: "semantic" | "code_quality",
  expectedDimension: typeof semanticExpectedDimension | typeof codeQualityExpectedDimension,
  judgeDefinitionSha256: string,
) {
  const prefix = judgeKind === "semantic" ? "semantic" : "quality";
  const repeats = [
    phase3cPointer(`artifact://campaign/phase3c/${prefix}/repeat-1.json`, phase3cSha("1")),
    phase3cPointer(`artifact://campaign/phase3c/${prefix}/repeat-2.json`, phase3cSha("2")),
    phase3cPointer(`artifact://campaign/phase3c/${prefix}/repeat-3.json`, phase3cSha("3")),
  ] as const;
  return {
    schema_version: 1 as const,
    judge_kind: judgeKind,
    judge_definition_sha256: judgeDefinitionSha256,
    freeze_receipt_sha256: phase3cSha("4"),
    locked_admission_execution_sha256: phase3cSha("5"),
    locked_bias_execution_sha256: phase3cSha("6"),
    locked_admission_labels_sha256: phase3cSha("7"),
    locked_bias_labels_sha256: phase3cSha("8"),
    labels_unseal_receipt_sha256: phase3cSha("9"),
    run_receipts: [...repeats],
    case_results: [
      {
        case_id: `${prefix}-canonical`,
        repeat_results: repeats,
        observed_dimensions: [expectedDimension],
        expected_dimensions_sha256: canonicalJsonDigest([expectedDimension]),
        match: "pass" as const,
      },
    ],
    bias_results: [
      {
        case_id: `${prefix}-bias`,
        canonical_case_id: `${prefix}-canonical`,
        transform_id: "identifier-transform",
        repeat_results: repeats,
        observed_dimensions: [expectedDimension],
        expected_dimensions_sha256: canonicalJsonDigest([expectedDimension]),
        match: "pass" as const,
      },
    ],
    status: "admitted" as const,
  };
}

const semanticContractDefinition = {
  schema_version: 1 as const,
  judge_contract_id: "phase3c-semantic-judge-v1" as const,
  dimensions: [
    {
      dimension_id: "requirement_intent_alignment" as const,
      applicability: "required" as const,
      decision_rule: "The implementation fulfills the residual Requirement intent.",
      blocking: true,
      required_evidence: ["requirement_ref" as const, "code_location" as const],
    },
  ],
  model_route: {
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    reasoning_effort: "xhigh",
  },
  prompt_sha256: phase3cSha("a"),
  output_schema_sha256: phase3cSha("b"),
  calibration_admission_sha256: phase3cSha("0"),
  repeats_per_evaluation: 3 as const,
};
export const validPhase3cSemanticAdmission = admittedJudge(
  "semantic",
  semanticExpectedDimension,
  judgeDefinitionDigest(semanticContractDefinition),
);
export const validPhase3cSemanticContract = {
  ...semanticContractDefinition,
  calibration_admission_sha256: canonicalJsonDigest(validPhase3cSemanticAdmission),
};

export const validPhase3cSemanticResult = {
  schema_version: 1 as const,
  judge_kind: "semantic" as const,
  judge_contract_sha256: canonicalJsonDigest(validPhase3cSemanticContract),
  input_manifest_sha256: phase3cSha("9"),
  dimensions: [
    {
      dimension_id: "requirement_intent_alignment" as const,
      applicability: "applicable" as const,
      verdict: "pass" as const,
      severity: "none" as const,
      matched_condition_ids: [],
      evidence: judgeEvidence,
      rationale: "The residual requirement intent is fulfilled.",
      counterevidence: null,
      abstention_reason: null,
    },
  ],
  protocol_status: "valid" as const,
};

export const validPhase3cSemanticRuns = [
  validPhase3cSemanticResult,
  validPhase3cSemanticResult,
  validPhase3cSemanticResult,
] as const;
const semanticResultPointers = tuple3(
  validPhase3cSemanticRuns.map((result, index) =>
    phase3cPointer(
      `artifact://campaign/phase3c/semantic-judge/runs/repeat-${index + 1}/result.json`,
      canonicalJsonDigest(result),
    ),
  ),
);
export const validPhase3cSemanticRunReceipts = tuple3(
  semanticResultPointers.map((output, index) => ({
    schema_version: 1 as const,
    run_id: `semantic-fixture-r${index + 1}`,
    judge_kind: "semantic" as const,
    session_id: `semantic-session-${index + 1}`,
    session_transcript_sha256: phase3cSha(String(index + 1)),
    descriptor: phase3cPointer(
      `artifact://campaign/phase3c/semantic-judge/runs/repeat-${index + 1}/descriptor.json`,
      phase3cSha("d"),
    ),
    output,
    ended_at: `2026-08-24T00:00:0${index + 1}.000Z`,
    exit_code: 0,
    signal: null,
    timed_out: false,
    output_limit_exceeded: false,
    stdout_sha256: phase3cSha("e"),
    stderr_sha256: phase3cSha("f"),
    model_route_sha256: canonicalJsonDigest(validPhase3cSemanticContract.model_route),
    protocol_status: "valid" as const,
    diagnostic_codes: [],
  })),
);
const semanticReceiptPointers = tuple3(
  validPhase3cSemanticRunReceipts.map((receipt, index) =>
    phase3cPointer(
      `artifact://campaign/phase3c/semantic-judge/runs/repeat-${index + 1}/receipt.json`,
      canonicalJsonDigest(receipt),
    ),
  ),
);

export const validPhase3cSemanticAggregate = {
  ...validPhase3cSemanticResult,
  run_receipts: semanticReceiptPointers,
  repeat_results: semanticResultPointers,
} as const;

const codeQualityContractDefinition = {
  schema_version: 1 as const,
  rubric_id: "phase3c-code-quality-v1" as const,
  dimensions: [
    {
      dimension_id: "change_scope_discipline" as const,
      applicability: "required" as const,
      decision_rule: "The diff remains within the frozen Requirement scope.",
      required_evidence: ["code_location" as const, "base_or_diff_ref" as const],
      conditions: [
        {
          condition_id: "unrelated-production-change",
          level: "blocking" as const,
          statement: "The Candidate changes unrelated production behavior.",
          applicability: "An unrelated production path changed.",
          required_evidence: ["code_location" as const, "base_or_diff_ref" as const],
        },
      ],
    },
  ],
  model_route: validPhase3cSemanticContract.model_route,
  prompt_sha256: phase3cSha("c"),
  output_schema_sha256: phase3cSha("d"),
  calibration_admission_sha256: phase3cSha("0"),
  repeats_per_evaluation: 3 as const,
};
export const validPhase3cCodeQualityAdmission = admittedJudge(
  "code_quality",
  codeQualityExpectedDimension,
  judgeDefinitionDigest(codeQualityContractDefinition),
);
export const validPhase3cCodeQualityContract = {
  ...codeQualityContractDefinition,
  calibration_admission_sha256: canonicalJsonDigest(validPhase3cCodeQualityAdmission),
};

export const validPhase3cCodeQualityResult = {
  schema_version: 1 as const,
  judge_kind: "code_quality" as const,
  rubric_sha256: canonicalJsonDigest(validPhase3cCodeQualityContract),
  input_manifest_sha256: phase3cSha("b"),
  dimensions: [
    {
      dimension_id: "change_scope_discipline" as const,
      applicability: "applicable" as const,
      verdict: "pass" as const,
      severity: "none" as const,
      matched_condition_ids: [],
      evidence: judgeEvidence,
      rationale: "The change remains within scope.",
      counterevidence: null,
      abstention_reason: null,
    },
  ],
  protocol_status: "valid" as const,
};

export const validPhase3cCodeQualityRuns = [
  validPhase3cCodeQualityResult,
  validPhase3cCodeQualityResult,
  validPhase3cCodeQualityResult,
] as const;
const codeQualityResultPointers = tuple3(
  validPhase3cCodeQualityRuns.map((result, index) =>
    phase3cPointer(
      `artifact://campaign/phase3c/code-quality-judge/runs/repeat-${index + 1}/result.json`,
      canonicalJsonDigest(result),
    ),
  ),
);
export const validPhase3cCodeQualityRunReceipts = tuple3(
  codeQualityResultPointers.map((output, index) => ({
    schema_version: 1 as const,
    run_id: `quality-fixture-r${index + 1}`,
    judge_kind: "code_quality" as const,
    session_id: `quality-session-${index + 1}`,
    session_transcript_sha256: phase3cSha(String(index + 4)),
    descriptor: phase3cPointer(
      `artifact://campaign/phase3c/code-quality-judge/runs/repeat-${index + 1}/descriptor.json`,
      phase3cSha("c"),
    ),
    output,
    ended_at: `2026-08-24T00:01:0${index + 1}.000Z`,
    exit_code: 0,
    signal: null,
    timed_out: false,
    output_limit_exceeded: false,
    stdout_sha256: phase3cSha("d"),
    stderr_sha256: phase3cSha("e"),
    model_route_sha256: canonicalJsonDigest(validPhase3cCodeQualityContract.model_route),
    protocol_status: "valid" as const,
    diagnostic_codes: [],
  })),
);
const codeQualityReceiptPointers = tuple3(
  validPhase3cCodeQualityRunReceipts.map((receipt, index) =>
    phase3cPointer(
      `artifact://campaign/phase3c/code-quality-judge/runs/repeat-${index + 1}/receipt.json`,
      canonicalJsonDigest(receipt),
    ),
  ),
);

export const validPhase3cCodeQualityAggregate = {
  ...validPhase3cCodeQualityResult,
  run_receipts: codeQualityReceiptPointers,
  repeat_results: codeQualityResultPointers,
} as const;

export const validPhase3cHarnessEffectContract = {
  schema_version: 1 as const,
  contract_id: "tdd-skill-harness-effect-v1" as const,
  harness_binding_sha256: canonicalJsonDigest(TDD_SKILL_BINDING),
  task_registry_sha256: canonicalJsonDigest(validPhase3cTaskRegistry),
  opportunity_rules: [
    { bucket: "TDD-suitable" as const, expected_opportunity: "eligible" as const },
    { bucket: "borderline" as const, expected_opportunity: "unknown" as const },
    { bucket: "non-trigger" as const, expected_opportunity: "ineligible" as const },
    { bucket: "holdout" as const, expected_opportunity: "unknown" as const },
  ],
  activation: {
    source_schema_sha256: phase3cSha("e"),
    event_ids: [
      "skill_loaded",
      "first_test_write",
      "first_production_write",
      "focused_red",
      "focused_green",
      "full_suite_green",
      "refactor_after_green",
    ] as const,
    dependency_escape_event_id: "codebase_design_requested" as const,
  },
  quality_partial_order: {
    delivery: ["fail", "pass"] as const,
    semantic: ["fail", "pass"] as const,
    code_quality: ["fail", "concern", "pass"] as const,
  },
  cost: {
    rules: [
      ["elapsed_ms", "milliseconds"],
      ["input_tokens", "tokens"],
      ["cached_input_tokens", "tokens"],
      ["output_tokens", "tokens"],
      ["failed_tool_calls", "calls"],
    ].map(([metricId, unit]) => ({
      metric_id: metricId,
      unit,
      direction: "lower_is_better" as const,
      tolerance: 0,
      budget: { kind: "none" as const, value: null },
      missing_or_null: "insufficient" as const,
    })),
  },
  claim_strength_rules: {
    single_pair: "descriptive" as const,
    repeated_known_tasks: "diagnostic" as const,
    holdout_minimum: 2,
    effect_eligible_minimum: 6,
  },
};

const refs = {
  boundary: "artifact://campaign/phase3c/observation-boundary/boundary.json",
  deterministic: "artifact://campaign/phase3c/deterministic-results/result.json",
  semanticContract: "artifact://campaign/phase3c/semantic-judge/contract.json",
  semanticAdmission: "artifact://campaign/phase3c/semantic-judge/admission.json",
  semantic: "artifact://campaign/phase3c/semantic-judge/result.json",
  qualityContract: "artifact://campaign/phase3c/code-quality-judge/contract.json",
  qualityAdmission: "artifact://campaign/phase3c/code-quality-judge/admission.json",
  quality: "artifact://campaign/phase3c/code-quality-judge/result.json",
  tddBinding: "artifact://campaign/phase3c/harness-effect/tdd-skill-binding.json",
  taskRegistry: "artifact://campaign/phase3c/harness-effect/task-registry.json",
  harness: "artifact://campaign/phase3c/harness-effect/contract.json",
} as const;

export const validPhase3cReport = buildPhase3cDeliveryReport({
  evaluationId: "phase3c-fixture-evaluation",
  source: {
    observation_boundary: phase3cPointer(refs.boundary, canonicalJsonDigest(validPhase3cBoundary)),
    deterministic_observations: phase3cPointer(
      refs.deterministic,
      canonicalJsonDigest(validPhase3cDeterministicResult),
    ),
    semantic_judge_contract: phase3cPointer(
      refs.semanticContract,
      canonicalJsonDigest(validPhase3cSemanticContract),
    ),
    semantic_judge_admission: phase3cPointer(
      refs.semanticAdmission,
      canonicalJsonDigest(validPhase3cSemanticAdmission),
    ),
    semantic_judge: phase3cPointer(
      refs.semantic,
      canonicalJsonDigest(validPhase3cSemanticAggregate),
    ),
    code_quality_judge_contract: phase3cPointer(
      refs.qualityContract,
      canonicalJsonDigest(validPhase3cCodeQualityContract),
    ),
    code_quality_judge_admission: phase3cPointer(
      refs.qualityAdmission,
      canonicalJsonDigest(validPhase3cCodeQualityAdmission),
    ),
    code_quality_judge: phase3cPointer(
      refs.quality,
      canonicalJsonDigest(validPhase3cCodeQualityAggregate),
    ),
    tdd_skill_binding: phase3cPointer(refs.tddBinding, canonicalJsonDigest(TDD_SKILL_BINDING)),
    task_registry: phase3cPointer(refs.taskRegistry, canonicalJsonDigest(validPhase3cTaskRegistry)),
    harness_effect_contract: phase3cPointer(
      refs.harness,
      canonicalJsonDigest(validPhase3cHarnessEffectContract),
    ),
  },
  validity: {
    deterministic: "valid",
    semanticJudge: "valid",
    codeQualityJudge: "valid",
    harnessMechanism: "insufficient",
    cost: "valid",
    reasons: [],
  },
  delivery: {
    requirementDelta: validPhase3cDeterministicResult.observations,
    domainPreservation: [],
  },
  semantic: { required: true, dimensions: validPhase3cSemanticAggregate.dimensions },
  codeQuality: { dimensions: validPhase3cCodeQualityAggregate.dimensions },
  harnessEffect: {
    contractSha256: canonicalJsonDigest(validPhase3cHarnessEffectContract),
    status: "inconclusive",
    opportunity: "eligible",
    activation: "unknown",
    costDelta: {
      elapsed_ms: null,
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      failed_tool_calls: null,
    },
    claimStrength: "descriptive",
  },
  traceability: {
    claim_to_dimensions: { "claim-cancel": ["cancel_order_outcome"] },
    dimension_to_claims: { cancel_order_outcome: ["claim-cancel"] },
  },
});
