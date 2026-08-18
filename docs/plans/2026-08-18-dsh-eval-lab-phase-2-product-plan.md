---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, plugin-eval-binding, activation, exposure-ledger, multi-task-eval]
doc_kind: plan
created: 2026-08-18
description: "DSH Eval Lab Phase 2 产品方案：把单任务配对实验提升为可复用的 Harness Eval Binding、多任务诊断与不可变 exposure 闭环。"
---

# DSH Eval Lab Phase 2 产品方案

> 本文回答 Phase 2 为什么建设、用户得到什么、产品如何解释证据，以及一期明确不做什么。
> 可执行字段、artifact schema、错误分类和实现顺序以
> [Phase 2 Implementation Spec](./2026-08-18-dsh-eval-lab-phase-2-implementation-spec.md) 为准。
>
> **状态**：implemented and independently accepted。Phase 3 不改写本阶段任何 Campaign/Suite/exposure 语义；
> successor boundary 见 [Phase 3 Product Plan](./2026-08-19-dsh-eval-lab-phase-3-product-plan.md)。

## 1. 产品判断

Phase 1 已证明：在一个固定开放编码任务上，Eval Lab 可以安全地运行 Goal off/on 两个 fresh Episode，
冻结 Candidate，用外部确定性 Oracle 评测，并从 artifact 重建不夸大的配对报告。

但单任务配对实验仍不能回答 Harness 的适用边界：

1. 真正需要长程推进时，Harness 是否实际激活？
2. 简单任务不需要它时，Harness 是否保持克制？
3. 在模型从未见过的新任务上，绑定仍然成立吗？
4. 一个任务被模型看到后，系统如何防止改名或换标签继续冒充 holdout？
5. 多个任务的证据能否在不读取 live runtime 的情况下独立重建？

Phase 2 因此不只是“多跑几个 Task”，而是建设一条可复用的 Plugin Eval Binding：

```text
Harness 主张
  → 适用机会
  → typed activation
  → 外部 Outcome / Cost
  → exposure 与 holdout freshness
  → artifact-only 多任务诊断
```

## 2. 一句话目标

> 把 first-party DSH Goal Harness 绑定到一个版本化、三桶、可校准的 Eval Pack，运行六个 fresh Candidate Episodes，
> 并从冻结证据回答“该触发时是否触发、不该触发时是否克制、未见任务上发生了什么”。

Phase 2 仍然是本地单使用者产品，不宣称统计显著性或总体 uplift。

## 3. 用户承诺

用户运行一个 Harness binding 后，产品必须回答：

1. Harness、Registry、Eval Pack、Task、Oracle 和 intervention 是否为同一套冻结版本？
2. control 是否保持无 Harness activation，避免比较污染？
3. trigger Task 的 treatment 是否出现预期 activation？
4. non-trigger Task 是否避免不必要 activation？
5. holdout Task 是否为真正未曝光的 task/public/base 三重身份？
6. 每个 Task 两臂的外部 Outcome、Mechanism、Cost 与 validity 分别是什么？
7. 当前证据只允许 keep、iterate binding、keep baseline，还是 run more？
8. 报告能否只依赖冻结 artifact 重建，且不生成新的模型 exposure？

产品不替用户自动启用、推广、回滚或退役 Harness。

## 4. 用户旅程

```text
安装 exact Eval Lab package 到专用 instance
→ doctor 验证环境、profile、package、auth 与隔离边界
→ calibrate 验证每个 Task Pack / Oracle 的判别方向
→ binding show 展示 Harness ↔ Registry ↔ 三桶 Task 的冻结关系
→ suite run 一次确认 qualification + 六个 Candidate Episodes
→ suite report 从冻结 artifact 重建多任务报告
→ 用户选择 keep / iterate_binding / keep_baseline / run_more
```

Phase 2 的用户入口属于 DSH：

```text
dsh --profile eval-clowder binding show
dsh --profile eval-clowder suite run
dsh --profile eval-clowder suite report <suite-id>
```

所有 supported invocation 必须在 DSH boot 前携带 exact `DSH_HOME` 和
`DSH_EVAL_INSTANCE_ID=clowder-ai`。缺失任一变量都不是受支持入口。

## 5. 核心产品对象

### 5.1 Harness manifest / evalBinding

版本化 Harness manifest 冻结 Harness identity、唯一允许的 intervention、typed activation 来源、
Eval Pack / Registry digest、三桶 expectation 与 holdout first-exposure policy。

`evalBinding` 是 first-party Goal 的评测证据绑定，不是动态插件执行入口。

### 5.2 Typed activation

Activation 不是最终效用，也不是“越多越好”。Phase 2 把以下三元关系作为正式机制证据：

> `是否存在适用机会 × Harness 是否激活 × 激活后发生了什么`

它来自冻结 Session 中的 typed `goal/change` 事件，不从自由文本、工具名或最终回答猜测。

Activation 不能替代 Outcome，但没有它就无法区分 Harness 已运行但没有帮助、Harness 根本没有运行、
baseline 本来就足够、non-trigger 过度介入，或 control 被污染。

### 5.3 三桶 Task Registry

Phase 2 固定三个 Task，每桶一个：

| Bucket | 产品问题 | 当前 Task |
|---|---|---|
| trigger | 该工作时是否激活并推进 | `ledger-full-v1` |
| non-trigger | 不该工作时是否保持克制 | `ledger-audit-v1` |
| holdout | 未曝光任务上结果和机制如何 | `ledger-release-recovery-v1` |

Candidate 只能看到自己的 public task 与 materialized workspace，看不到 bucket、arm、Oracle、calibration、
Suite 其他任务或报告。

### 5.4 Exposure 与 holdout reservation

每个真实模型 Episode 生成 immutable exposure record。Holdout freshness 同时比较：

- `task_id`；
- `public_task_sha256`；
- `effective_base_sha256`。

Suite 在 qualification 成功、首个 Candidate Episode 前，为这三项分别原子创建永久 reservation。
任何一项曾 exposure 或 reserve，都不能通过改名、重标或 alias 再次作为新 holdout。

Artifact replay 不产生新 exposure。产品没有自动释放、删除或回收 reservation 的路径。

### 5.5 Multi-task Suite

一个 Suite 固定运行三个 Task、六个 fresh Candidate Episodes：

- 每个 Task 都有 control / treatment；
- 同一 Task 两臂共享 Oracle seed；
- Task 顺序与 arm 顺序在模型调用前冻结；
- trigger / non-trigger 可随机排序，holdout 固定最后；
- earlier task/arm 的结果不能改变 later prompt、budget、patch 或 expectation；
- 任一基础设施失败立即停止新的模型调用并保留已有证据。

### 5.6 Suite report

Suite report 按 Task 展示 Outcome、Mechanism、Cost、paired/Suite validity 与 exposure。
它不计算万能总分，不执行 lifecycle 动作。

## 6. Activation expectation 的语义

三个 bucket 的 activation 语义不同：

- trigger：treatment 必须出现预期 activation；缺失意味着 mechanism evidence insufficient；
- non-trigger：treatment 必须不激活；激活意味着 guardrail failure；
- holdout：`observed` 表示必须可靠记录“激活或未激活”的事实，不表示强迫 Harness 激活。

Holdout treatment 未激活时，paired result 必须保留 `GOAL_NOT_ACTIVATED` insufficiency。
只有两臂外部 Outcome 均通过、其余证据有效且不足原因仅来自未激活时，Suite 才能将该 Task 的 effective validity
规范化为 valid。这个规则不能改写 paired result，也不能产生 Harness uplift claim。

## 7. 允许的产品结论

Phase 2 的结论强度固定为：

```text
claim_strength = multi_task_diagnostic
effect_claim_eligible = false
```

Cross-task recommendation 只有四个：

| Action | 含义 |
|---|---|
| `keep` | 当前三桶诊断未发现需要关闭 binding 的证据 |
| `iterate_binding` | activation expectation 或适用边界需要调整 |
| `keep_baseline` | treatment 没有结果收益或代价不合理 |
| `run_more` | 当前 evidence 不足，需新的独立 Task / Suite |

`keep` 不是自动 promotion，也不表示 Harness 对所有 Coding Task 普遍有效。

## 8. Artifact-only replay

`suite report` 只读取 Suite 创建时冻结的 manifest、binding、Registry snapshot、qualification、Campaign pointers、
Candidate、Oracle、activation 和 exposure refs/digests。它不得读取 live profile、workspace、当前 Registry 或重新运行模型。
任一 ref、digest、权限、task cardinality、bucket expectation 或 derived value 漂移都 fail closed。

## 9. Instance 与数据边界

Clowder implementation 固定使用：

```text
instance:            clowder-ai
management profile: eval-clowder
runner profile:     eval-clowder-runner
instance root:      dsh-eval-lab-runtime/instances/clowder-ai
session root:       <DSH_HOME>/sessions/clowder-ai
```

安全边界：

- 只使用 synthetic fixture data；
- source 与 runtime 物理分离；
- runtime root / Suite directories 为 0700，artifact 为 0600；
- 不读取、复制、移动或 hash OAuth credential；
- 不读取 ambient `~/.dsh`、Clowder runtime/data/API/ports；
- Candidate 看不到 Oracle、gold、bucket、arm 或 report；
- Campaign、Suite、exposure 和 reservation 默认永久保留，无 TTL / 自动 cleanup。

## 10. Phase 1 compatibility

Phase 2 通过新的 `suite run` / `suite report` surface 增长，不静默改变 Phase 1：

- `run` / `report <campaign-id>` 继续可用；
- schema-v1 / Oracle-v2 的完整历史 Campaign 仍可只读 replay；
- 新写入、doctor、calibrate、run 和 suite 路径继续严格要求当前 Oracle-v3 evidence；
- 不迁移、不补写、不改写历史 artifact。

## 11. Phase 2 通过的定义

Phase 2 通过不要求 treatment 在每个 Task 都激活或胜过 control，而要求：

1. exact Harness / Registry / Eval Pack / Task / Oracle digest graph 闭合；
2. 三桶 Task 均完成 control / treatment，共六个 fresh Episodes；
3. 每臂 Outcome、Mechanism、Cost、Validity 与 exposure 都可重建；
4. trigger miss、non-trigger over-activation、holdout no-activation 和基础设施失败能被诚实区分；
5. holdout freshness 与永久 reservation 无法通过 alias 绕过；
6. artifact-only replay 与首次报告字节、语义一致；
7. 所有结论保持 multi-task diagnostic，无自动 lifecycle action；
8. exact code/package 与真实 Suite 分别通过独立 review。

## 12. 非目标

Phase 2 不建设 Web UI、LLM Judge、通用第三方插件沙箱、动态 Domain Registry、多人/RBAC、生产流量 A/B、
远端 evaluator、自动 promote/rollback/sunset、统计显著性或根据 earlier result 自适应修改 later task。

Phase 2 的真实证据只证明固定开放编码 Task 上的测量与 Harness binding；它没有证明新需求的领域真相天然完整。
Phase 3A 因此新增 authoring-plane 的领域访谈与 Requirement binding，但不把 Phase 2 Registry 扩成开放式 Domain Registry，
不把 Domain authoring 资产暴露给 Phase 2 Candidate runner，也不重解释任何既存 Suite。

## 13. Release acceptance evidence

Phase 2 rc.4 已完成并通过独立 release acceptance：

- exact HEAD：`fb15c7ef8ec34aeed4401ce82cc35ef5302f97f9`；
- package：`dsh-eval-lab@0.2.0-rc.4`；
- tar SHA-256：`a725190e200bbb6a08edabbc7ac82ac883ae4567712686852900430872cf10e5`；
- Suite：`suite-20260818092709-d1a5faa7`；
- qualification + 6/6 fresh Candidate Episodes 完成；
- 六臂外部 Oracle 全部通过；
- trigger activation observed，non-trigger activation absent，holdout activation absent；
- Suite measurement valid，recommendation `keep/SUITE_VALID`；
- artifact-only replay exit 0，受保护 Suite/exposure/reservation 文件读前读后摘要一致；
- independent code review 与 independent release-acceptance verdict 均为 APPROVE。

已知过程偏差：正式 Suite 前的一次手工启动包装命令漏传 `DSH_HOME` / instance env，DSH 在 Eval Lab mount 前因
找不到 profile 退出。该进程未创建 Suite/Campaign、未预留或曝光 holdout，随后成功 Suite 使用 exact env，因此独立 reviewer
判定为非阻断 process deviation。不能声称该失败进程“零 ambient read”；未来任何启动包装必须在执行 DSH 前硬校验两个 env。

## 14. Source map

- [Phase 1 Product Plan](./2026-08-17-dsh-eval-lab-product-plan.md)
- [Phase 1 Implementation Spec](./2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md)
- [Phase 2 Implementation Spec](./2026-08-18-dsh-eval-lab-phase-2-implementation-spec.md)
- [Phase 3 Product Plan](./2026-08-19-dsh-eval-lab-phase-3-product-plan.md)
- [Phase 3A Implementation Spec](./2026-08-19-dsh-eval-lab-phase-3a-implementation-spec.md)
