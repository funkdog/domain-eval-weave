---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, requirements-delivery, domain-truth, domain-onboarding, grader-authoring]
doc_kind: plan
created: 2026-08-19
description: "DSH Eval Lab Phase 3 产品方案：把可信测量内核升级为领域真相接入、需求绑定、确定性 Grader 准入与校准语义残差。"
---

# DSH Eval Lab Phase 3 产品方案

> 本文取代旧路线中“Phase 3 = Calibrated Open-Task Judge”的过窄定义。Phase 3 的正式目标是
> **Requirements Delivery Evaluation**；Semantic Judge 只属于最后的残差层，不能成为需求交付判定的起点。
>
> 当前获准实施的范围是 Phase 3A，以及
> `2026-08-21-dsh-eval-lab-phase-3b-implementation-spec.md` 冻结的 bounded Phase 3B vertical。
> Phase 3C 仍只有产品方向，必须另有 implementation spec 才能开始编码。
>
> **Phase 3A scope contraction（2026-08-19）**：本阶段只保留建立可信真相闭环所需的显式 `confirm`。通用
> `reject/withdraw`、rejection receipt 历史审计和对象撤销治理后移，不作为 Phase 3A 公开 surface 或验收门槛；候选未获确认时
> 继续停留在 authoring/decision packet，不写永久治理事件。
>
> 决策 provenance：`thread_msx25fw48rony7bs` 中 2026-08-18 的 Phase 3 共创讨论，以及其追溯的
> `thread_mssbo6jtl0ox5o21` 领域 Grader/访谈原始讨论。本文已经冻结实现所需结论；实现 Agent 不依赖聊天记录推断合同。

## 1. 产品判断

Phase 1/2 已经证明 Eval Lab 能够冻结 Candidate、隔离执行、运行确定性 Oracle、记录 Harness activation、保护
holdout/exposure，并从持久 artifact 重建不夸大的报告。它们还没有解决一个更上游的问题：

> 新需求究竟应该满足哪些长期领域真相，哪些真相被本次需求修改，哪些只是行业经验或模型先验，哪些规则当前根本无法可靠观察？

如果跳过这一步直接生成 hidden tests 或调用 LLM Judge，系统可能精确执行一套错误的业务政策。Phase 3 因此先把
“领域真相如何获得、确认、版本化与绑定到需求”建设成正式产品能力，然后才编译 Grader。

完整链路是：

```text
领域访谈
→ Evidence Cards
→ confirmed / proposed / unresolved / conflicted / observability_gap
→ Product Domain Contract
→ Requirement ChangeSet
→ impacted Claim closure
→ Claim IR / Behavior Vector / Grader Plan
→ Gold / mutants / counterexamples / grader holdout
→ versioned deterministic Grader
→ calibrated semantic residual（可 abstain）
→ Candidate evaluation
```

## 2. 一句话目标

> 把一个自然语言需求映射到持续演进的产品领域真相图上，证明“该新增或修改的是否完成、未声明修改的共享真相是否仍成立”，
> 并明确哪些政策或观察面当前不足以生成有资格判题的 Grader。

## 3. 两条独立生命周期

领域真相与需求交付不能共用一个对象或版本状态。

```text
领域生命周期
onboard → confirm truth → issue version → audit → supersede / retire

需求生命周期
intake → bind existing Claims → declare delta → compile grader
→ implement → evaluate → accept / reject
```

需求可以引用、保持或提议修改领域真相，但一次交付通过不能自动把 proposed delta 晋升为新的产品真相。
`ProductDomainContract` 的新版本必须由 Domain Owner 显式签发。

## 4. 产品对象

### 4.1 Domain Knowledge Pack

通用领域经验，例如金额守恒、幂等、状态机、补偿和常见 failure modes。它可以提出候选问题和 Claim，
但不具有某个产品的政策权威，不能直接进入正式 Grader。

### 4.2 Evidence Card

访谈、文档、代码、外部契约或运行观察中抽取的一条候选事实。每张 Card 必须绑定来源并处于以下状态之一：

- `confirmed`：Domain Owner 已确认且来源可追踪；
- `proposed`：有证据支持但尚未签发；
- `unresolved`：当前信息不足，必须保留为决策问题；
- `conflicted`：两个以上来源对同一规则给出不兼容结论；
- `observability_gap`：规则可能明确，但当前没有可靠裁决面。

访谈记录不是领域真相。只有 `confirmed` Card 才有资格进入 `ProductDomainContract`。

### 4.3 Product Domain Contract

某个产品长期、共享、版本化的领域真相。每条稳定 Claim 至少包含：

```text
claim id / domain id / statement / applicability
authority refs / authoritative observations
failure semantics / false-accept and false-reject risk
version provenance / dependencies
```

同一 Claim 可以被多个 Requirement 引用；不得为每个需求复制一份同义规则。

### 4.4 Requirement ChangeSet

一次需求相对 pinned Product Domain Contract 的变更声明：

```text
uses          使用现有领域真相
preserves     本次变化必须保持的共享真相
introduces    提议新增 Claim
modifies      提议修改既有 Claim
deprecates    提议退役既有 Claim
conflicts_with 当前需求与既有 Claim 的已知冲突
```

`introduces/modifies/deprecates` 在交付评测期间只是 requirement-scoped target，不自动修改已签发 Contract。

### 4.5 Claim Dependency Graph

保存 Claim、Requirement 与上述 typed edges 的可重建关系。它必须支持双向查询：

- 从 Requirement 找 impacted Claim closure；
- 从 Claim 找所有依赖它的 Requirement、未来 Grader Binding 与需要复评的资产。

### 4.6 Grader Binding 与 Delivery Evaluation Report

这两个对象分别由 Phase 3B 与 Phase 3C/运行面完成。Phase 3A 只冻结它们的输入边界，不生成任意 grader code，
也不运行 Candidate。

## 5. Phase 3A — Domain Truth Onboarding & Requirement Binding

Phase 3A 同时建设两个不可分割的能力。

### 5.1 `design-domain-grader` Skill

Skill 是领域真相接入的交互入口，不是固定问卷。它支持：

- `onboard`：首次建立产品领域真相；
- `delta`：新需求进入时，只追问受影响的领域切片；
- `audit`：发现过期政策、冲突、观察面缺口和未闭合影响。

访谈从真实成功/失败案例进入，再逐步加入重复、冲突、并发、乱序、中断、重启和跨系统部分失败。
它必须把当前 `confirmed/proposed/unresolved/conflicted/observability_gap` 投影持续回放给 Domain Owner，
而不是最后一次性生成黑盒文档。

Skill 可以读取 Domain Knowledge Pack 提醒常见风险，但必须把“知识包建议”和“产品权威真相”分开。
信息不足时输出决策包并停止晋升，禁止使用模型训练先验补业务政策。

Skill 不负责手算 digest 或手写 artifact envelope。Author profile 提供唯一的 deterministic `domain_artifact` helper：
模型只提交 schema-shaped content，helper 负责把授权 workspace source snapshot 为 immutable bytes、计算真实 SHA-256、
校验对象 schema/证据闭包并写 canonical JSON。Helper 只能生成 authoring primary artifact 或待确认 candidate，不能写
OwnerConfirmationEvent、confirmation receipt 或已签发 truth；管理面的显式 `domain confirm` 仍是唯一 authority transition。

### 5.2 持久化领域与需求契约

访谈产物进入版本化 JSON artifact，而不是只留在 Session：

```text
domain-eval/
├── sources/...
├── candidates/<candidate-id>.json
├── interviews/<session-id>/r<revision>.json
├── evidence-cards/<card-id>/r<revision>.json
├── decision-questions/<question-id>/r<revision>.json
├── contracts/<contract-id>/v<version>.json
├── requirements/<requirement-id>/v<version>.json
├── graphs/<graph-id>.json
├── readiness/requests/<request-id>.json
├── readiness/reports/<report-id>.json
└── manifests/<snapshot-id>.json
```

所有路径都是 immutable：状态变化写新 revision/version/snapshot，不覆盖旧 bytes。Snapshot manifest 固定本次 validation
使用的 exact pointers。Phase 3A 不新增开放式远端 Domain Registry；所有 artifact 默认持久化，无 TTL 或自动 cleanup。

Owner confirmation 不是 Skill 输出。Skill 只能生成 draft/candidate artifact；本地 operator 必须从独立 management profile
显式调用 `domain confirm`。确定性 surface 把 OwnerConfirmationEvent exclusive-create 到隔离 runtime 的永久
`domain-confirmations/` ledger，再把不可伪造的 id+digest receipt 写入下一 revision。Author/Candidate workspace 无权写 ledger。
Confirm 只覆盖 Evidence Card、Product Domain Contract、Requirement ChangeSet 与 open DecisionQuestion，且在 ledger write 前完成
schema、证据闭包、blocking question 与 immutable output preflight。未确认候选不产生 reject/withdraw event；由 author 修订候选或
保留 DecisionQuestion 即可。

## 6. Authoring plane 与 Evaluation plane

```text
Authoring plane
  领域访谈 Skill
  → Evidence Cards
  → Product Domain Contract
  → Requirement ChangeSet
  → Claim dependency graph

Evaluation plane（Phase 3B+）
  frozen Grader Binding
  → frozen Candidate
  → external evaluation
  → evidence/report
```

`design-domain-grader`、Domain Knowledge Pack、owner answers、Gold、mutants、grader holdout 和 decision packet
都不得进入被测 Candidate 的 prompt、workspace、tool surface 或 Session lineage。

Phase 3A 在独立 authoring profile 中运行；既有 `eval-clowder-runner` 继续保持 skill/tool 禁用边界。
Author profile 的通用文件工具必须经过 project-root read / `domain-eval/` write containment guard；仅依赖 DSH mutation sandbox
不足以隔离读取，因为上游 filesystem sandbox 不限制 absolute-path view。Schema-governed `sources/`、`candidates/` 与 primary
artifact namespace 只能由 author-only `domain_artifact` helper immutable 写入，通用 editor 仅可读取这些 bytes；runner 不注册
该 helper。

## 7. Phase 3B — Deterministic Grader Compiler & Admission

Phase 3B 的输入是已验证的 Phase 3A artifact：

```text
Requirement ChangeSet
+ impacted confirmed Claim closure
+ product/runtime risk
→ Claim IR
→ Oracle Plan
→ bounded grader templates
→ executable behavior vector
```

它将建设 deterministic grader 模板、cross-domain invariants、双向 traceability、不同实现形状的 Gold、
risk-weighted mutants、counterexamples、grader calibration holdout、repeatability 与 admission/withdrawal。

Phase 3B 不允许自由代码生成器自己生成 Grader、自己生成 Gold、再自己宣布准入。

## 8. Phase 3C — Calibrated Semantic Residual

只有无法转成确定性 Claim 的剩余语义进入 Phase 3C，例如架构适配、可维护性、handoff 理解与开放文档质量。
Semantic Judge 必须：

- 分维输出，不计算覆盖硬门禁的总分；
- 绑定 rubric、人工 Gold、分歧仲裁、版本与 bridge set；
- 支持 abstention；
- 经过 OOD、顺序、位置、verbosity 与格式偏差测试；
- 不重判退款次数、持久状态等确定性事实；
- 不用 semantic pass 抵消 deterministic fail。

## 9. 最终报告的五条轴

```text
Requirement Delta       本次声明新增/修改的是否交付
Domain Preservation     未声明修改的共享真相是否保持
Semantic Residual       剩余开放语义的校准裁决
Measurement Validity    这次测量是否有效
Harness Impact          treatment 相比 baseline 改变了什么
```

没有跨轴综合分。确定性 hard-gate fail 时，Semantic Judge 的高评价不能改变交付失败。

## 10. Phase 3A 验收定义

Phase 3A 的第一条纵向验收使用完全 synthetic 的 commerce fixture，完成一次 onboarding 与同领域第二个需求的
delta 访谈，并证明：

1. 同一 confirmed Claim 被至少两个 Requirement 复用，没有复制；
2. 一个 Requirement 同时引用两个以上 domain slice；
3. 修改共享 Claim 产生确定的反向影响集合；
4. `proposed/unresolved/conflicted/observability_gap` 无法进入已签发 Contract；
5. 每次 Card/Contract/Requirement confirmation 都由 Skill 不可调用的 management surface 写 OwnerConfirmationEvent，
   而不是对象内自填 actor 字符串；
6. Contract successor 中的 Claim supersede/retire 由整份新 Contract 的一次 owner confirmation 授权；DecisionQuestion 只支持
   `open → resolved`，通用 reject/withdraw 治理后移；
7. delta 模式不会重新询问无关且未受影响的 confirmed Claims；
8. 所有 artifact 可经 schema + semantic replay 验证；
9. Skill、owner answer 与 authoring artifact 不出现在 Candidate runner surface；
10. readiness 由持久 ReadinessRequest 的 requested closure 唯一推导，不是总分，也不声称 Grader 已经 admission-ready。

## 11. Phase 3A measurement contract

确定性合同由 test/guard 负责，不伪装成 eval 指标：provenance 完整性、状态晋升、ID/version/digest、图闭包、
Candidate 隔离和 artifact replay 任一失败都直接 fail closed。

Skill forward evaluation 只保留两个带出生证的诊断指标，不生成综合分：

### 11.1 Unauthorized truth classification/attempt rate

```yaml
utility_claim: 比率下降代表 Skill 在 hard guard 之前更少把未获权威确认的政策错标为 confirmed 或尝试晋升
estimator: independent label 为 proposed/unresolved/conflicted/observability_gap、但 Skill 输出 confirmed 或生成 promotion attempt 的 case 数 / 全部 independent-label non-confirmed eligible cases；保留每个 case/attempt id 与最终 guard outcome
validity_bounds: 只适用于冻结 fixture、独立标签、Skill/model/prompt 版本；标签或 Domain Owner policy 变化后失效；eligible 分母为 0 时结果是 not_applicable，不能记 pass
consumer: Phase 3A release gate；任一错标/attempt 阻止 Skill 版本签发，confirmed-only guard 是否成功阻断另作 deterministic 证据
calibration_plan: 每个 fixture 至少包含一个可确认事实、一个行业先验诱饵、一个冲突和一个观察面缺口；标签由非作者冻结，评估发生在 promotion guard 前
repeatability_contract: admission 环节；固定 Skill/model/fixture，至少三次独立 Session；逐轮报告原始 case/attempt ids，不用最终 Contract 的零违例替代分类结果
```

该指标的 release evidence 必须由 author 不可写的 runtime carrier 产生，而不是事后扫描 artifact 或读取 Session transcript：

- 每轮只接受 dedicated runtime 下受管 `phase3a-forward-acceptance/fixtures/` synthetic workspace 与
  `phase3a-forward-acceptance/packages/<exact-revision>/` reviewed `.tgz`。Carrier 从 canonical fixture manifest 重新核验每个 input digest、
  从 workspace 外 `phase3a-forward-acceptance/labels/` 的 independent-label manifest 读取 expected statuses，并从 physical tar bytes
  重建并验证 `dsh-eval-lab` package identity/content digest；所有输入文件必须是 single-link physical file。Fixture-set digest 同时绑定
  inputs 与不暴露给 Author 的 labels，不接受调用方自报；production carrier 也不接受 launcher/verifier 注入，而是验证固定 rc.6 DSH
  closure 以及 live author profile package spec/installed bytes 与该 tar/source revision 一致。验证结果形成不可由调用方构造的 launch
  capability；descriptor 落盘后、实际 spawn 前以及 child 结束后必须再次核验相同 path identities 与 content digests，任一变化均不得产生
  admitted receipt。然后 immutable 写 canonical `descriptor`，绑定
  run/session nonce、exact Git revision、reviewed tar digest/size、author profile、provider/model/effort、prompt digest、fixture-set digest 与
  DSH launcher digest、start time；
- child 结束后 carrier 从 exact fixture labels 与 workspace 的 physical canonical artifacts 生成 runtime-owned immutable
  `projection.json`；再写 canonical `receipt`，绑定 descriptor/projection、exit/signal/timeout/output-cap/final-output/error-marker、
  stdout/stderr digest，以及本轮所有 attempt digest。Failed/incomplete run 保留证据但不进入 admitted cohort；成功集合由 receipt 机械派生，不能
  硬编码 run ids，也不能用“目录里已有完整 artifacts”替代 terminal truth；
- `stage_confirmation_candidate` 在 guard 前写 secret-free intent、guard 后写 typed outcome；即使 guard 正确拒绝且最终没有 candidate，
  该 attempt 仍进入对应 independent-label case 的分子。Author/model/editor不能指定或改写 run/attempt id；
- verifier/evaluator 必须从 evidence root 自行读取 receipts 与其 digest-bound projections，不能接收调用方提供的 admitted run ids 或
  可替换 projection，也不能把三轮下限调低；只对 exact revision/tar/profile/provider/model/effort/prompt/fixture/launcher 相同且至少三轮的 admitted cohort 求值，并要求每个 admitted
  run × eligible case 都有唯一 projection。Cohort 混合、projection 缺失/重复、attempt outcome 缺失或 attempt 无法唯一绑定 frozen
  label target 必须 invalid/incomplete，不能解释成零违例；
- evidence 只保存 digest、typed terminal/attempt metadata 与 guard diagnostics，不保存 prompt/output 正文、tool body、Session JSONL、
  OAuth/credential 或 provider secret。Reviewer 不需要读取 transcript 即可复放 cohort 与 numerator。

### 11.2 Decision-packet precision

```yaml
utility_claim: 比率上升代表 Domain Owner 看到的是真正不可推导决策，而不是 Agent 可以自行查证的噪声
estimator: Domain Owner 标记为需要政策/权威裁决的问题数 / Skill 提交的问题总数；同时保留漏问问题清单，不单独优化该比率
validity_bounds: 依赖 Domain Owner 标注与当前证据快照；跨领域、来源变化或只看 precision 不看漏问会失真
consumer: Skill author 用于 iterate 访谈顺序与证据读取；Phase 3A v1 仅 diagnostic，不设 promotion 阈值
calibration_plan: onboarding 与 delta 分开标注；对照独立 reviewer 的 missing-question audit
repeatability_contract: discovery/tuning 环节；固定 artifact snapshot，三次运行报告原始分子、分母和问题 ID，不取单次均值掩盖波动
```

## 12. 非目标

Phase 3A 不建设：

- arbitrary grader code generation 或 grader runtime；
- LLM Judge；
- 通用远端 Domain Marketplace/Registry；
- 多用户 RBAC、审批系统或生产数据接入；
- 自动把 Requirement Delta 晋升为领域真相；
- 自动接受需求、上线、回滚或退役 Harness；
- 自动根因归因和干预生成；
- Web UI；
- 读取 OAuth credential、ambient `~/.dsh` 或 Clowder runtime/data/API/ports。

## 13. Source map

- [DSH Eval Lab product boundary and Phase 1](./2026-08-17-dsh-eval-lab-product-plan.md)
- [Phase 2 product plan](./2026-08-18-dsh-eval-lab-phase-2-product-plan.md)
- [Phase 2 implementation spec](./2026-08-18-dsh-eval-lab-phase-2-implementation-spec.md)
- [Phase 3A implementation spec](./2026-08-19-dsh-eval-lab-phase-3a-implementation-spec.md)
- [Phase 3B implementation spec](./2026-08-21-dsh-eval-lab-phase-3b-implementation-spec.md)
