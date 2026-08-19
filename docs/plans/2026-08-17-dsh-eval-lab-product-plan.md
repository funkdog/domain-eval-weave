---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, harness-ablation, controlled-experiment, phase-1]
doc_kind: plan
created: 2026-08-17
description: "面向个人开发者、固定开放式编码交付领域的 DSH Harness 受控实验产品方案，并冻结 Phase 1 最小配对实验。"
---

# DSH Eval Lab 产品方案与 Phase 1 目标

> 方法论 provenance：Clowder AI `Agent Eval Epistemology`。该原文不随隔离 assignment 分发；本文已经冻结
> Phase 1 所需的不变量，实现 Agent 不得为追索 provenance 访问 snapshot 外路径。
>
> 本文只负责 DSH 的产品与一期交付边界。若产品便利与方法论不变量冲突，以认识论为准；
> 不允许为了更快出报告而改变被测 Agent、污染 holdout 或把无效测量包装成效果。
>
> **文档状态**：Phase 1/2 已完成实现与独立验收；本文继续作为基础产品边界。Phase 3 的继任产品定义见
> [Phase 3 Product Plan](./2026-08-19-dsh-eval-lab-phase-3-product-plan.md)。
>
> 实施真相源：[DSH Eval Lab Phase 1 Implementation Spec](./2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md)。

## 1. 产品定义

DSH Eval Lab 是一个安装并运行在 DSH 专用 profile 中、面向个人开发者的本地受控实验插件。Phase 1 固定在
“开放式编码交付”领域：

> 在同一个任务、模型、权限、环境和 evaluator 下，只增加、移除或修改一个 Harness 组件，
> 运行自然 DSH Agent Episode，并清楚展示该组件对任务结果、行为机制和成本的具体影响。

它不是：

- 通用模型排行榜；
- 自动给任何回答打一个总分的 Judge UI；
- 生产流量 A/B 平台；
- 自动改写、安装或退役插件的控制器；
- Clowder F192/F266 的复制品；
- 证明某个 Harness 普遍有效的单次 Demo。

Phase 1 只有一个产品主体：使用者本人。提供任务真相、运行实验与决定 Keep / Iterate / Revert 是同一人的
不同活动，不预设 Domain Owner、Experiment Operator、Decision Owner、审批流或 RBAC。多人治理是未来在
真实共享需求出现后再生长的能力，不进入个人 Harness 框架的一期模型。

“作为 DSH 插件运行”指用户在 process 启动前把 `DSH_HOME` 固定为
`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home`，再通过
`DSH_HOME=<dedicated-home> dsh plugin --profile eval add <package>` 安装产品，并通过
`DSH_HOME=<dedicated-home> dsh --profile eval <command>` 使用它。DSH 在 app plugin mount 前解析 home/profile，
所以未携带 dedicated `DSH_HOME` 的调用不是受支持入口，`init` 也不能事后迁移已经 boot 的 management profile。
Eval Lab 管理插件运行在专用 `eval` profile；被测 control/treatment Episode 由它启动为隔离的 child DSH process，
不能在管理插件自己的 Session 中自测。插件产品形态不取消 Evaluator 与 Candidate 的进程边界。

## 2. 产品承诺

用户选择一个 Task Pack、一个 baseline 和一个 treatment 后，产品必须回答：

1. 两个 Variant 是否真的只差声明过的 Harness intervention？
2. Harness 是否在符合条件的 Episode 中触发？
3. 外部可验证的任务结果发生了什么变化？
4. 改变最早出现在哪个行为步骤，当前能支持多强的归因？
5. 时间、token、工具调用、失败调用、子 Agent 与人工介入增加了多少？
6. 测量是否有效，哪些证据仍不足？
7. 当前只允许 diagnostic、directional，还是足以进入后续 holdout？

产品不替用户自动安装、推广或退役被测 Harness。用户显式安装 Eval Lab 自身、`init` 安装同版本 runner bridge
与 pinned first-party runtime dependency，属于产品部署，不是 Harness lifecycle 决策。产品展示证据强度和允许的
动作，用户自己选择 Keep、Iterate、Revert 或 Run More；单 Task、单 pair 的 Phase 1 结果只允许本地诊断，
不包装成领域级效果结论。

## 3. 用户旅程

```text
创建 0700 dedicated runtime root / DSH_HOME
→ 用 dedicated DSH_HOME 安装 DSH Eval Lab 到专用 eval profile
→ 连接 Codex OAuth
→ 选择内置开放编码任务
→ 选择 Baseline DSH Profile
→ 开启或关闭一个 Harness 能力
→ 确认控制变量与评测依据
→ 运行 Baseline / Treatment
→ 查看 Impact Report
→ 选择 Keep / Iterate / Revert / Run More
```

Phase 1 不要求用户设计 Eval Pack。产品内置 `open-coding-delivery-v1`，主流程只用日常语言展示“如何判定完成、
读取了什么证据、结论适用到哪里”；完整 evaluator、版本与 measurement certificate 放在可展开的“评测依据”中。

长期交互形态：

```text
Harness inventory
  └─ Harness detail
      ├─ eval binding
      ├─ eligible opportunities
      ├─ activation history
      ├─ latest controlled comparison
      ├─ guardrail / cost impact
      ├─ known blind spots
      └─ lifecycle recommendation
```

Phase 1 先交付 DSH 插件的命令行 app surface + JSON/Markdown artifact，不做上述完整 UI。命令行 app 的最后一步
必须给出四个明确动作的含义，不能把用户留在只有分数、没有下一步的仪表盘。Phase 1 没有独立的
`dsh-eval` 用户命令；所有用户入口均从 dedicated `DSH_HOME` 下的 `dsh --profile eval` 进入。

## 4. 产品对象

### 4.1 用户可见对象

日常主流程只暴露四个对象：

1. **Task**：要完成的开放编码任务及公开约束；
2. **Baseline**：当前 DSH 完整配置；
3. **Harness Change**：相对 Baseline 唯一声明的 intervention；
4. **Impact Report**：Outcome、Mechanism、Cost、Validity 与下一步。

`Eval Pack`、`Task Pack`、`Experiment`、`Episode`、`Evaluation Result` 与 certificate 是内部可追溯契约；
它们可在 evidence 详情中查看，但不要求个人用户先学习这套术语才能运行一期产品。

### 4.2 Eval Pack

Domain Truth Source 不是 Eval Pack。前者是事实所在的位置，例如隐藏行为测试、冻结 Git tree 与 DSH SessionEvent；
后者是读取、隔离、解释和校准这些事实的可执行测量契约。

Phase 1 内置且固定：

```yaml
eval_pack_id: open-coding-delivery-v1
domain: open-coding-delivery
truth_sources:
  - frozen-git-candidate
  - hidden-behavior-oracle
  - dsh-session-event-log
dimensions: [outcome, mechanism, cost]
claim_strength: diagnostic
effect_claim_eligible: false
```

Eval Pack 负责 Candidate freeze、Oracle 隔离、结果向量、measurement validity、校准证据和报告边界；
Harness 不能修改它、选择自己的 Oracle 或读取 oracle-only artifact。

### 4.3 Task Pack

定义领域问题，而不是定义 Agent 工作流：

```yaml
task_id:
public_input:
environment_snapshot:
target_population:
opportunity:
candidate_artifact:
hard_boundaries:
oracle_only:
cost_dimensions:
```

开放任务没有唯一实现路径，但必须有可观察的行为终态。Phase 1 选择本地 Coding Task：实现方式开放，
正确性由隐藏行为测试与 workspace/Git artifact 验证。

### 4.4 Harness Variant

```yaml
variant_id:
dsh_version:
model_route:
agent_preset:
profile_layers:
plugin_packages:
resolved_config_digest:
tool_schema_digest:
intervention_ref:
```

Baseline 与 treatment 的所有差异都必须出现在 `intervention_ref`；发现未声明差异时，比较立即 invalid。

### 4.5 Experiment

冻结科学问题、Task Pack、Variants、控制变量、Evaluator、预算、随机性与 Claim 强度。

### 4.6 Episode

一次 fresh DSH Session 及其完整执行证据，包括 parent/child lineage、SessionEvent seq 范围、最终 Candidate、
usage 与终态。SessionEvent 是运行证据，不自动是真实效用。

### 4.7 Evaluation Result

先判 measurement validity，再保留：

- hard gates；
- Domain Oracle 行为向量；
- mechanism diagnostics；
- cost；
- evaluator/version/evidence refs；
- abstention / insufficient reason。

### 4.8 Paired Impact Report

按 Outcome、Mechanism、Cost 三块展示 control/treatment 差异，并声明 attribution maturity、claim strength 与
next evidence。没有万能总分。

## 5. 系统边界

```text
             DSH Eval Lab management plugin (`eval` profile)
┌──────────────────────────────────────────────────────────────┐
│ DSH app commands / ExperimentSpec / Variant fingerprint      │
│ Pair runner / evidence resolver / measurement validator      │
│ External Oracle / report generator                           │
└───────────────┬───────────────────────────────┬──────────────┘
                │ child DSH process             │ measure after freeze
                ▼                               ▼
┌──────────────────────────────┐    ┌──────────────────────────┐
│ isolated runner profile      │    │ isolated adjudication    │
│ fresh process + Agent Session│    │ hidden behavior Oracle   │
│ tools / goal / compaction    │    │ deterministic checks     │
│ SessionEvent + workspace     │    │ no candidate write path  │
└──────────────────────────────┘    └──────────────────────────┘
```

管理插件与 runner 使用同一发布物版本，但 runner profile 显式禁用 management app row，只保留安全 bridge；
control/treatment 的 bridge bytes、配置与 tool schema 完全相同。管理插件不进入 Candidate prompt、tool surface、
Session lineage；runner fingerprint 显式记录 package digest 与 app-disabled 常量。

### 5.1 DSH 原生提供

- profile / Cordis composition；
- provider-neutral model route；
- Session、turn、step、tool call/result；
- append-only SessionEvent 与 persistence；
- tool policy、approval、sandbox；
- compaction、goal、todo、subagent、workflow；
- usage 与终止原因；
- session query/export。

### 5.2 Eval Lab 负责

- Experiment/Task/Variant identity；
- composition 与 intervention fingerprint；
- fresh Session / fresh workspace 配对；
- Candidate artifact freeze；
- SessionEvent evidence projection；
- Oracle 隔离与执行；
- measurement validity；
- paired comparison 与报告；
- task split / exposure ledger（Phase 1 仅登记，不做通用服务）。

### 5.3 Phase 1 不新增 Runtime Observer 插件

DSH 已把模型可见 prompt、tool schema、tool call/result、assistant output、compaction 与终态写入 SessionEvent。
Phase 1 先做离线 projector，读取 canonical log；只有当候选 Harness 的关键 activation 不在事件中时，
才为该 Harness 增加 typed observation event。

Observer 本身若新增，必须在 baseline 与 treatment 两臂完全相同且 model-invisible，否则它会成为混杂变量。

## 6. Harness 与 Eval 的长期绑定

当一期证据证明需要复用绑定时，每个可观测 Harness 才声明一个轻量 `evalBinding`：

```yaml
harness:
  id: completion-certifier
  version: git:abc123
  affects: [termination]
  activation:
    eligible_when: agent_claims_complete
  observations:
    - completion_claimed
    - verification_started
    - completion_rejected

eval_binding:
  task_packs: [open-coding-v1]
  evaluator: long-task-delivery-v1
  hypothesis:
    primary: reduce_false_completion
  guardrails:
    - verified_completion_non_inferior
    - no_safety_regression
  sunset_signal:
    - no_holdout_effect
    - excessive_false_activation
```

绑定的是复用 Eval Pack，不是为每个插件复制一条专属管道。Harness 只声明效用主张、eligible opportunity、
activation evidence 和候选生命周期信号；它不能给自己打分或选择 verdict。

## 7. Phase 1：Baseline & Paired Impact

### 7.1 一句话目标

在现有 DSH Codex OAuth 隔离实验室中，用同一个冻结的本地开放 Coding Task，分别运行 Goal continuation
关闭与开启两个 Variant，冻结 Candidate 后执行确定性隐藏 Oracle，产出第一份可重放、证据绑定、明确标注
`effectClaimEligible=false` 的 Paired Impact Report。

### 7.2 科学问题

> 对一个需要持续推进、包含多个相互依赖修改与验证步骤的 Coding Task，启用 DSH same-session Goal
> continuation 是否改变外部验证的任务完成结果、虚假完成、执行轨迹和成本？

这不是要证明 Goal continuation 普遍有效，而是验证 Eval Lab 能否诚实地区分执行事实、测量有效性、
机制激活、任务结果和成本。

### 7.3 Intervention

```text
Control:   DSH standard coding profile，Goal stack disabled
Treatment: 同一 profile，仅 Goal stack enabled
```

DSH base composition 中 `goal`、`goal-round-driver` 与 `command-goal` 是独立 rows，standard preset 暴露
`tool-goal`。Control 必须同时关闭四个 rows，treatment 同时开启四个 rows，避免“工具可见但服务不存在”或
“服务存在但模型不可调用”的半开状态。实验使用两份隔离 profile/patch，不修改用户当前运行中的 Web profile。

冻结：

- `@deepseek-ai/dsh@0.1.0-rc.6`；
- `dsh-codex-connect@0.1.0-alpha.4.7`；
- 同一个 Codex OAuth route、model、effort；
- 同一个 Task Pack、workspace base、tool/permission surface；
- 同一个 wall-time policy；
- 同一个 Oracle version；
- fresh Session 与 fresh workspace；
- 无 Judge、无 repair、无结果回灌。

Phase 1 的目标 carrier 是 DSH 原生 `dsh --profile eval-runner <task>` one-shot headless 路径，因为它天然创建
fresh Session、等待 quiescence、flush log 并退出，适合由 management plugin 启动配对 child process。
但当前真实 OAuth 只在 Web carrier 上完成过
验收，因此实现的 Gate 0 必须先证明 headless 能解析同一个 OAuth provider/model，并留下满足本方案的 SessionEvent
证据。Gate 0 失败就停止，不允许静默退回另一条 carrier 后继续生成可比较报告；改走 Web 时必须先新增独立
conformance 证据并形成新的 carrier fingerprint。

版本边界：公开 DSH 源码快照是固定 commit `47f943859bef...`，但 npm rc.6 没有公开 `gitHead` 对应；
Phase 1 以实际安装的 rc.6 package tree、lockfile 与 profile inputs 做部署 fingerprint，不把源码 rc.5 细节冒充
rc.6 精确实现。

### 7.4 Task Pack 选择标准

Phase 1 只使用一个隔离本地 TypeScript fixture：`open-coding-ts-ledger-v1`。

- 公开需求包含至少三个相互依赖的行为目标；
- 实现路径开放，不按 gold diff 判分；
- Candidate 由 Git tree/diff 冻结；
- 隐藏 Oracle 只通过公开接口、测试和持久状态判行为；
- Oracle 对 historical red baseline 失败、对 gold/等价实现通过；
- Candidate 无法读取 Oracle、gold 或 treatment 身份；
- 不接触生产用户数据、生产 Redis、生产 repo 状态或外部发布。

它要求 Agent 完成一个具备并发安全、幂等状态转换、持久化恢复和损坏输入 fail-closed 语义的预约账本；
实现路径开放，不按 gold diff 判分。具体公开需求、base tree、allowed paths、hidden checks、red/gold calibration 与
Candidate policy 由 Implementation Spec 冻结。它不是历史 Clowder Task，也不读取 Clowder 或生产数据。

### 7.5 Phase 1 产物

源码与运行态必须物理分离：

```text
/Users/slipshod/AIBuild/dsh-eval-lab/          # 独立 Git 源码仓库
├── cordis.patch.yml                            # DSH bundle patch
├── contracts/
│   ├── experiment.schema.json
│   ├── episode.schema.json
│   └── evaluation-result.schema.json
├── task-packs/
│   └── open-coding-v1/
├── variants/
│   ├── goal-off.json
│   └── goal-on.json
├── src/
│   ├── app/                                    # eval profile command surface
│   └── bridge/                                 # runner-only safety bridge
├── tests/
└── package.json                                # dsh.bundle.patch declaration

/Users/slipshod/AIBuild/dsh-eval-lab-runtime/  # 非 Git，权限收紧
├── dsh-home/                                    # OAuth credential / profiles / sessions
│   ├── profiles/eval/                           # management plugin profile
│   ├── profiles/eval-runner/                    # isolated child carrier profile
│   └── sessions/
├── workspaces/<campaign-id>/<arm>/
└── campaigns/<campaign-id>/
    ├── manifest.json
    ├── episodes/<episode-id>/
    ├── oracle/
    ├── report.json
    └── report.md
```

现有 `/Users/slipshod/AIBuild/dsh-codex-oauth-lab` 只保留为已经通过真实 OAuth 验收的参考环境，不承载
Eval Lab 源码、Task fixture 或 Campaign。Eval Lab 不写 Clowder AI workspace、不读取 `~/.dsh`，也不复制
或提交 OAuth secret。

逻辑组件只有五个：

1. **DSH App Plugin**：解析 `dsh --profile eval <command>`，提供产品入口，不参与被测 Episode。
2. **Contracts**：版本化 schema、canonical content digest、Claim 强度。
3. **Runner**：创建 fresh workspace/session，启动隔离 child DSH process，运行 control/treatment，冻结 Candidate。
4. **Projector + Oracle**：读取 SessionEvent、验证证据边界、在隔离副本执行隐藏行为检查。
5. **Reporter**：生成机器 JSON 与人读 Markdown Paired Impact Report。

MVP 是一个可由 DSH plugin manager 安装的本地 bundle package，不为逻辑目录拆多个 npm package。app 与 bridge
是同一发布物的不同 entrypoint；用户不直接执行 package 内部脚本。

### 7.6 最小结果向量

```yaml
measurement_validity:
  status: valid | invalid | insufficient
  reasons: []

outcome:
  externally_verified_completion: true | false
  behavior_vector: {}
  false_completion_claim: true | false

mechanism:
  goal_created: true | false
  goal_rounds_started: 0
  completion_or_blocked_claims: 0
  interrupted_or_abandoned: false

hard_gates:
  unauthorized_path_change: pass | fail | unknown
  oracle_hidden_from_candidate: pass | fail | unknown
  candidate_frozen_before_oracle: pass | fail | unknown

cost:
  elapsed_ms:
  input_tokens:
  cached_input_tokens:
  output_tokens:
  tool_calls:
  failed_tool_calls:
  turns:
  child_sessions:
```

Report 按 control/treatment 并排展示原始值和 delta，不计算综合质量分。

### 7.7 Phase 1 Acceptance Criteria

- [ ] AC-1: 一个版本化 `ExperimentSpec` 精确绑定 Task Pack、两个 Variant、实际 DSH package tree、
      model route、profile/patch、tool schema、permission、Oracle 与 claim eligibility。
- [ ] AC-2: Control 与 treatment 使用 fresh Session、fresh workspace；除 Goal intervention 外没有未声明差异。
- [ ] AC-3: 两臂都由真实 Codex OAuth 模型执行，不使用 fake provider 冒充产品 baseline。
- [ ] AC-4: Executor 只能看到公开任务和正常工具；看不到 Oracle、gold、arm label 或 report。
- [ ] AC-5: Candidate artifact 在任何 Oracle/报告步骤前冻结并得到 content digest；后续测量无写回路径。
- [ ] AC-6: SessionEvent projector 能重建模型 route、prompt/tool surface、tool call/result、Goal lifecycle、终态、usage
      与 parent/child lineage；缺失关键证据使 measurement invalid。
- [ ] AC-7: 隐藏 Oracle 在隔离 Candidate 副本运行，保留完整行为向量；Oracle 失败不向当前 Agent 开 repair。
- [ ] AC-8: Candidate failure、infrastructure invalid 与 insufficient evidence 三者可被机器区分。
- [ ] AC-9: 生成 `report.json` 与 `report.md`，包含 Outcome、Mechanism、Cost、evidence refs、known blind spots、
      `claimStrength=diagnostic` 和 `effectClaimEligible=false`。
- [ ] AC-10: 重读 artifact 时所有 ref/digest 可解析；内容性结果与 volatile host/path/time metadata 分离。
- [ ] AC-11: red baseline / gold-or-equivalent 对 Oracle 的方向校准通过；校准运行不进入 Candidate effect 比较。
- [ ] AC-12: 全程只使用隔离本地 fixture 和实验数据，不连接生产用户数据存储，不修改用户当前 DSH runtime config，
      不读取或写入 ambient `~/.dsh`，不安装未知第三方插件，不产生外部发布或不可逆动作。
- [ ] AC-13: 源码 Git root、Eval runtime root 与已验收 OAuth 参考实验室三者分离；secret、Session、Candidate 和
      Campaign artifact 均不进入源码仓库；所有 supported DSH invocations 在 process 启动前继承 exact dedicated
      `DSH_HOME`，ambient home sentinel 证明零读写。
- [ ] AC-14: 产品能通过 `DSH_HOME=<dedicated-home> dsh plugin --profile eval add <package>` 安装，并只通过
      同一 home 下的 `dsh --profile eval <command>` 暴露用户入口；runner config 将 management app 固定为 disabled，
      app 不进入模型可见 request/tool surface，两个 arms 只执行 byte-identical 的 runner bridge。

### 7.8 Phase 1 通过的定义

Phase 1 的成功不是 treatment 获胜，而是：

> 对任意结果组合（两臂都过、一过一败、两臂都败、某臂 measurement-invalid），系统都能生成可解释、
> 可重放、没有隐藏反馈的证据包，并且只说证据允许说的话。

以下结果都可能是合法终态：

- Goal treatment 改善了这个 Case；
- 两臂无差异；
- Goal 增加成本但没有改善结果；
- Goal 没被 Agent 激活；
- 任务或 Oracle 不具判别力，measurement insufficient；
- 执行环境失效，comparison invalid。

产品不能为了“Demo 看起来成功”筛掉这些结果。

## 8. Phase 1 非目标

- 统计显著或总体 uplift；
- 多 Task Pack、多模型或多 seed 平台；
- LLM Semantic Judge；
- 自动 attribution root cause；
- 自动生成/修改 Harness；
- 自动 promote、rollback 或 sunset；
- Eval Hub UI；
- 生产流量、远端发布或社区 benchmark；
- Clowder Work Ledger、F192/F266 运行时接线；
- 第三方 DSH 插件的安全沙箱。

## 9. Phase 1 之后的毕业顺序

### Phase 2 — Plugin Eval Binding

- Harness manifest / `evalBinding`；
- typed activation events；
- reusable Task Pack / Eval Pack registry；
- trigger、non-trigger、holdout 三桶；
- exposure ledger；
- 多任务 paired replay。

### Phase 3 — Requirements Delivery Evaluation

Phase 3 不从 LLM Judge 开始，而按以下顺序毕业：

1. **Phase 3A — Domain Truth Onboarding & Requirement Binding**：`design-domain-grader` 访谈 Skill、
   Evidence Cards、版本化 Product Domain Contract、Requirement ChangeSet 与 Claim impact graph；
2. **Phase 3B — Deterministic Grader Compiler & Admission**：Claim IR、Behavior Vector、受限模板、
   Gold/mutants/counterexamples、grader holdout、repeatability 与签发/撤证；
3. **Phase 3C — Calibrated Semantic Residual**：只裁决无法确定性判定的剩余语义，分维、可 abstain，
   且不能覆盖 deterministic hard-gate failure。

详细边界以 [Phase 3 Product Plan](./2026-08-19-dsh-eval-lab-phase-3-product-plan.md) 为准。

### Phase 4 — Attribution & Intervention

- failure cluster；
- critical-step candidate；
- competing attribution；
- repeat/model swap/Harness ablation/tool stub/fault injection；
- replay + untouched holdout；
- attribution maturity。

### Phase 5 — Lifecycle Product

- Harness inventory 与 impact history；
- shadow/canary/active/restrict/dormant/retired；
- owner recommendation；
- rollback/revive；
- live re-eval；
- 必要时对接 F192/F266，而不是复制其控制面。

每一阶段必须由前一阶段真实证据暴露的需求驱动；不为未来假想场景预建大平台。

## 10. 主要风险与控制

| 风险 | Phase 1 控制 |
|---|---|
| Observer 改变模型行为 | 不新增 model-facing Observer；离线读 SessionEvent |
| 管理插件污染被测 Agent | management profile 与 runner profile/process 分离；runner 显式禁用 app row，只执行两臂相同的 bridge |
| 两臂 profile 漂移 | package/profile/config/tool digest + exact allowed intervention |
| Goal 没被激活 | 作为 mechanism outcome，如实报告，不改 prompt 强迫调用 |
| Oracle 泄漏 | capability/path separation，Candidate 看不到 oracle-only artifact |
| Candidate 后评测 repair | freeze 后无写回、无第二 Candidate Episode |
| 自报完成冒充成功 | 外部 Oracle + false-completion 诊断 |
| Judge 污染或不稳定 | Phase 1 不使用 LLM Judge |
| 一对样本被包装成 uplift | `effectClaimEligible=false` 硬字段 |
| DSH rc.6 / source rc.5 provenance gap | fingerprint 实际安装物，明确不做逐 commit 外推 |
| 第三方 plugin 权限过大 | Phase 1 只切换 DSH first-party Goal stack |
| DSH workspace-write 不限制读取/network | 两臂禁用 shell/web；同一 bridge 约束 workspace path，Candidate 子进程与 Oracle 走 deny-default sandbox |
| 本机或生产数据风险 | isolated fixture/workspace/store，无 production boundary |

## 11. 产品决策记录

1. **认识论先于现有实现**：LF-0001、F192/F267、CS329A 与研究项目是证据来源，不是 DSH 母版。
2. **Phase 1 不建通用 Kernel 包**：先让一个真实 consumer 跑通，稳定语义再抽取。
3. **Phase 1 不上 Judge**：确定性 Oracle 先证明执行、冻结、隔离与比较边界。
4. **Phase 1 不新增 Observer plugin**：优先消费 DSH canonical SessionEvent。
5. **先用 first-party Goal stack 做 intervention**：避免候选插件实现质量与 Eval Lab 同时成为未知变量。
6. **结果向量优先于总分**：Outcome、Mechanism、Cost 与 validity 分离。
7. **一期只交 Diagnostic**：单 Task、单 pair 不能支持效果或推广结论。
8. **产品成功不要求 treatment 获胜**：诚实检出无差异、伤害或无效测量同样是成功。
9. **固定一个 Domain**：Phase 1 不建设 Domain registry 或通用 Pack authoring；只交付开放式编码领域。
10. **单一使用者，不预建角色系统**：认识论责任保留在契约和步骤中，不投射成产品 persona 或权限层。
11. **源码与运行态分家**：新建独立 `dsh-eval-lab` 源码仓库；现有 OAuth lab 仅作验收证据，不在其上继续堆产品。
12. **产品入口原生属于 DSH**：Eval Lab 作为外部 DSH bundle 安装到专用 `eval` profile；Phase 1 不发布独立
    `dsh-eval` 用户命令。
13. **插件形态不越过实验边界**：management app 只做 control plane，Candidate 始终运行在隔离 child DSH process；
    同一 Session 内“边运行边评自己”不是合法 carrier。

## 12. Source Map

- [DSH Eval Lab Phase 1 Implementation Spec](./2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md)
- [DSH Eval Lab Phase 2 Product Plan](./2026-08-18-dsh-eval-lab-phase-2-product-plan.md)
- [DSH Eval Lab Phase 2 Implementation Spec](./2026-08-18-dsh-eval-lab-phase-2-implementation-spec.md)
- [DSH Eval Lab Phase 3 Product Plan](./2026-08-19-dsh-eval-lab-phase-3-product-plan.md)
- [DSH Eval Lab Phase 3A Implementation Spec](./2026-08-19-dsh-eval-lab-phase-3a-implementation-spec.md)
- [In-snapshot DSH primary evidence bundle](../evidence/dsh/README.md)

外部 provenance（不属于 assignment 实现依赖，隔离 Agent 不得访问）：Clowder AI Agent Eval Epistemology、
DeepSeek Harness 设计分析、DSH OAuth 插件扫描、CS329A 调研、F192 Harness Eval、F267 Measurement Validity、
F266 Verdict Closure。本文与 Implementation Spec 已冻结它们对 Phase 1 的适用结论。

Phase 1 实施前需要再冻结实际 DSH lab 的 package tree、profile、route 与 Task Pack artifact；本文只锁定产品与
验收契约，不把当前进程状态或 OAuth token 写入文档。
