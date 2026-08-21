---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, phase-3b, deterministic-grader, requirements-delivery]
doc_kind: implementation_spec
created: 2026-08-21
description: "DSH Eval Lab Phase 3B 实现合同：把已确认领域真相确定性编译为经校准准入的 Oracle Plan，并生成五轴需求交付报告。"
---

# DSH Eval Lab Phase 3B 实现合同

> **状态**：approved implementation contract v1。本文只授权一个有界但完整的 Phase 3B 纵向切片；
> Phase 3C semantic residual、开放式 grader registry 与自由 grader code generation 均不在本合同内。
>
> **产品真相源**：`2026-08-19-dsh-eval-lab-phase-3-product-plan.md` §7–§9。
> Phase 1/2 的 Candidate 冻结、双臂 Campaign、确定性 Oracle、measurement validity 与 artifact replay
> 继续作为执行内核，不另造一套 runner。

## 1. 终态与非目标

本切片必须真实走通以下链路，而不是只生成 preview：

```text
validated Domain Pack
+ owner-confirmed Requirement ChangeSet
+ explicit observation bindings
+ frozen Task Pack
→ Claim IR
→ Oracle Plan
→ calibration admission
→ paired Agent Campaign
→ five-axis Delivery Evaluation Report
```

首个模板族固定为 `reservation-ledger-v1`，复用
`open-coding-ts-ledger-v1` 与 `ledger-oracle-v3`。它是 bounded template，不是开放注册表。

本阶段不做：

- 从 Claim 自然语言猜测 executable semantics；
- 让模型生成 grader/Gold/mutants 后自行准入；
- Phase 3C semantic Judge 或综合分；
- Web UI、远端 evaluator、多用户角色、自动 promotion/rollback；
- 修改 Phase 2 Suite 语义；
- 把 Domain Pack、owner answer、Gold、mutants、holdout 暴露给 Candidate。

## 2. 为什么必须有显式 observation binding

`ProductDomainClaim.statement` 与 `RequirementChangeSet` 是自然语言权威事实，现有合同没有可从字符串
唯一推导出的行为类型。直接用关键词或 claim id 选择 hidden test 会把未声明政策硬编码进编译器。

因此，Phase 3B 只接受 Owner 已签发 Claim/Requirement 中的 `test` observation/source ref。
该 ref 必须指向 Domain Pack 内冻结的 observation catalog entry；entry 的 canonical digest 必须与
Task Pack 发布的同 id catalog entry 完全相同。这样：

- Owner 决定“这条产品真相可由哪个 observation 裁决”；
- Task Pack 决定“这个 observation 如何被确定性执行”；
- compiler 只做 digest、闭包、类型与映射校验，不猜语义；
- 同一 observation 可反向追到 Claim、Requirement、Oracle check 与最终结果。

Domain Pack 中的 catalog 是 immutable source snapshot，不拥有产品权威；Claim/Requirement 的 management
confirmation 才授权该 mapping。Task Pack catalog 只描述可观察能力，不可自行晋升为领域真相。

## 3. 冻结对象

### 3.1 Observation Catalog

Task Pack 新增公开 `claim-observation-catalog.json`：

```text
catalog_id / catalog_version / task_id / oracle_version
behaviors[]:
  behavior_id / template_id / statement / risk_weight
  calibration_expectations[]
```

`behavior_id` 在 v1 中只能是 `LEDGER_BEHAVIORS` 的八个固定值；`template_id` 固定为
`reservation-ledger-v1`。数组 canonical sort 后纳入 Task Pack digest。

Domain Pack 的 source snapshot 可以保存同一 catalog 或其 entry。Claim 的 `observation_refs`、以及
introduced/modified Claim 的 `source_ref_ids`，以 JSON Pointer 精确指向 entry。compiler 重算 pointer
target digest，并要求它等于 Domain source ref digest及 live Task Pack entry digest。

### 3.2 Claim IR

`ClaimIR` 固定：

- exact Domain Pack manifest、Contract、Requirement 与 Task Pack digest；
- impacted Claim closure；
- 每条 Claim 的 `effect`、`axis`、domain、statement digest、risk；
- 每条 Claim 的 observation bindings；
- 未能确定性映射的 semantic residual Claim；
- 双向 `claim → behavior` / `behavior → claim` 索引。

轴映射：

- `uses`、`introduces`、`modifies` → `requirement_delta`；
- `preserves` 与依赖闭包中未声明变化的 active Claims → `domain_preservation`；
- `deprecates`、`conflicts_with` 在 v1 fail closed，不产生可准入 Plan。

首个纵向验收必须没有 semantic residual；通用 parser 允许 residual 持久化，但 residual 非空时最终
Delivery verdict 只能为 `inconclusive`，不得假装 Phase 3C 已裁决。

### 3.3 Oracle Plan

`OraclePlan` 固定 `ClaimIR` digest、Task Pack digest、oracle version 与有序 checks：

```text
behavior_id / template_id / claim_ids / axes / risk_weight / hard_gate
```

一个 behavior 可以裁决多个 Claims；一个 Claim 可以绑定多个 behaviors。缺失 Claim、重复 check、未知 behavior、
空映射、digest 漂移或不对称 reverse index 均拒绝编译。

### 3.4 Grader Admission

`GraderAdmission` 只能由真实 calibration 结果构建，并绑定 exact Oracle Plan、Task Pack 与 eval package：

- base/red 至少一个 fail；
- Gold 全 pass；
- risk-weighted mutants 按 catalog 的 exact expectation 被拒绝；
- repeated Gold byte-identical；
- next-seed Gold 稳定；
- 每个 Plan behavior 至少由 Gold 与一个 red/mutant counterexample 覆盖。

Admission 持久化 red、Gold、五个 mutant、repeated Gold 与 next-seed Gold 的九份完整八维 behavior
vector；parser 从这些向量重算所有 gate、coverage 与最终 `admitted/rejected`，不接受调用方持久化的
`repeatable: true`、`seed_stable: true` 或失败列表充当证据。

任何 measurement `error`、expectation mismatch、coverage gap 或 digest mismatch 都只产生 `rejected` admission；
调用方不能传 `ready: true` 绕过判定。

### 3.5 Delivery Evaluation Report

报告绑定 exact Grader Admission 与已冻结 paired Campaign evidence，固定五轴：

1. `requirement_delta`
2. `domain_preservation`
3. `semantic_residual`
4. `measurement_validity`
5. `harness_impact`

每个确定性 Claim 都列出 behavior status 与 evidence refs；report 保存双向 traceability。无综合分。

Verdict 规则：

- measurement invalid/insufficient、admission 非 admitted、semantic residual 非空 → `inconclusive`；
- 任一 requirement/preservation check 为 fail → `reject`；
- 任一 check 为 error → `inconclusive`；
- 仅当所有 hard checks pass、measurement valid、无 residual 时 → `accept`。

Semantic axis v1 只能是 `not_required` 或 `not_evaluated`，永远不能抵消 deterministic fail。
Harness Impact 从同一次 paired Campaign 的 control/treatment 与 cost delta 投影，不重新执行 Agent。

## 4. 生产 API 与物理边界

唯一生产入口以路径和 immutable refs 为输入，自行执行：

1. `validateDomainPack()`；
2. `loadTaskPackIdentity()` 与 catalog validation；
3. Requirement/Claim closure reconstruction；
4. source pointer digest/CAS 校验；
5. Claim IR 与 Oracle Plan canonical compilation；
6. calibration admission；
7. frozen Campaign evaluation projection；
8. canonical report write + replay。

不得暴露“传入任意 `ValidatedDomainPack` / 任意 behavior vector / 自定义 verifier”即可生产 admitted report 的入口。
测试 seam 留在源码测试图；发布构建把 production closure 收进一个 module-private bundle，并物理移除
`compiler/admission/report/artifacts` sibling modules。只从 package export map 隐藏名字不构成边界，因为调用方可以从
facade URL 推导并直接 import 同目录文件。

所有 runtime artifact 仍位于 `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`，默认永久保存。Domain Pack、
Task Pack 与 report 读取拒绝 symlink、hardlink、非 canonical JSON 与 path escape。Candidate 运行前只得到公开任务与
base workspace；Domain Pack、catalog、Oracle source、Gold、mutants、admission artifact 不进入 Candidate surface。

### 4.1 Release predecessor

Phase 3B 的同版本 content-addressed successor 只允许从 exact accepted Phase 3A runner+author cohort 升级：
main `2c5c55440d747fb4b79699eb7e8aa5338ed4992a`，tar SHA-256
`1119b2db18f6b02365fd1ab496611d23346877248cb82a20e9c935378bd2691a`，size `281097`，installed-content
SHA-256 `69c4caefc1e570da2c81dc631b66f3863f3cb7be603036dbc32c3833c9afc738`。旧+缺失、旧+current、split spec、
tampered bytes 必须继续在 staging 前 fail closed；management reinstall 后仍由既有 runner+author 原子事务提交。

## 5. Artifact layout

```text
instances/clowder-ai/campaigns/<campaign-id>/
├── manifest.json / arms/... / evaluation.json / report.json
└── delivery/
    ├── observation-catalog.json
    ├── claim-ir.json
    ├── oracle-plan.json
    ├── grader-admission.json
    ├── report.json
    └── report.md
```

Phase 3B 复用并扩展同一个 immutable Campaign artifact root，不复制 Phase 2 evidence，也不创建第二个
可漂移的 Campaign store。

每个文件 immutable/canonical；pointer 使用 digest，状态变化写 successor evaluation id，不覆盖旧 artifact。

## 6. Milestones（red → green）

### Milestone 0 — Contracts

- 四个 Phase 3B schema + observation catalog schema；
- strict Zod parser 与 JSON Schema parity；
- extra field、unknown behavior、duplicate mapping、bad reverse index、score field 全拒绝。

### Milestone 1 — Deterministic compiler

- validated Domain Pack + Task Pack → Claim IR + Oracle Plan；
- exact source-entry digest closure；
- impacted/dependency closure和五类 effect 规则；
- 不从 statement/claim id 猜 behavior；
- unsupported/deprecated/conflicted inputs fail closed or become explicit residual as frozen above。

### Milestone 2 — Admission

- catalog expectations驱动 Gold/red/mutant calibration；
- coverage、repeatability、seed stability；
- 调用方不能降低门槛或伪造 admitted。

### Milestone 3 — Delivery report

- paired Campaign result → 五轴报告；
- deterministic fail/error、measurement invalid、semantic residual 的 verdict precedence；
- claim↔behavior↔evidence 双向 replay；
- 不含 overall score。

### Milestone 4 — Synthetic vertical acceptance

在全新 isolated runtime root 用 synthetic Reservation Ledger Domain Pack：

1. 两个 Owner-confirmed Claims，分别覆盖 requirement delta 与 domain preservation；
2. 一个 Owner-confirmed Requirement 绑定全部八个 ledger behaviors；
3. compile + admission 通过；
4. 运行一次完整 paired Agent Campaign；
5. Gold-equivalent Candidate 得到 `accept`；
6. 至少一个 mutant 得到 `reject`；
7. 删除/伪造一个 Claim mapping、改变 catalog bytes 或破坏 evidence digest 均在模型调用前失败；
8. 报告可只靠 persisted artifacts 重放到相同 digest；
9. Candidate workspace/session 不含 Domain Pack、Owner answer、catalog、Oracle、Gold/mutants。

## 7. 完成门禁

完成需要同时满足：

- Milestone 0–4 全绿；
- `pnpm check && pnpm lint && pnpm test && pnpm build`；
- Skill validator、`pnpm pack --dry-run`、`git diff --check`；
- source tree 无 runtime artifacts；
- 一个 stable exact candidate 的一次独立 cross-cat review。

验收通过只证明本合同的 bounded deterministic template family；不声称开放领域都已自动拥有 Grader，
也不声称 Phase 3C 已完成。
