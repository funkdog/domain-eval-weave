---
feature_ids: [F192, F267]
related_features: [F202, F203, F266]
topics: [dsh, eval-lab, semantic-judge, observation-boundary, code-quality, harness-effect]
doc_kind: plan
created: 2026-08-24
description: "DSH Eval Lab Phase 3C 产品合同：以语义观测边界、校准 Judge、独立代码质量裁决和四轴 verdict 完成需求交付评测。"
---

# DSH Eval Lab Phase 3C 产品方案

> Phase 3C 将 Phase 3B 的确定性 Grader 扩展为完整的需求交付裁决。它先修正确定性
> Observation Boundary，再引入只处理剩余语义的 Semantic Judge、独立 Code Quality
> rubric、人工校准与 abstention。Phase 3B/B.1/B.2 的 schema、Campaign、报告和 replay
> bytes 保持原样；Phase 3C 使用 successor contracts。

## 1. 产品目标

Phase 3B 已经把 confirmed Domain Claims 编译为可执行行为向量，但 Commerce 实跑暴露了两类边界问题：

1. 确定性 Oracle 的个别断言同时约束了领域结果和实现形状，例如拒绝必须表现为 throw、审计必须使用某个
   `reason` 字符串、持久化必须暴露某个内部字段；
2. 架构适配、需求本意、代码坏味道和维护质量仍缺少经过校准的裁决面。

Phase 3C 的目标是：

> 在冻结 Candidate 上先裁决权威、可观察的领域结果，再分别裁决无法形式化的需求语义和代码质量，最后把
> DSH Harness 的自然行为与交付变化放在独立轴上呈现。

## 2. 两个本体

DSH 与 Eval Lab 各自拥有独立职责。

```text
DSH runtime
  日常开发能力、Skill、工具、Agent 流程与正常 Session events

DSH Eval Lab
  control/treatment 配置消融、Candidate 冻结、外部裁决、校准、重放与报告
```

被测能力必须先在 DSH 日常开发中成立。Eval Lab 只切换其可用性并观察结果，不提供、编排或修改被测开发流程。

Phase 3C 的首个 Harness target 直接采用一份现有的轻量 Agent Skill，而不是由 Eval Lab 创造开发流程。冻结对象是
Matt Pocock `tdd` Skill 在 upstream commit `5b15a47f2d7150f545fbcacbfe381787fc0230dc` 下的 exact
`skills/engineering/tdd/` closure 与 MIT license。DSH 负责把这份外部 Skill 作为普通日常开发能力提供；Eval Lab
只切换 exact Skill disabled/enabled。

## 3. Phase 3C 输入

一次 Phase 3C Evaluation 固定以下输入闭包：

```text
validated Domain Manifest
+ confirmed Product Domain Contract
+ confirmed Requirement ChangeSet
+ Claim IR and admitted deterministic Oracle Plan
+ frozen Task Pack and public task
+ frozen Candidate archive and base revision
+ Semantic Judge Contract
+ Code Quality Rubric
+ admitted Judge calibration package
+ exact DSH deployment and Harness binding
```

Candidate 只接收公开任务、base workspace 与 treatment 声明的真实 DSH 能力。Judge、rubric、人工标签、
deterministic observations、对臂结果和最终 verdict 均在 Candidate 冻结后进入独立裁决面。

## 4. Deterministic Observation Boundary successor

确定性边界只判断 Product Domain Contract 声明为权威的外部可观察维度。Phase 3C v1 使用编译期冻结的 typed
selector/operator/value algebra；`projection`、`predicate`、JSONPath 和任意表达式都不是生产输入。每条 observation binding
必须给出：

- 来源 Claim 与 Requirement edge；
- 公开 stimulus 与观察入口；
- 权威 state/effect/outcome projection；
- normalization 与 invariant predicate；
- failure evidence；
- typed invariant expression。

Public Observation Catalog 中的每个维度都必须在编译生成的 Authority Map 中唯一归类为 `deterministic`、
`semantic_residual` 或 `out_of_scope`。前两类来自 exact Claim IR；`out_of_scope` 必须由 confirmed Requirement scope 明确授权。
未获归类的 public dimension 形成 observation gap，不能由边界作者用自由文本排除。

每个 Boundary AST leaf 都机械派生 exact Catalog dimension；binding 持久化相同的 `dimension_ids`。全部 bindings 的派生集合
必须与 Authority Map 的 complete deterministic set 全等，并逐维验证 Claim/axis authority。一个 Claim 有多个权威维度时，
漏掉其中任何一个都会阻止 Boundary admission。

边界把原始调用表现投影为领域 normal form：

```text
operation outcome    accepted / rejected / unavailable
state projection     Claim 指定的公开状态字段
effect multiset      按领域 identity 归一化的外部效果
temporal relation    只保留 Claim 要求的 happens-before / exactly-once 关系
recovery relation    restart 前后公开状态与效果是否保持
```

拒绝通过 throw、typed result 或其他公开 API 允许的传输形式表达时，normal form 都是 `rejected`。内部存储布局、
未签发的字符串、完整对象形状和无权威依据的事件全序不进入 deterministic verdict。若 public contract 明确规定传输形状，
它本身才成为 Delivery observation。

Phase 3C 不通过不断追加“可接受实现类型”维护白名单。Observation 的选择来自 confirmed Claim，比较对象是 normal form
与 invariant，而不是某份 Gold 执行轨迹。Gold、mutants、等价实现与反例用于校准边界，不定义产品真相。

## 5. Phase 3C Semantic Judge

Semantic Judge 只消费 Claim IR 中显式保留的 `semantic_residual`，不重新判断已经进入 deterministic boundary 的事实。
首版支持以下需求语义维度：

- `requirement_intent_alignment`：实现是否满足需求陈述的实质意图；
- `architecture_fit`：实现是否与现有产品边界和依赖方向相容；
- `failure_semantics_coherence`：公开失败语义是否完整、一致且可理解；
- `handoff_comprehensibility`：下一位工程师能否从公开代码与文档理解本次变化。

每个维度由版本化 rubric 决定是否适用。Judge 输出逐维 verdict、证据位置、简明理由、反证和 abstention reason，
不输出跨维总分。Semantic pass 不能覆盖 Delivery fail。

## 6. 独立 Code Quality rubric

Code Quality 与 requirement semantics 使用独立 rubric、独立 Judge invocation 和独立结果。首版维度为：

- `change_scope_discipline`：改动是否聚焦于需求所需范围；
- `cohesion_and_responsibility`：职责边界是否清楚；
- `state_transition_clarity`：状态变化是否可读、可维护；
- `error_handling_clarity`：错误处理是否一致并保留上下文；
- `test_maintainability`：测试是否表达稳定行为而非复制实现；
- `duplication_and_locality`：重复、散落规则和远距离耦合是否形成维护风险。

格式偏好、命名口味、与 Gold 的代码相似度和未被 rubric 声明的架构偏好不构成 finding。确定性静态事实由
test/lint/guard 直接提供，Judge 只裁决需要语境判断的质量问题。

## 7. 四轴 verdict

Phase 3C successor report 固定四轴：

```text
Delivery        Requirement Delta + Domain Preservation 的确定性结果
Semantic        semantic residual 的校准 Judge 结果
Code Quality    独立代码质量 rubric 结果
Harness Effect  treatment 相对 control 的自然行为、结果与成本变化
```

Measurement Validity 是整个 verdict 的前置 envelope，不再与四个产品结果轴并列。它分别记录 Candidate verdict 与
Harness Effect validity：deterministic boundary、Semantic Judge 和 Code Quality Judge 决定 Candidate verdict validity；
Harness mechanism 与 cost evidence 只决定 Harness Effect validity。

总体交付决定只能是：

- `accept`：Candidate required measurement 全部 valid，Delivery pass，Semantic pass/not-required，且没有 blocking Code Quality finding；
- `reject`：Delivery fail、Semantic fail，或出现 rubric 明确声明的 blocking Code Quality finding；
- `inconclusive`：required evidence invalid/insufficient、Judge abstain、Judge protocol error 或 observation gap。

非阻塞 Code Quality concern 随 `accept` 保留。Harness Effect 不改变单个 Candidate 的 accept/reject；它服务 Harness
keep/iterate/sunset 的后续决策。

### 7.1 四轴指标出生证

```yaml
delivery:
  utility_claim: 全部 declared Requirement Delta 与 Domain Preservation observations 通过，代表 Candidate 在该冻结领域闭包内完成需求且未破坏共享真相
  estimator: 每条 Claim 的完整 pass/fail/error observation vector；不取均值或 accuracy
  validity_bounds: exact Domain/Requirement/Task/API/Observation Boundary/Candidate/seed closure；任一 observation error 或 boundary drift 失效
  consumer: 单个 Candidate 的 accept/reject/inconclusive 与 Observation Boundary keep/iterate
  calibration_plan: Gold、语义等价实现、领域风险 mutants、normalizer-relaxation mutants 与 next-seed
  repeatability_contract: deterministic admission 与 acceptance；同 closure 重放逐维一致

semantic:
  utility_claim: required residual dimensions 通过，代表 Candidate 与人工校准的需求本意、架构边界和公开失败语义一致
  estimator: 每维三次独立 admitted Judge verdict；一致 pass/fail 才裁决，分歧投影为 unstable abstention
  validity_bounds: exact rubric/prompt/model/input/admission；新增 residual、领域迁移、模型或 rubric 变化后失效
  consumer: Candidate verdict 与 Judge keep/iterate/re-admit
  calibration_plan: 双人标签、分歧仲裁、must-decide/must-abstain、bias transforms 与 prompt-injection cases
  repeatability_contract: admission 与真实 evaluation 均三次独立运行；不使用多数票隐藏不稳定性

code_quality:
  utility_claim: required dimensions 通过且无 blocking finding，代表改动在当前仓库语境下没有人工校准的显著维护风险
  estimator: 每维三次独立 Judge verdict、severity 与代码证据；blocking/concern 分开保留
  validity_bounds: exact base/diff/rubric/model/admission；仓库 standards 或架构基线变化后失效
  consumer: Candidate verdict、非阻塞 concern handoff 与 rubric/Judge iterate
  calibration_plan: 双人标签、等价实现、真实坏味道、偏好诱饵、bias transforms 与 must-abstain cases
  repeatability_contract: admission 与真实 evaluation 均三次独立运行；分歧投影为 unstable abstention

harness_effect:
  utility_claim: 在同 Task 的有效 paired Episodes 中，treatment 相对 control 的四轴与成本变化代表该 exact Skill 在该机会分布上的 observed impact
  estimator: opportunity、typed activation、Delivery/Semantic/Code Quality delta 与 cost delta 的完整向量；使用 Pareto 关系，不计算 uplift 总分
  validity_bounds: exact Skill/DSH/model/Task/arm config/Judge closure；未激活、单 pair、Task 暴露或未声明 arm drift 限制 claim strength
  consumer: exact Skill keep/iterate/sunset 证据，不自动执行 lifecycle action
  calibration_plan: TDD-suitable、borderline、non-trigger 与 holdout；人工复核 opportunity 和 mechanism projection
  repeatability_contract: arm/task order 预冻结，多次 paired Campaign 报原始向量与波动；单 pair 仅 descriptive
```

## 8. Judge calibration 与 abstention

Judge 资产分成 digest-disjoint 的三套 case：

1. `development`：用于编写和迭代 rubric/prompt，不参与 admission；
2. `locked_admission_holdout`：case inputs 由独立 curator 在 Judge authoring 前冻结；最终 rubric/prompt/model/schema
   冻结并生成 execution manifest 后才开放人工标签，只用于 admission；
3. `locked_bias_holdout`：保存顺序、位置、verbosity、格式、标识符、注释、语言、arm-label 与 prompt-injection 变换。

Production admission 只消费两套 locked holdout。每个 case 保存：

- exact requirement/domain/base/Candidate closure；
- 两份独立人工逐维标签；
- 分歧仲裁结果与证据；
- 等价实现关系；
- 每个 dimension 的 applicability、exact verdict、severity、matched Code Quality condition ids 与 exact abstention reason；
- risk class 与 false-accept/false-reject 代价。

Development set 覆盖正确实现、真实语义缺陷、代码质量缺陷、等价实现、信息不足和冲突权威。Locked bias holdout
覆盖顺序、位置、verbosity、格式、标识符、注释、语言、arm-label 与恶意 prompt-injection。每个 transform 都绑定
canonical case 的 exact dimension map；非权威变换不能改变任一维结果。Aggregate 只能由逐维 map 派生。

合法 abstention reasons 为：

```text
insufficient_evidence
conflicting_authority
rubric_not_applicable
out_of_distribution
unsafe_or_untrusted_instruction
unstable_across_repeats
```

Abstention 是有效输出，不折算为 pass 或 fail；required 维度 abstain 时总体决定为 `inconclusive`。Judge 输出解析失败、
输入闭包漂移或隔离失败属于 measurement invalid。

## 9. Harness Effect 与外部 TDD Skill

Phase 3C 的 Harness Effect 遵循现有机会模型：

```text
eligible opportunity × observed behavior × delivery consequence × cost
```

每次实验绑定一个 `HarnessEffectContract`，冻结 Task bucket→`eligible/ineligible/unknown`、typed activation events、逐轴
Pareto 关系、每项 cost 的单位/方向/tolerance/budget/null 规则与 claim-strength 门槛。同一 raw delta 只能得到一个机械分类。

对于首个 TDD Skill pilot：

- control 与 treatment 使用 byte-identical DSH package tree；
- 两臂接收同一条公开 test-first 需求，control 使用模型原生 TDD 知识，treatment 额外获得 exact Skill；
- 唯一 intervention 是该 Skill disabled/enabled；
- DSH 自己完成 Skill discovery、加载与执行；
- Eval Lab 不提供 TDD 指令、不生成测试、不改变 red/green 过程；
- Task Pack 把允许测试的 public seams 作为已获 operator 确认的公开输入；
- `codebase-design` Skill 在两臂都不可用，任何请求该依赖的行为只使 Harness Effect invalid；
- treatment 沉默进入分母，并根据 Task bucket 区分未加载、机制无差异或不可判断；
- 一次 paired Campaign 只产生 observed delta，不产生普遍 uplift claim。

TDD successor Task Pack 授权一个受限测试目录，公开固定 API seams，并保留 TDD-suitable、borderline、non-trigger 与
未见 holdout 四桶。Agent-authored tests 进入 Code Quality 观察，不成为 external Delivery Oracle。该 Registry 与外部 Skill
分别版本化；Phase 3C 不在 Eval Lab 包内复制或改写 Skill 内容。

## 10. 持久化与重放

Phase 3C 在既有 Campaign root 下新增 successor namespace，保存：

```text
phase3c/
├── observation-boundary/
├── deterministic-results/
├── semantic-judge/
├── code-quality-judge/
├── calibration/
├── verdict/
└── replay-manifest.json
```

所有 primary artifact 使用 canonical JSON、immutable refs 与 content digests。Replay 只读取冻结 Candidate、source closure、
Judge admission、Judge run receipts 和原始逐维结果；不重新调用 Agent 或 Judge。历史 Phase 3B report 继续按原 schema 重放。

## 11. 产品验收

Phase 3C 首个 bounded acceptance 必须证明：

1. 语义等价但实现形状不同的 Candidate 不再因 throw/typed-result、非权威 reason、内部 schema 字段或允许的 fail-closed
   路径被 deterministic boundary 错拒；
2. Gold 与既有风险 mutants 仍保持正确判别方向，新增 boundary-relaxation mutants 不被错误接受；
3. Semantic Judge 不重判 deterministic Claims；
4. Code Quality Judge 与 Semantic Judge 独立运行并引用代码证据；
5. 人工校准、bias suite、repeat stability 与 abstention expectations 全部进入 admission evidence；
6. 四轴 report 无综合分，Measurement Validity 作为 envelope，artifact-only replay byte-stable；
7. Candidate 无法读取 rubric、人工标签、Judge prompt、对臂结果或 verdict；
8. Harness Effect 能如实呈现未激活、无差异、改善、伤害、混合与证据不足；
9. Eval Lab 不包含或改写外部 TDD Skill 的流程逻辑；
10. Phase 1/2/3A/3B/B.1/B.2 历史 artifacts 保持只读可重放。

## 12. 非目标

Phase 3C 不建设自动需求验收、Harness promotion/rollback、开放 Judge marketplace、生产数据连接、远端 evaluator、
在线学习、自动 rubric 生成或 DSH Review/Repair runtime。

## 13. Source map

- [Phase 1 product boundary](./2026-08-17-dsh-eval-lab-product-plan.md)
- [Phase 3 product plan](./2026-08-19-dsh-eval-lab-phase-3-product-plan.md)
- [Phase 3B implementation contract](./2026-08-21-dsh-eval-lab-phase-3b-implementation-spec.md)
- [Phase 3B.2 Commerce successor](./2026-08-22-dsh-eval-lab-phase-3b2-commerce-withdrawal-implementation-spec.md)
- [Phase 3C implementation contract](./2026-08-24-dsh-eval-lab-phase-3c-implementation-spec.md)
- [Lightweight development Skill research](../research/2026-08-24-lightweight-development-skill-eval.md)
