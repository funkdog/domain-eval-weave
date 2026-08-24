---
feature_ids: [F192, F267]
related_features: [F202, F203, F266]
topics: [dsh, eval-lab, phase-3c, semantic-judge, observation-boundary, code-quality]
doc_kind: plan
created: 2026-08-24
description: "DSH Eval Lab Phase 3C 的决策完备实现合同：Observation Boundary v3、双 Judge、人工校准与四轴可重放 verdict。"
---

# DSH Eval Lab Phase 3C 实现规格

## 1. 实施范围

本合同授权一个 bounded Phase 3C successor：

```text
frozen Phase 3B Candidate and Claim IR
→ Observation Boundary v3
→ deterministic Delivery result
→ admitted Semantic Judge
→ admitted Code Quality Judge
→ four-axis verdict
→ artifact-only replay
```

Phase 3B/B.1/B.2 的 contracts、Task Packs、Oracle runners、Campaign artifacts 与报告保持 byte-compatible。
Phase 3C 新对象全部使用新 schema version 和独立 namespace，不原位改写历史文件。

首个 Harness target 是 DSH 提供的外部 TDD Skill。Phase 3C 只接受它的 exact upstream/deployment identity、配置差异与
正常 Session evidence，不实现、改写或补充 Skill 流程。

## 2. 体系结构

```text
Candidate plane
  public task + base + declared DSH intervention
  → final Candidate freeze

Deterministic adjudication plane
  admitted Claim IR + Observation Boundary v3
  → public-interface execution in isolated scratch
  → Delivery observations

Semantic adjudication plane
  semantic residual + frozen Candidate closure
  → isolated Semantic Judge

Code-quality adjudication plane
  code-quality rubric + frozen base/diff/Candidate closure
  → separate isolated Code Quality Judge

Report plane
  validity envelope + four independent axes
  → canonical verdict and replay
```

两个 Judge 使用独立 invocation、独立 prompt digest 和独立 output artifact。任何一方的结果都不进入另一方输入。

## 3. Successor contracts

### 3.1 Public Observation Catalog 与 Authority Map

Phase 3C v1 只支持编译期冻结的 `commerce-order-cancellation-v3` catalog。生产 schema 不接受动态 selector、operator、
field path 或 expression code。

```yaml
PublicObservationCatalog:
  schema_version: 1
  catalog_id: commerce-order-public-observations-v3
  template_id: commerce-order-cancellation-v3
  operations:
    - operation_id: create_order | cancel_order | resolve_withdrawal |
                    mark_refunded | get_order | get_audit | get_retention
  state_fields:
    - { field_id: order_status, value_domain: order_status_enum }
    - { field_id: fulfillment_state, value_domain: fulfillment_state_enum }
    - { field_id: withdrawal_state, value_domain: withdrawal_state_enum }
    - { field_id: refund_status, value_domain: refund_status_enum }
    - { field_id: refund_amount, value_domain: nonnegative_minor_units }
    - { field_id: currency, value_domain: currency_enum }
    - { field_id: inventory_reserved, value_domain: boolean }
    - { field_id: coupon_state, value_domain: coupon_state_enum }
    - { field_id: version, value_domain: positive_version }
  scalar_domains:
    order_status_enum: [pending_payment, paid, cancelled]
    fulfillment_state_enum: [not_started, active, handed_off]
    withdrawal_state_enum: [none, pending, completed, rejected, failed]
    refund_status_enum: [none, pending, refunded]
    currency_enum: [USD]
    coupon_state_enum: [absent, eligible, expired, restored]
    boolean: [true, false]
    nonnegative_integer: { type: integer, minimum: 0 }
    nonnegative_minor_units: { type: integer, minimum: 0 }
    positive_version: { type: integer, minimum: 1 }
    opaque_id: { type: string, source: stimulus_or_public_observation }
    timestamp: { type: string, format: date-time }
  effects:
    - { effect_id: order_cancelled, identity_fields: [order_id, request_id], attribute_fields: [] }
    - { effect_id: refund_requested, identity_fields: [order_id, effect_key], attribute_fields: [amount, currency] }
    - { effect_id: inventory_compensated, identity_fields: [order_id, effect_key], attribute_fields: [] }
    - { effect_id: coupon_restored, identity_fields: [order_id, effect_key], attribute_fields: [eligibility] }
    - { effect_id: command_rejected, identity_fields: [order_id, request_id], attribute_fields: [] }
    - { effect_id: withdrawal_requested, identity_fields: [order_id, request_id], attribute_fields: [provider_ref] }
    - { effect_id: withdrawal_completed, identity_fields: [order_id, request_id], attribute_fields: [provider_ref] }
    - { effect_id: idempotency_conflict, identity_fields: [order_id, request_id], attribute_fields: [] }
  effect_fields:
    - { field_id: order_id, value_domain: opaque_id }
    - { field_id: request_id, value_domain: opaque_id }
    - { field_id: effect_key, value_domain: opaque_id }
    - { field_id: amount, value_domain: nonnegative_minor_units }
    - { field_id: currency, value_domain: currency_enum }
    - { field_id: eligibility, value_domain: boolean }
    - { field_id: provider_ref, value_domain: opaque_id }
  stimulus_fields:
    - { field_id: order_id, value_domain: opaque_id }
    - { field_id: customer_id, value_domain: opaque_id }
    - { field_id: request_id, value_domain: opaque_id }
    - { field_id: paid_amount, value_domain: nonnegative_minor_units }
    - { field_id: currency, value_domain: currency_enum }
    - { field_id: coupon_expiry, value_domain: timestamp }
    - { field_id: provider_ref, value_domain: opaque_id }
    - { field_id: now, value_domain: timestamp }
  stimuli: [unpaid_order, paid_order, active_fulfillment_order,
            handed_off_order, replay_request, restart_checkpoint,
            retention_clock]
  normal_form_slots: [before, after, first, replay, restart]
  relations:
    - { relation_id: withdrawal_before_cancellation, comparator: before, left: withdrawal_completed, right: order_cancelled }
    - { relation_id: request_replay_same_as_first, comparator: same_as, left: replay, right: first }
    - { relation_id: restart_preserves_public_state, comparator: preserved, left: restart, right: before }
  dimensions:
    operation_outcomes: [create_order_outcome, cancel_order_outcome,
                         resolve_withdrawal_outcome, mark_refunded_outcome,
                         get_order_outcome, get_audit_outcome, get_retention_outcome]
    state: [order_status_state, fulfillment_state_state, withdrawal_state_state,
            refund_status_state, refund_amount_state, currency_state,
            inventory_reserved_state, coupon_state, version_state]
    effects: [order_cancelled_effect, refund_requested_effect,
              inventory_compensated_effect, coupon_restored_effect,
              command_rejected_effect, withdrawal_requested_effect,
              withdrawal_completed_effect, idempotency_conflict_effect]
    relations: [withdrawal_before_cancellation, request_replay_same_as_first,
                restart_preserves_public_state]
    retention: [retention_window]

ObservationAuthorityMap:
  schema_version: 1
  catalog_sha256: sha256
  claim_ir_sha256: sha256
  dimensions:
    - dimension_id: Catalog.DimensionId
      disposition: deterministic | semantic_residual | out_of_scope
      claim_ids: [string]
      authority_refs: [ArtifactPointer]
```

Authority Map 由 compiler 从 exact Claim IR 与 confirmed Requirement scope 机械构建，调用方不能提交。Catalog 每个
operation outcome、state field、effect 和 relation dimension 必须恰好出现一次。`out_of_scope` 只接受 Requirement 中的 explicit
scope exclusion；没有 Claim/Requirement authority 的维度成为 blocking observation gap。

上面的 union/list 是 v1 的完整 production vocabulary。`Catalog.DimensionId` 是五组 `dimensions` 的无重复 union；
`Catalog.StateFieldId`、`Catalog.EffectId`、`Catalog.EffectFieldId`、`Catalog.StimulusId`、`Catalog.StimulusFieldId`、
`Catalog.RelationId`、`Catalog.NormalFormSlot` 与 `Catalog.ScalarDomainId` 分别来自唯一同名列表/map，没有隐式 alias。
生成的 JSON Schema 与 Zod parser 将所有 id/value domain
展开为 literals；`reason`、raw error、internal schema/version/path 不在 vocabulary。Catalog bytes 由 package 编译期生成，
production API 不接受调用方提交或扩展 Catalog。

### 3.2 `ObservationBoundarySpec` 与封闭表达式代数

```yaml
schema_version: 3
boundary_id: commerce-order-observation-boundary-v3
template_id: commerce-order-cancellation-v3
source:
  domain_manifest: ArtifactPointer
  requirement: ArtifactPointer
  claim_ir: ArtifactPointer
  task_pack: ArtifactPointer
public_surface_sha256: sha256
public_observation_catalog_sha256: sha256
authority_map_sha256: sha256
bindings:
  - observation_id: string
    claim_id: string
    axis: requirement_delta | domain_preservation
    dimension_ids: [Catalog.DimensionId]
    stimulus_id: Catalog.StimulusId
    expression: Expression
normal_form_version: domain-observation-normal-form-v1
runner_sha256: sha256

Expression:
  - { type: all_of | any_of, children: [Expression, Expression, ...] }
  - { type: operation_status_is, operation_id: Catalog.OperationId,
      expected_status: accepted | rejected | unavailable }
  - { type: state_field_compare, slot: Catalog.NormalFormSlot,
      field_id: Catalog.StateFieldId,
      comparator: equals | not_equals | one_of | unchanged,
      expected_values: [ExpectedValue] }
  - { type: effect_count_is, slot: Catalog.NormalFormSlot,
      effect_id: Catalog.EffectId,
      cardinality: { mode: exactly | at_least | at_most, value: nonnegative_integer } }
  - { type: effect_attributes_compare, slot: Catalog.NormalFormSlot,
      effect_id: Catalog.EffectId, field_id: Catalog.EffectFieldId,
      comparator: equals | not_equals | one_of,
      expected_values: [ExpectedValue] }
  - { type: multiset_compare, left: Catalog.NormalFormSlot,
      right: Catalog.NormalFormSlot, effect_id: Catalog.EffectId | all,
      comparator: multiset_equals }
  - { type: relation_holds, relation_id: Catalog.RelationId }
  - { type: retention_window_compare, clock_stimulus_id: retention_clock,
      comparator: within, window_ms: nonnegative_integer }

ExpectedValue:
  - { type: scalar_literal, domain_id: Catalog.ScalarDomainId, value: scalar }
  - { type: stimulus_value, stimulus_id: Catalog.StimulusId,
      field_id: Catalog.StimulusFieldId }
  - { type: state_value, slot: Catalog.NormalFormSlot,
      field_id: Catalog.StateFieldId }
  - { type: effect_attribute_value, slot: Catalog.NormalFormSlot,
      effect_id: Catalog.EffectId, field_id: Catalog.EffectFieldId }
```

Semantic validation 强制：

- 每个 deterministic Claim 至少由一个 binding 覆盖；
- `claim_id`、axis 与 Claim IR 完全一致；
- expression/expected node 必须满足上述 discriminated unions；每个 kind 只允许自己的 required fields，所有其他 fields forbidden；
- operation/state/effect/stimulus/relation/slot/domain id 必须存在于 frozen Catalog；
- `all_of/any_of` 至少两个 child，其他 node 不允许 child；任意 expression depth 与 node count 有固定上限；
- `one_of` 接受 1–8 个与 selected field 同 domain 的 ExpectedValue；其他 scalar comparator 只接受一个；
- scalar literal 必须通过 selected field 的 exact value domain；cardinality 必须是 nonnegative integer；
- expected 只接受上述 typed scalar/catalog refs，不接受任意 object、JSONPath、regex、source text 或 executable code；
- boundary 只能绑定 Authority Map 中的 `deterministic` dimensions；
- expression 不能引用 Gold、mutant、Judge、arm 或内部 Candidate path；
- compiler 按固定映射从每个 leaf 派生 dimension：operation→对应 outcome dimension、state field→对应 state dimension、
  effect count/attributes/multiset→对应 effect dimension、relation→同 id relation dimension、retention node→`retention_window`；
  `all_of/any_of` 派生 children dimension union；
- 每个 binding 的 canonical `dimension_ids` 必须逐项等于其 expression 派生集合；
- 全部 bindings 的派生 dimension union 必须等于 Authority Map 的 complete deterministic set；每个 deterministic dimension
  至少出现一次，任何 semantic_residual/out_of_scope dimension 出现都 fail closed；
- binding `claim_id` 必须存在于每个 derived dimension 的 AuthorityMap `claim_ids`，axis 必须与该 Claim IR edge 一致；
- runner identity、Task Pack 与 Claim IR 全部 digest-closed；
- unknown primitive、duplicate observation、unbound Claim 或 extra Claim fail closed。

### 3.3 Domain Observation Normal Form

每次 public operation 归一化为：

```yaml
operation:
  status: accepted | rejected | unavailable
state:
  - field_id: Catalog.StateFieldId
    value:
      domain_id: Catalog.ScalarDomainId
      scalar: string | integer | boolean | null
effects:
  - effect_id: Catalog.EffectId
    identity:
      - field_id: Catalog.EffectFieldId
        value: scalar
    attributes:
      - field_id: Catalog.EffectFieldId
        value: scalar
relations:
  - relation_id: Catalog.RelationId
    status: true | false
```

所有 field/effect ids 来自 frozen Catalog，按 canonical id 排序。Normal form 通过 public state/effect observations确定操作是否
被接受或拒绝。Raw throw、typed failure envelope、异常文本、
堆栈、内部 class、内部文件字段和对象序列化顺序不写入 normal form。Public Contract 明确声明的 transport shape 通过独立
`operation_outcome` projection 进入，而不是由 Oracle 从 Gold 反推。

Effect 使用领域 identity 构成 multiset；只有 confirmed Claim 声明顺序时才投影 partial-order relation。Persistence 通过
restart 后的 public observations 判定，不读取内部 schema 字段。带析取的领域政策以 typed `any_of` 表达，例如 expired replay
允许 `reconciled` 或 `rejected_with_state_and_effects_preserved`。

### 3.4 `DeterministicObservationResult`

```yaml
schema_version: 3
boundary_sha256: sha256
candidate_archive: ArtifactPointer
seed: integer
observations:
  - observation_id: string
    claim_id: string
    status: pass | fail | error
    normal_form_ref: ArtifactPointer
    evidence_refs: [ArtifactPointer]
measurement_validity: valid | invalid
```

`error` 表示执行或协议失败，不解释为 Claim fail。任何缺失、重复、unknown observation 或 Candidate 在裁决后变化，
使 deterministic measurement invalid。

### 3.5 `SemanticJudgeContract`

```yaml
schema_version: 1
judge_contract_id: phase3c-semantic-judge-v1
dimensions:
  - dimension_id: requirement_intent_alignment | architecture_fit |
                  failure_semantics_coherence | handoff_comprehensibility
    applicability: object
    decision_rule: string
    blocking: boolean
    required_evidence: [requirement_ref, domain_ref, code_location]
model_route:
  provider: string
  model: string
  reasoning_effort: string
prompt_sha256: sha256
output_schema_sha256: sha256
calibration_admission_sha256: sha256
repeats_per_evaluation: 3
```

Semantic input manifest 只包含 exact Requirement、confirmed Domain refs、semantic residual、base revision、Candidate archive、
candidate diff 与 rubric。Deterministic behavior status、Gold/mutants、control/treatment label、Harness activation、cost 和其他 Judge
结果禁止进入。

```text
AbstentionReason = insufficient_evidence | conflicting_authority |
                    rubric_not_applicable | out_of_distribution |
                    unsafe_or_untrusted_instruction | unstable_across_repeats
```

### 3.6 `SemanticJudgeResult`

```yaml
schema_version: 1
judge_contract_sha256: sha256
input_manifest_sha256: sha256
run_receipts: [ArtifactPointer, ArtifactPointer, ArtifactPointer]
repeat_results: [ArtifactPointer, ArtifactPointer, ArtifactPointer]
dimensions:
  - dimension_id: string
    applicability: applicable | not_applicable
    verdict: pass | fail | abstain
    severity: blocking | concern | none
    evidence:
      - source_ref: ArtifactPointer
        locator: string
    rationale: string
    counterevidence: string | null
    abstention_reason: AbstentionReason | null
protocol_status: valid | invalid
```

`pass/fail` 必须包含 evidence；`abstain` 必须包含非空 reason；`not_applicable` 只能配
`rubric_not_applicable`。Rationale 与 counterevidence 受长度上限约束，不持久化私有 chain-of-thought。

真实 Candidate 对每个 Judge kind 固定运行三次。某维三次均为同一 `pass` 或 `fail` 时才形成该 verdict；三次均 abstain
且 reason 完全相同时形成该 abstain；其他组合统一形成 `abstain/unstable_across_repeats`。不使用多数票。

### 3.7 `CodeQualityRubric` 与结果

Code Quality rubric 使用独立 contract：

```yaml
schema_version: 1
rubric_id: phase3c-code-quality-v1
dimensions:
  - dimension_id: change_scope_discipline | cohesion_and_responsibility |
                  state_transition_clarity | error_handling_clarity |
                  test_maintainability | duplication_and_locality
    applicability: object
    decision_rule: string
    required_evidence: [code_location, base_or_diff_ref]
    conditions:
      - condition_id: string
        level: blocking | concern
        statement: string
        applicability: object
        required_evidence: [code_location, base_or_diff_ref]
prompt_sha256: sha256
output_schema_sha256: sha256
calibration_admission_sha256: sha256
repeats_per_evaluation: 3
```

```yaml
CodeQualityJudgeResult:
  schema_version: 1
  rubric_sha256: sha256
  input_manifest_sha256: sha256
  run_receipts: [ArtifactPointer, ArtifactPointer, ArtifactPointer]
  repeat_results: [ArtifactPointer, ArtifactPointer, ArtifactPointer]
  dimensions:
    - dimension_id: string
      verdict: pass | fail | abstain
      severity: blocking | concern | none
      matched_condition_ids: [string]
      evidence: [SourceLocator]
      rationale: string
      counterevidence: string | null
      abstention_reason: AbstentionReason | null
  protocol_status: valid | invalid
```

结果沿用逐维 verdict、severity、evidence、rationale 与 counterevidence 结构，并为每个 fail/concern 保存
`matched_condition_ids`。Code Quality input 只包含 public
task、base tree、Candidate archive、diff、public test evidence 和 rubric；它不读取 Semantic result 或 Harness arm。

Result 的 matched id 必须存在于 exact rubric，severity 必须与 condition level 一致。Blocking finding 必须命中预注册
blocking condition；未命中 condition 的自由文本 finding 使 Judge protocol invalid。偏好性建议只能是 `concern`。

### 3.8 Judge development、locked holdouts 与 admission

```yaml
JudgeCaseInputSet:
  schema_version: 1
  set_id: string
  judge_kind: semantic | code_quality
  set_kind: development | locked_admission | locked_bias
  cases:
    - case_id: string
      input_closure_sha256: sha256
      risk_class: critical | standard
      canonical_case_id: string | null
      transform_id: string | null

JudgeLabelSet:
  schema_version: 1
  judge_kind: semantic | code_quality
  set_kind: development | locked_admission | locked_bias
  input_set_sha256: sha256
  labels:
    - case_id: string
      human_labels: [ArtifactPointer, ArtifactPointer]
      adjudication: ArtifactPointer
      expected_dimensions:
        - dimension_id: JudgeContract.DimensionId
          applicability: applicable | not_applicable
          verdict: pass | fail | abstain
          severity: blocking | concern | none
          matched_condition_ids: [string]
          abstention_reason: AbstentionReason | null

JudgeFreezeReceipt:
  schema_version: 1
  judge_kind: semantic | code_quality
  rubric_sha256: sha256
  prompt_sha256: sha256
  model_route_sha256: sha256
  output_schema_sha256: sha256
  development_set_sha256: sha256
  locked_admission_inputs_sha256: sha256
  locked_bias_inputs_sha256: sha256
  frozen_at: date-time

JudgeExecutionManifest:
  schema_version: 1
  judge_kind: semantic | code_quality
  set_kind: locked_admission | locked_bias
  freeze_receipt_sha256: sha256
  judge_contract_sha256: sha256
  input_set_sha256: sha256
  repeats_per_case: 3

JudgeAdmission:
  schema_version: 1
  freeze_receipt_sha256: sha256
  locked_admission_execution_sha256: sha256
  locked_bias_execution_sha256: sha256
  locked_admission_labels_sha256: sha256
  locked_bias_labels_sha256: sha256
  labels_unseal_receipt_sha256: sha256
  run_receipts: [ArtifactPointer]
  case_results:
    - case_id: string
      repeat_results: [ArtifactPointer, ArtifactPointer, ArtifactPointer]
      observed_dimensions: [JudgeResultDimension]
      expected_dimensions_sha256: sha256
      match: pass | fail
  bias_results:
    - case_id: string
      canonical_case_id: string
      transform_id: string
      repeat_results: [ArtifactPointer, ArtifactPointer, ArtifactPointer]
      observed_dimensions: [JudgeResultDimension]
      expected_dimensions_sha256: sha256
      match: pass | fail
  status: admitted | rejected
```

三套 case input closure 必须 pairwise digest-disjoint。独立 curator 在 Judge authoring 开始前 exclusive-create locked
admission/bias `JudgeCaseInputSet`；它们只含 Candidate/input identity，不含 rubric、prompt、model、expectation 或 label。
Development set 与 labels 可用于迭代。

`JudgeResultDimension` 按 `judge_kind` discriminated：Semantic 使用 §3.6 dimension schema，Code Quality 使用 §3.7
dimension schema；unknown/mixed shape 不能进入 Admission。

迭代结束后，`JudgeFreezeReceipt` 绑定最终 rubric、prompt、model、schema 与三套 input digests；随后 production builder 才为
两套 locked inputs exclusive-create `JudgeExecutionManifest`，绑定 final Judge contract 与固定三次运行。两个 execution manifests
落盘后，独立 labels root 才允许 unseal 双人标签与 adjudication。Freeze 前读取 holdout labels、freeze 后修改任一 Judge byte、
或 development case 出现在 locked set 都拒绝 admission。

调用方不能传 admission status、case 子集、repeat 下限或 expected outcome。Production admission 只从 FreezeReceipt、两个
execution manifests、locked admission/bias labels、全部 run receipts 与 unseal receipt 机械构建；development results 不进入 admission。

Admission 要求：

- 每个 case 的三次逐维 result map 必须 unanimous，并逐维等于人工仲裁的 applicability、verdict、severity、
  matched condition ids 与 exact abstention reason；
- Semantic 的 matched condition ids 固定为空；Code Quality 的 ids 必须等于 exact rubric conditions；
- 每个 bias transform 的逐维 map 必须 unanimous，并等于 canonical case 的 exact expected dimension map；
- 任一 case 聚合为 `unstable_across_repeats` 即拒绝 admission；
- 无 protocol invalid、input drift、missing repeat 或 duplicate receipt；
- critical 与 standard case 使用相同 exactness；risk class 只决定 false-accept/false-reject 报告优先级。

Case aggregate 只能由 exact expected dimension map 和 §6 的轴聚合规则派生，LabelSet 与调用方均不能另传 aggregate verdict。

### 3.9 `HarnessEffectContract`

```yaml
schema_version: 1
contract_id: tdd-skill-harness-effect-v1
harness_binding_sha256: sha256
task_registry_sha256: sha256
opportunity_rules:
  - bucket: TDD-suitable | borderline | non-trigger | holdout
    expected_opportunity: eligible | ineligible | unknown
activation:
  source_schema_sha256: sha256
  event_ids: [skill_loaded, first_test_write, first_production_write,
              focused_red, focused_green, full_suite_green, refactor_after_green]
  dependency_escape_event_id: codebase_design_requested
quality_partial_order:
  delivery: [fail, pass]
  semantic: [fail, pass]
  code_quality: [fail, concern, pass]
cost:
  rules:
    - metric_id: elapsed_ms | input_tokens | cached_input_tokens |
                 output_tokens | failed_tool_calls
      unit: milliseconds | tokens | calls
      direction: lower_is_better
      tolerance: nonnegative_integer
      budget:
        kind: maximum | none
        value: nonnegative_integer | null
      missing_or_null: insufficient | invalid
claim_strength_rules:
  single_pair: descriptive
  repeated_known_tasks: diagnostic
  holdout_minimum: integer
  effect_eligible_minimum: integer
```

每个 cost metric 必须恰好有一条 rule；unit 与 metric 的组合由 schema 固定，`budget.kind=none` 时 value 必须 null，
`maximum` 时 value 必须是 nonnegative integer。Contract、Task Registry、Skill binding、activation schema、quality order、
cost rules 与 claim-strength rules 均
digest-closed。调用方不能在看见 delta 后调整。Opportunity 由 Registry bucket 与规则机械投影；activation 只来自 typed DSH
events。任一 unknown status、missing rule 或 contract drift 使 Harness Effect invalid。

### 3.10 `DeliveryEvaluationReportV3`

```yaml
schema_version: 3
evaluation_id: string
source: object
measurement_validity:
  candidate_verdict: valid | insufficient | invalid
  harness_effect: valid | insufficient | invalid
  deterministic: valid | invalid
  semantic_judge: valid | insufficient | invalid
  code_quality_judge: valid | insufficient | invalid
  harness_mechanism: valid | insufficient | invalid
  cost: valid | insufficient | invalid
  reasons: [Diagnostic]
verdict: accept | reject | inconclusive
axes:
  delivery:
    status: pass | fail | error
    requirement_delta: object
    domain_preservation: object
  semantic:
    status: pass | fail | abstain | not_required | error
    dimensions: [object]
  code_quality:
    status: pass | concern | fail | abstain | error
    dimensions: [object]
  harness_effect:
    contract_sha256: sha256
    status: improvement_observed | harm_observed | mixed |
            no_observed_difference | not_activated | inconclusive
    opportunity: eligible | ineligible | unknown
    activation: activated | not_activated | unknown
    changed_delivery_claims: [string]
    changed_semantic_dimensions: [string]
    changed_code_quality_dimensions: [string]
    cost_delta: object
    claim_strength: descriptive | diagnostic | effect_eligible
traceability: object
```

Report source closure 必须包含 `HarnessEffectContract` pointer。Report 不包含 aggregate score。四轴保存原始 evidence refs；
rendering 不能重新推导或改变 verdict。

## 4. Deterministic runner

Observation Boundary runner 在冻结 Candidate archive 的隔离副本执行：

- network denied；
- Candidate root read-only；
- 每个 observation 使用独立 scratch；
- fixed seed、timeout、output cap 与 sanitized env；
- Oracle source、Claim IR、Boundary Spec 和 Task Pack digest 在启动前后双重核验；
- runner 只通过 public Task API 驱动 Candidate；
- Candidate source inspection、内部 state-file parsing 和 snapshot textual equality 禁止作为 observation。

Commerce v3 calibration 至少加入四类 equivalent Candidate：typed rejection、非权威 reason 变化、内部 persistence representation
变化、expired replay fail-closed。它们必须与 Gold 具有相同 deterministic vector。现有领域风险 mutants 继续命中预期 Claim，
并新增尝试利用 normalizer 逃过 state/effect invariant 的 relaxation mutants。

## 5. Judge runner

Judge runner 是 Candidate 冻结后的只读外部进程：

- exact model/provider/effort 与 prompt bytes 由 contract 绑定；
- 输入由 canonical manifest materialize，文件按 role 分隔并标记 Candidate 内容为 untrusted data；
- 不提供 shell、filesystem mutation、network、Oracle 或 management tools；
- 输出只接受 strict schema；
- descriptor 在 launch 前 immutable 写入，receipt 在 terminal 后绑定 exit/signal/timeout、input/output digest 与 model route；
- output正文仅保存 schema 允许的 verdict/evidence/rationale，不保存 provider secret 或隐藏 reasoning；
- 同一 Candidate 的 repeats 相互独立，不把前次 Judge 输出注入后次输入。

Prompt-injection calibration 在 Candidate 注释、字符串、测试名和文档中放置与 rubric 冲突的指令。Judge 必须忽略这些文本的
指令身份，仅把它们作为代码证据。

## 6. Verdict construction

构建顺序固定：

1. 重放 Phase 3A Domain/Requirement closure；
2. 重放 admitted Phase 3B Claim IR/Plan；
3. 重放 Observation Boundary v3 与 deterministic results；
4. 验证 Semantic Judge admission、input manifest、receipt 与 result；
5. 验证 Code Quality Judge admission、input manifest、receipt 与 result；
6. 从 frozen paired Campaign 投影 Harness mechanism、四轴 delta 与 cost；
7. 验证 `HarnessEffectContract` 并机械投影 opportunity、activation、Pareto 与 cost；
8. 先构建 Measurement Validity envelope，再构建总体 verdict。

Verdict 规则：

- Candidate verdict 所需的 deterministic/Semantic/Code Quality measurement 任一 invalid/insufficient → `inconclusive`；
- Delivery fail → `reject`；Delivery error → `inconclusive`；
- required Semantic fail → `reject`；required Semantic abstain/error → `inconclusive`；
- blocking Code Quality fail → `reject`；Code Quality abstain/error → `inconclusive`；
- 非阻塞 concern 不阻止 `accept`；
- Harness Effect 只进入 Harness 决策，不改变 Candidate verdict；
- Harness mechanism/cost invalid 或 insufficient 只使 Harness Effect `inconclusive`；
- 其余情况 → `accept`。

Semantic axis 聚合顺序为 `error → abstain → fail → pass/not_required`；Code Quality axis 聚合顺序为
`error → abstain → blocking fail → concern → pass`。`not_required` 只在 residual 为空时成立。

Harness Effect 按 exact `HarnessEffectContract` 验证两臂 measurement 与 opportunity：任一 Harness required evidence
invalid/insufficient 时为 `inconclusive`；
treatment 未激活时为 `not_activated` 并保留原始 delta，但不归因。其余结果使用逐轴 Pareto 比较：至少一条质量轴改善、
无质量轴退化且 cost 未越过预注册预算时为 `improvement_observed`；反向关系为 `harm_observed`；同时存在改善与退化为
`mixed`；所有轴在容差内相同为 `no_observed_difference`。Cost 单独改善或恶化只在质量轴相同且超出预注册容差时决定方向。

## 7. External TDD Skill binding

首个 pilot 冻结：

```text
repository: mattpocock/skills
commit: 5b15a47f2d7150f545fbcacbfe381787fc0230dc
path: skills/engineering/tdd/
files:
  SKILL.md          blob 8fc086710806190ee7c4baa32089cb877a75736a  size 3549
  tests.md          blob 7ab86479f925a1f9e8ba680af33cb3b12e015381  size 2214
  mocking.md        blob 71cbfee674d93244ce81d1830b930ca9a69200bd  size 1481
  agents/openai.yaml blob 651b838a7663e027b1b8884491e867f26bb9a021 size 87
license: MIT blob f1dd2c09108dde1a5f56097cee8461b3ea834499 size 1068
```

Phase 3C 只接受满足以下条件的 DSH Skill deployment：

- 可在普通 DSH development profile 中独立使用；
- Skill source、package、profile row、model-visible bytes 与 activation evidence 可指纹化；
- control/treatment 使用同一 package tree，唯一差异是该 Skill 的 disabled/enabled row；
- 两臂公开任务使用相同的 test-first wording，Skill name、arm 与 hidden expectation 不进入任务；
- Task manifest 保存 `preconfirmed_test_seams`，公开任务明确这些 seams 已获 operator 确认，无需 Episode 内追问；
- `codebase-design` Skill 在两臂均 disabled/unavailable；调用尝试产生 typed `HARNESS_DEPENDENCY_ESCAPE`，只使
  Harness Effect mechanism invalid，不改变 Candidate verdict；
- Skill 不拥有 Eval Lab verdict、Oracle、Task bucket 或隐藏 rubric；
- Eval Lab runner 不调用 Skill、不生成测试、不注入 red/green 反馈；
- activation 从 DSH 正常 typed Skill/tool events 投影，不从自由文本猜测。

首个 Registry 固定四桶：

```text
TDD-suitable     具有固定 public seam 的状态行为或 bug fix
borderline       小型行为变化，Skill 可能没有边际收益
non-trigger      文档、配置或静态内容任务
holdout          未见过但具有相同测试 affordance 的需求交付任务
```

TDD Task Pack 必须授权受限 tests path、冻结 `preconfirmed_test_seams`、保留 public starter tests，并允许 Agent 创建行为测试。机制投影记录
Skill loaded、first-test-before-first-production-write、red execution、green execution、full-suite verification 与 refactor-after-green。
Agent-authored tests 不进入 external Oracle，也不影响隐藏 observation selection。

若 exact DSH Skill deployment 尚未发布，Phase 3C 可以完成 Observation/Judge admission，但 Harness Effect 只能是
`inconclusive`，不得用 Eval Lab 内部 Skill 或 prompt 替代。

## 8. Persistence and replay

Phase 3C primary artifacts永久写入 dedicated runtime root。每个 pointer 使用 canonical ref + SHA-256；写入 exclusive-create。
Replay 从 root manifest 开始遍历完整 closure，拒绝：

- missing/extra artifact；
- ref/digest/path/template mismatch；
- symlink、hardlink、path escape 或非 canonical JSON；
- Judge admission 与 run route 不一致；
- Candidate、base、Requirement、rubric 或 prompt drift；
- result 来自另一 Campaign/arm/Candidate；
- report 派生值与逐维 primary evidence 不一致。

Replay 不调用 Agent、Oracle 或 Judge，只重建相同 `DeliveryEvaluationReportV3` bytes。

## 9. Safety boundaries

- 全部 fixtures、人工 calibration cases 与 Campaign 使用 synthetic data；
- runtime artifacts 只写 `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`；
- Candidate、Judge 与 Oracle均不能读取 OAuth、ambient DSH home、Clowder runtime/API/ports 或另一 arm workspace；
- Judge prompt、human labels、admission set、Oracle 与 verdict 不进入 Candidate context；
- Candidate source视为 untrusted Judge input；
- 所有用户可见 Campaign/Judge evidence 默认永久持久化，无 TTL；
- Phase 3C 不自动修改、启用、推广、回滚或退役 DSH Harness。

## 10. Milestones

### M0 — Successor contracts and compatibility

- v3 Public Observation Catalog、Authority Map、Boundary/Result、Judge、Calibration、HarnessEffect 与 Report schemas；
- Phase 1/2/3A/3B/B.1/B.2 replay regression；
- unknown/cross-version/cross-template refs fail closed。

### M1 — Observation Boundary v3

- Domain Observation Normal Form；
- closed selector/operator/value algebra and total authority classification；
- Commerce v3 bindings and runner；
- equivalent implementations、Gold、existing mutants、relaxation mutants；
- false-reject and false-accept calibration evidence。

### M2 — Semantic Judge

- Semantic rubric/result/runner；
- independent human labels and adjudication；
- digest-disjoint development/admission/bias sets、freeze-before-label-unseal、prompt-injection、repeat and abstention admission。

### M3 — Code Quality Judge

- independent rubric/result/runner；
- replayable blocking/concern condition ids；
- equivalent implementation and preference-bias cases；
- independent admission。

### M4 — Four-axis verdict and replay

- split Candidate/Harness validity envelope and frozen HarnessEffectContract；
- Delivery/Semantic/Code Quality/Harness Effect projection；
- no-score JSON and Markdown report；
- artifact-only byte-stable replay。

### M5 — Real acceptance

- fresh isolated Candidate evaluation；
- one semantically equivalent alternative Candidate accepted by Delivery boundary；
- one deterministic mutant rejected；
- one Semantic fail and one required abstention case；
- one blocking and one concern-only Code Quality case；
- exact DSH Skill binding when available, otherwise explicit Harness Effect inconclusive；
- independent review of exact stable Candidate package。

## 11. Required tests

- schema/parser canonical roundtrip and strict unknown-field rejection；
- historical artifact replay byte parity；
- Public Catalog/Authority Map totality and unauthorized exclusion rejection；
- Catalog alias uniqueness、relation/value source/cardinality completeness、field-domain compatibility；
- AST-derived dimension equality、same-Claim second-dimension omission、non-deterministic dimension reference and Claim/axis mismatch；
- fixed relation arity plus missing/wrong retention/effect-count operands；
- closed Observation expression union、operator/value compatibility、depth/node limits and forbidden JSONPath/object/code rejection；
- Observation normal-form property and metamorphic tests；
- throw/typed-result equivalence；
- non-authoritative reason/persistence representation invariance；
- reconciled/fail-closed disjunction；
- mutant exact failure sets and normalizer-escape rejection；
- Semantic/Code Quality cross-input absence；
- development/admission/bias input digest disjointness and development-result exclusion；
- curator locked-input independence、Judge freeze → execution manifest → label unseal ordering and post-freeze drift rejection；
- human-label closure and two-label adjudication；
- exact unanimous per-dimension applicability/verdict/severity/condition/reason admission and unstable rejection；
- order/position/verbosity/format/identifier/comment/language/arm-label transforms with exact canonical outcome；
- Code Quality matched-condition existence/severity replay；
- Candidate prompt-injection resistance；
- repeat receipt completeness and mixed-route rejection；
- HarnessEffectContract identity、opportunity、Pareto、typed cost unit/direction/tolerance/budget/null and claim-strength truth tables；
- Candidate/Harness validity decoupling and four-axis verdict truth table；
- TDD Skill silence/activation and red-green mechanism projections；
- bounded candidate-authored tests path and public-seam enforcement；
- preconfirmed seam projection、codebase-design dependency escape and exact LICENSE closure；
- Candidate surface secret/Oracle/rubric/Judge/verdict absence；
- packed production import closure and runtime profile predecessor regression；
- fresh Campaign persist/report/replay。

## 12. Completion gate

- M0–M5 全部完成；
- Observation Boundary 对 equivalent implementations 零已知 false reject，且 calibration mutants 无已知 false accept；
- 两个 Judge 各自 admission，所有 case/repeat/bias/abstention evidence closure 完整；
- 四轴 verdict 和 Measurement Validity envelope 无综合分、无跨轴抵消；
- Candidate、Judge、Oracle、人工标签和 Harness runtime 权限边界通过独立核验；
- historical replay、strict TypeScript、lint、tests、build、pack 与 source-tree cleanliness 全绿；
- exact stable Candidate 经非作者独立 review；
- runtime 只保留被 root manifest 引用的可重放证据。

本合同证明一个有界的 Phase 3C measurement successor，不声称 LLM Judge 普遍等价于人工评审，也不声称任何 DSH Harness
在所有需求交付任务上有效。
