import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), "contracts/commerce");
await mkdir(root, { recursive: true });

const behaviors = [
  "unpaid_cancel_has_no_refund",
  "paid_unshipped_creates_paid_amount_refund",
  "shipped_order_requires_after_sales",
  "cancellation_and_refund_states_are_separate",
  "inventory_release_is_exactly_once",
  "coupon_restore_requires_current_eligibility",
  "customer_ownership_is_enforced",
  "restart_recovery_preserves_idempotency_and_audit",
];
const calibrationCandidates = [
  "red",
  "gold",
  "mutant-shipped-cancel",
  "mutant-overrefund",
  "mutant-double-effects",
  "mutant-coupon-always-restored",
  "mutant-no-ownership-or-persistence",
  "gold-repeat",
  "gold-next-seed",
];
const counterexamples = calibrationCandidates.filter(
  (candidate) => !candidate.startsWith("gold"),
);
const expectedFailures = {
  red: behaviors,
  "mutant-shipped-cancel": ["shipped_order_requires_after_sales"],
  "mutant-overrefund": ["paid_unshipped_creates_paid_amount_refund"],
  "mutant-double-effects": [
    "inventory_release_is_exactly_once",
    "restart_recovery_preserves_idempotency_and_audit",
  ],
  "mutant-coupon-always-restored": ["coupon_restore_requires_current_eligibility"],
  "mutant-no-ownership-or-persistence": [
    "customer_ownership_is_enforced",
    "restart_recovery_preserves_idempotency_and_audit",
  ],
};
const object = (required, properties, extra = {}) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
  ...extra,
});
const array = (items, extra = {}) => ({ type: "array", items, ...extra });
const tuple = (items) => ({
  type: "array",
  prefixItems: items,
  items: false,
  minItems: items.length,
  maxItems: items.length,
});
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const strictBehaviorMap = (value) =>
  object(behaviors, Object.fromEntries(behaviors.map((behavior) => [behavior, value])));

const pointer = object(["ref", "sha256"], {
  ref: { type: "string", pattern: "^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$" },
  sha256: ref("sha256"),
});
const artifactPointer = object(["ref", "sha256"], {
  ref: {
    type: "string",
    pattern:
      "^artifact://campaign/(?!\\.{1,2}(?:/|$))(?!.*\\/\\.{1,2}(?:/|$))(?!.*//)[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$",
  },
  sha256: ref("sha256"),
});
const diagnostic = object(["code", "severity", "message", "evidence_refs"], {
  code: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$" },
  severity: { enum: ["info", "warning", "error"] },
  message: { type: "string", minLength: 1 },
  evidence_refs: array({ type: "string" }),
});
const validity = object(["overall", "dimensions", "reasons"], {
  overall: { enum: ["valid", "invalid", "insufficient"] },
  dimensions: object(["outcome", "mechanism", "cost"], {
    outcome: { enum: ["valid", "invalid", "insufficient"] },
    mechanism: { enum: ["valid", "invalid", "insufficient"] },
    cost: { enum: ["valid", "invalid", "insufficient"] },
  }),
  reasons: array(diagnostic),
});
const behaviorVector = strictBehaviorMap({ enum: ["pass", "fail", "error"] });
const traceability = object(["claim_to_behaviors", "behavior_to_claims"], {
  claim_to_behaviors: {
    type: "object",
    propertyNames: ref("id"),
    additionalProperties: array({ enum: behaviors }, { minItems: 1, uniqueItems: true }),
  },
  behavior_to_claims: strictBehaviorMap(
    array(ref("id"), { minItems: 1, uniqueItems: true }),
  ),
});
const residual = object(["claim_id", "axis", "reason_code"], {
  claim_id: ref("id"),
  axis: { enum: ["requirement_delta", "domain_preservation"] },
  reason_code: {
    enum: [
      "OBSERVATION_BINDING_MISSING",
      "OBSERVATION_TEMPLATE_UNSUPPORTED",
      "PROPOSED_CLAIM_RISK_UNSPECIFIED",
    ],
  },
});
const mechanism = object(
  ["goal_created", "goal_rounds_started", "goal_terminal_phase", "tool_calls", "turns", "steps"],
  {
    goal_created: { type: ["boolean", "null"] },
    goal_rounds_started: { type: ["integer", "null"], minimum: 0 },
    goal_terminal_phase: {
      type: ["string", "null"],
      enum: ["complete", "blocked", "paused", "active", "none", null],
    },
    tool_calls: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
    turns: { type: ["integer", "null"], minimum: 0 },
    steps: { type: ["integer", "null"], minimum: 0 },
  },
);
const cost = object(
  ["elapsed_ms", "input_tokens", "cached_input_tokens", "output_tokens", "failed_tool_calls"],
  Object.fromEntries(
    ["elapsed_ms", "input_tokens", "cached_input_tokens", "output_tokens", "failed_tool_calls"].map(
      (field) => [field, { type: ["integer", "null"], minimum: 0 }],
    ),
  ),
);
const costDelta = object(
  ["elapsed_ms", "input_tokens", "cached_input_tokens", "output_tokens", "failed_tool_calls"],
  Object.fromEntries(
    ["elapsed_ms", "input_tokens", "cached_input_tokens", "output_tokens", "failed_tool_calls"].map(
      (field) => [field, { type: ["integer", "null"] }],
    ),
  ),
);
const evaluationResult = object(
  [
    "schema_version",
    "template_id",
    "measurement_validity",
    "outcome",
    "mechanism",
    "cost",
    "hard_gates",
    "claim_strength",
    "effect_claim_eligible",
  ],
  {
    schema_version: { const: 2 },
    template_id: { const: "commerce-order-cancellation-v1" },
    measurement_validity: validity,
    outcome: object(
      [
        "externally_verified_completion",
        "behavior_vector",
        "completion_claim",
        "false_completion_claim",
      ],
      {
        externally_verified_completion: { type: ["boolean", "null"] },
        behavior_vector: behaviorVector,
        completion_claim: { enum: ["complete", "blocked", "absent"] },
        false_completion_claim: { type: ["boolean", "null"] },
      },
    ),
    mechanism,
    cost,
    hard_gates: {
      type: "object",
      additionalProperties: { enum: ["pass", "fail", "unknown"] },
    },
    claim_strength: { const: "diagnostic" },
    effect_claim_eligible: { const: false },
  },
);

const defs = {
  id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" },
  sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
  pointer,
  artifactPointer,
  behavior: { enum: behaviors },
  behaviorVector,
  traceability,
  residual,
  diagnostic,
  validity,
  evaluationResult,
  observationCatalog: object(
    [
      "schema_version",
      "catalog_id",
      "catalog_version",
      "task_id",
      "oracle_version",
      "template_id",
      "behaviors",
      "counterexamples",
    ],
    {
      schema_version: { const: 2 },
      catalog_id: { const: "commerce-order-cancellation-v1" },
      catalog_version: { const: 1 },
      task_id: { const: "open-coding-ts-commerce-order-v1" },
      oracle_version: { const: "commerce-order-oracle-v1" },
      template_id: { const: "commerce-order-cancellation-v1" },
      behaviors: tuple(
        behaviors.map((behavior) =>
          object(["behavior_id", "template_id", "statement", "risk_weight"], {
            behavior_id: { const: behavior },
            template_id: { const: "commerce-order-cancellation-v1" },
            statement: { type: "string", minLength: 1 },
            risk_weight: { type: "integer", minimum: 1, maximum: 5 },
          }),
        ),
      ),
      counterexamples: tuple(
        counterexamples.map((candidate) =>
          object(["candidate_id", "expected_failures"], {
            candidate_id: { const: candidate },
            expected_failures: tuple(
              expectedFailures[candidate].map((behavior) => ({ const: behavior })),
            ),
          }),
        ),
      ),
    },
  ),
  claimIr: object(
    [
      "schema_version",
      "template_id",
      "compiler",
      "source",
      "requirement",
      "claims",
      "semantic_residual",
      "traceability",
    ],
    {
      schema_version: { const: 2 },
      template_id: { const: "commerce-order-cancellation-v1" },
      compiler: object(["compiler_id", "compiler_version"], {
        compiler_id: { const: "phase3b1-commerce-compiler" },
        compiler_version: { const: 1 },
      }),
      source: object(
        [
          "domain_manifest",
          "contract",
          "requirement",
          "task_pack_sha256",
          "observation_catalog_sha256",
        ],
        {
          domain_manifest: pointer,
          contract: pointer,
          requirement: pointer,
          task_pack_sha256: ref("sha256"),
          observation_catalog_sha256: ref("sha256"),
        },
      ),
      requirement: object(["requirement_id", "requirement_version", "product_id"], {
        requirement_id: ref("id"),
        requirement_version: { type: "integer", minimum: 1 },
        product_id: ref("id"),
      }),
      claims: array(
        object(
          [
            "claim_id",
            "contract_version",
            "domain_id",
            "effect",
            "axis",
            "statement_sha256",
            "false_accept_risk",
            "false_reject_risk",
            "dependencies",
            "observation_bindings",
          ],
          {
            claim_id: ref("id"),
            contract_version: { type: "integer", minimum: 1 },
            domain_id: ref("id"),
            effect: { enum: ["uses", "preserves"] },
            axis: { enum: ["requirement_delta", "domain_preservation"] },
            statement_sha256: ref("sha256"),
            false_accept_risk: { enum: ["low", "medium", "high", "critical"] },
            false_reject_risk: { enum: ["low", "medium", "high", "critical"] },
            dependencies: array(ref("id"), { uniqueItems: true }),
            observation_bindings: array(
              object(["behavior_id", "entry_sha256"], {
                behavior_id: { enum: behaviors },
                entry_sha256: ref("sha256"),
              }),
              { minItems: 1 },
            ),
          },
        ),
        { minItems: 1 },
      ),
      semantic_residual: array(residual),
      traceability,
    },
  ),
  oraclePlan: object(
    [
      "schema_version",
      "template_id",
      "plan_id",
      "claim_ir_sha256",
      "task_pack_sha256",
      "observation_catalog_sha256",
      "oracle_version",
      "checks",
    ],
    {
      schema_version: { const: 2 },
      template_id: { const: "commerce-order-cancellation-v1" },
      plan_id: ref("id"),
      claim_ir_sha256: ref("sha256"),
      task_pack_sha256: ref("sha256"),
      observation_catalog_sha256: ref("sha256"),
      oracle_version: { const: "commerce-order-oracle-v1" },
      checks: tuple(
        behaviors.map((behavior) =>
          object(
            ["behavior_id", "template_id", "claim_ids", "axes", "risk_weight", "hard_gate"],
            {
              behavior_id: { const: behavior },
              template_id: { const: "commerce-order-cancellation-v1" },
              claim_ids: array(ref("id"), { minItems: 1, uniqueItems: true }),
              axes: array(
                { enum: ["requirement_delta", "domain_preservation"] },
                { minItems: 1, uniqueItems: true },
              ),
              risk_weight: { type: "integer", minimum: 1, maximum: 5 },
              hard_gate: { const: true },
            },
          ),
        ),
      ),
    },
  ),
  graderAdmission: object(
    [
      "schema_version",
      "template_id",
      "admission_id",
      "oracle_plan_sha256",
      "task_pack_sha256",
      "observation_catalog_sha256",
      "eval_package_sha256",
      "calibration",
      "behavior_coverage",
      "checks",
      "status",
      "diagnostics",
    ],
    {
      schema_version: { const: 2 },
      template_id: { const: "commerce-order-cancellation-v1" },
      admission_id: ref("id"),
      oracle_plan_sha256: ref("sha256"),
      task_pack_sha256: ref("sha256"),
      observation_catalog_sha256: ref("sha256"),
      eval_package_sha256: ref("sha256"),
      calibration: object(["seed", "vectors"], {
        seed: { type: "integer", minimum: 0 },
        vectors: object(
          calibrationCandidates,
          Object.fromEntries(calibrationCandidates.map((candidate) => [candidate, behaviorVector])),
        ),
      }),
      behavior_coverage: strictBehaviorMap(
        array({ enum: calibrationCandidates }, { uniqueItems: true }),
      ),
      checks: object(
        [
          "red_detected",
          "gold_passed",
          "counterexamples_matched",
          "repeatable",
          "seed_stable",
          "coverage_complete",
        ],
        Object.fromEntries(
          [
            "red_detected",
            "gold_passed",
            "counterexamples_matched",
            "repeatable",
            "seed_stable",
            "coverage_complete",
          ].map((name) => [name, { type: "boolean" }]),
        ),
      ),
      status: { enum: ["admitted", "rejected"] },
      diagnostics: array(
        object(["code", "message"], {
          code: { type: "string", pattern: "^[A-Z][A-Z0-9_]*$" },
          message: { type: "string", minLength: 1 },
        }),
      ),
    },
  ),
  variant: object(
    [
      "schema_version",
      "template_id",
      "variant_id",
      "common_patch_sha256",
      "arm_patch_sha256",
      "expected_goal_rows",
      "dsh_package_tree_sha256",
      "codex_connect_package_sha256",
      "eval_package_sha256",
      "model_route",
      "resolved_config_sha256",
      "tool_schema_sha256",
      "tools_mode",
      "permission_mode",
    ],
    {
      schema_version: { const: 2 },
      template_id: { const: "commerce-order-cancellation-v1" },
      variant_id: { enum: ["goal-off", "goal-on"] },
      common_patch_sha256: ref("sha256"),
      arm_patch_sha256: ref("sha256"),
      expected_goal_rows: object(["goal", "goal_round_driver", "command_goal", "tool_goal"], {
        goal: { type: "boolean" },
        goal_round_driver: { type: "boolean" },
        command_goal: { type: "boolean" },
        tool_goal: { type: "boolean" },
      }),
      dsh_package_tree_sha256: ref("sha256"),
      codex_connect_package_sha256: ref("sha256"),
      eval_package_sha256: ref("sha256"),
      model_route: object(["provider", "model", "reasoning_effort"], {
        provider: { const: "openai-codex" },
        model: { const: "gpt-5.6-sol" },
        reasoning_effort: { const: "xhigh" },
      }),
      resolved_config_sha256: ref("sha256"),
      tool_schema_sha256: ref("sha256"),
      tools_mode: { const: "native" },
      permission_mode: { const: "workspace-write" },
    },
    {
      allOf: [
        {
          if: { properties: { variant_id: { const: "goal-off" } } },
          then: {
            properties: {
              expected_goal_rows: {
                type: "object",
                properties: Object.fromEntries(
                  ["goal", "goal_round_driver", "command_goal", "tool_goal"].map((name) => [
                    name,
                    { const: false },
                  ]),
                ),
              },
            },
          },
        },
        {
          if: { properties: { variant_id: { const: "goal-on" } } },
          then: {
            properties: {
              expected_goal_rows: {
                type: "object",
                properties: Object.fromEntries(
                  ["goal", "goal_round_driver", "command_goal", "tool_goal"].map((name) => [
                    name,
                    { const: true },
                  ]),
                ),
              },
            },
          },
        },
      ],
    },
  ),
  experiment: object(
    [
      "schema_version",
      "template_id",
      "campaign_id",
      "created_at",
      "domain",
      "eval_pack_id",
      "task_pack_digest",
      "control_variant_digest",
      "treatment_variant_digest",
      "deployment",
      "intervention",
      "arm_order",
      "timeout_ms_per_arm",
      "claim_strength",
      "effect_claim_eligible",
    ],
    {
      schema_version: { const: 2 },
      template_id: { const: "commerce-order-cancellation-v1" },
      campaign_id: ref("id"),
      created_at: { type: "string", pattern: "Z$" },
      domain: { const: "open-coding-commerce-delivery" },
      eval_pack_id: { const: "open-coding-commerce-delivery-v1" },
      task_pack_digest: ref("sha256"),
      control_variant_digest: ref("sha256"),
      treatment_variant_digest: ref("sha256"),
      deployment: object(
        ["digest", "eval_package_sha256", "qualification", "grader_admission_sha256"],
        {
          digest: ref("sha256"),
          eval_package_sha256: ref("sha256"),
          qualification: object(
            [
              "schema_version",
              "ready",
              "deployment_digest",
              "session_id",
              "common_tool_schema_sha256",
            ],
            {
              schema_version: { const: 1 },
              ready: { const: true },
              deployment_digest: ref("sha256"),
              session_id: ref("id"),
              common_tool_schema_sha256: ref("sha256"),
            },
          ),
          qualification_projection: object(
            [
              "source_deployment_digest",
              "projected_deployment_digest",
              "source_qualification_sha256",
            ],
            {
              source_deployment_digest: ref("sha256"),
              projected_deployment_digest: ref("sha256"),
              source_qualification_sha256: ref("sha256"),
            },
          ),
          grader_admission_sha256: ref("sha256"),
        },
      ),
      intervention: object(["id", "allowed_config_paths"], {
        id: { const: "dsh-goal-stack" },
        allowed_config_paths: {
          type: "array",
          prefixItems: [
            { const: "goal.disabled" },
            { const: "goal-round-driver.disabled" },
            { const: "command-goal.disabled" },
            { const: "tool-goal.disabled" },
          ],
          items: false,
          minItems: 4,
          maxItems: 4,
        },
      }),
      arm_order: { enum: [["control", "treatment"], ["treatment", "control"]] },
      timeout_ms_per_arm: { type: "integer", minimum: 1, maximum: 5400000 },
      claim_strength: { const: "diagnostic" },
      effect_claim_eligible: { const: false },
    },
  ),
  pairedEvaluation: object(
    ["schema_version", "template_id", "campaign_id", "oracle_seed", "measurement_validity", "arms"],
    {
      schema_version: { const: 2 },
      template_id: { const: "commerce-order-cancellation-v1" },
      campaign_id: ref("id"),
      oracle_seed: artifactPointer,
      measurement_validity: validity,
      arms: object(["control", "treatment"], {
        control: object(["episode", "oracle", "candidate", "result"], {
          episode: artifactPointer,
          oracle: artifactPointer,
          candidate: object(["tree", "archive"], {
            tree: { type: "string", pattern: "^[0-9a-f]{40}$" },
            archive: artifactPointer,
          }),
          result: evaluationResult,
        }),
        treatment: { $ref: "#/$defs/pairedEvaluation/properties/arms/properties/control" },
      }),
    },
  ),
  pairedReport: object(
    [
      "schema_version",
      "template_id",
      "campaign_id",
      "experiment_digest",
      "measurement_validity",
      "arms",
      "cost_delta",
      "evidence",
      "known_blind_spots",
      "recommendation",
      "claim_strength",
      "effect_claim_eligible",
    ],
    {
      schema_version: { const: 2 },
      template_id: { const: "commerce-order-cancellation-v1" },
      campaign_id: ref("id"),
      experiment_digest: ref("sha256"),
      measurement_validity: validity,
      arms: object(["control", "treatment"], {
        control: evaluationResult,
        treatment: evaluationResult,
      }),
      cost_delta: costDelta,
      evidence: object(["experiment", "control_episode", "treatment_episode", "evaluation"], {
        experiment: artifactPointer,
        control_episode: artifactPointer,
        treatment_episode: artifactPointer,
        evaluation: artifactPointer,
      }),
      known_blind_spots: array(diagnostic),
      recommendation: object(["action", "rationale_codes"], {
        action: { enum: ["keep", "keep_baseline", "iterate", "revert", "run_more"] },
        rationale_codes: array({ type: "string" }, { minItems: 1 }),
      }),
      claim_strength: { const: "diagnostic" },
      effect_claim_eligible: { const: false },
    },
  ),
};

const behaviorResult = object(["behavior_id", "status", "evidence_ref"], {
  behavior_id: { enum: behaviors },
  status: { enum: ["pass", "fail", "error"] },
  evidence_ref: { type: "string", pattern: "^artifact://campaign/" },
});
const claimResult = object(["claim_id", "status", "behaviors"], {
  claim_id: ref("id"),
  status: { enum: ["pass", "fail", "error"] },
  behaviors: array(behaviorResult, { minItems: 1 }),
});
const axis = object(["status", "claims"], {
  status: { enum: ["pass", "fail", "error"] },
  claims: array(claimResult, { minItems: 1 }),
});
defs.deliveryReport = object(
  ["schema_version", "template_id", "evaluation_id", "source", "verdict", "axes", "traceability"],
  {
    schema_version: { const: 2 },
    template_id: { const: "commerce-order-cancellation-v1" },
    evaluation_id: ref("id"),
    source: object(
      [
        "domain_manifest_sha256",
        "requirement_sha256",
        "claim_ir_sha256",
        "oracle_plan_sha256",
        "grader_admission_sha256",
        "campaign_id",
        "paired_evaluation",
        "paired_report",
      ],
      {
        domain_manifest_sha256: ref("sha256"),
        requirement_sha256: ref("sha256"),
        claim_ir_sha256: ref("sha256"),
        oracle_plan_sha256: ref("sha256"),
        grader_admission_sha256: ref("sha256"),
        campaign_id: ref("id"),
        paired_evaluation: artifactPointer,
        paired_report: artifactPointer,
      },
    ),
    verdict: { enum: ["accept", "reject", "inconclusive"] },
    axes: object(
      ["requirement_delta", "domain_preservation", "semantic_residual", "measurement_validity", "harness_impact"],
      {
        requirement_delta: axis,
        domain_preservation: axis,
        semantic_residual: object(["status", "claims"], {
          status: { enum: ["not_required", "not_evaluated"] },
          claims: array(residual),
        }),
        measurement_validity: object(["status", "reason_codes"], {
          status: { enum: ["valid", "invalid", "insufficient"] },
          reason_codes: array({ type: "string" }, { uniqueItems: true }),
        }),
        harness_impact: object(["status", "changed_behaviors", "cost_delta"], {
          status: { enum: ["valid", "invalid", "insufficient"] },
          changed_behaviors: array({ enum: behaviors }, { uniqueItems: true }),
          cost_delta: costDelta,
        }),
      },
    ),
    traceability,
  },
);

const common = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dsh-eval-lab.local/contracts/commerce/common.schema.json",
  $defs: defs,
};
await writeFile(`${root}/common.schema.json`, `${JSON.stringify(common, null, 2)}\n`);

const faces = {
  "claim-observation-catalog": "observationCatalog",
  "claim-ir": "claimIr",
  "oracle-plan": "oraclePlan",
  "grader-admission": "graderAdmission",
  variant: "variant",
  experiment: "experiment",
  "paired-evaluation": "pairedEvaluation",
  "paired-report": "pairedReport",
  "delivery-evaluation-report": "deliveryReport",
};
for (const [file, definition] of Object.entries(faces)) {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://dsh-eval-lab.local/contracts/commerce/${file}.schema.json`,
    $ref: `common.schema.json#/$defs/${definition}`,
  };
  await writeFile(`${root}/${file}.schema.json`, `${JSON.stringify(schema, null, 2)}\n`);
}
