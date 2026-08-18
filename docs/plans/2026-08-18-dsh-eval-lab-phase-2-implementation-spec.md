---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, plugin-eval-binding, activation-events, exposure-ledger, multi-task-replay]
doc_kind: implementation-plan
created: 2026-08-18
description: "DSH Eval Lab Phase 2 的决策完备实现规格：Goal evalBinding、typed activation、三桶 Task Registry、exposure ledger 与多任务配对重放。"
---

# DSH Eval Lab Phase 2 Implementation Spec

## 1. 目标与边界

Phase 2 把 Phase 1 的单个 first-party Goal 实验提升为一个可复用、可重放的 Plugin Eval Binding 纵向闭环：

1. 一个版本化 Harness manifest 精确声明 `evalBinding`；
2. Session 中的 Goal lifecycle 被投影为 typed activation artifact；
3. 一个包内只读 Registry 绑定一个 Eval Pack 与多个 Task Pack；
4. Task 被固定分入 trigger、non-trigger、holdout 三桶；
5. 每个模型 Episode 产生 immutable exposure record；
6. 一个 Suite 运行多个 paired Campaign，并从冻结 artifact 重建聚合报告。

Phase 2 仍只支持本地、单使用者、开放式 TypeScript coding、first-party DSH Goal stack 与确定性 Oracle。
它不新增 Web UI、LLM Judge、远端 evaluator、多人角色、生产数据、自动 promote/rollback 或第三方插件沙箱。

Phase 1 的 `run` / `report` 与 schema v1 artifact 保持可读、可重放。Phase 2 新能力通过独立
`suite run` / `suite report` surface 暴露，不静默改变旧 Campaign 的含义。

## 2. Instance 隔离

DSH_HOME 继续固定为：

```text
/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home
```

OAuth credential metadata 与只读 model settings 属于同一 transport control plane；实现不得读取、复制、移动或
hash credential。其余可比较运行态必须按 instance 隔离。

本实现的 Phase 2 instance id 固定为 `clowder-ai`：

```text
management profile: eval-clowder
runner profile:     eval-clowder-runner
instance root:      /Users/slipshod/AIBuild/dsh-eval-lab-runtime/instances/clowder-ai
session root:       <DSH_HOME>/sessions/clowder-ai
```

另一个实现可使用 `dsh` instance 与 `eval-dsh` / `eval-dsh-runner`，但它不由本仓库安装、修改或检查。
Profile 名只解决 bundle/config 冲突；Session、workspace、qualification、calibration、Campaign、Suite 与 exposure
必须同时落在 instance namespace，才能声明实现间无 artifact 污染。

Phase 2 supported invocation 在 DSH boot 前同时携带 exact `DSH_HOME` 与：

```text
DSH_EVAL_INSTANCE_ID=clowder-ai
```

任何缺失、未知 instance 或 profile/name/path 不一致都 fail closed。不得回退到 `eval`、`eval-runner` 或 ambient home。
app/bridge 必须分别从 DSH root context 的 profile base URL 验证当前 profile 为 `eval-clowder` /
`eval-clowder-runner`，且验证发生在提供 app service、安装 guard、注册 tool 或写入运行态之前。

共享 `<DSH_HOME>/settings.yaml` 属于 transport control plane，不由任一 Eval Lab 实现创建或 byte-freeze。`init` 只读验证
`agent-default-model` 的 provider/model/reasoningEffort 必需字段，并允许其他 implementation 或 transport 的无关配置共存。

## 3. Harness manifest 与 evalBinding

包内唯一 Phase 2 Harness manifest：

```text
harnesses/dsh-goal-stack/harness.json
```

冻结字段：

```text
schema_version = 1
harness_id = dsh-goal-stack
harness_version
intervention rows + allowed config paths
activation source = SessionEvent goal/change
activation contract version
eval_binding:
  eval_pack_id
  registry_ref + digest
  trigger activation expectation
  non-trigger guardrail expectation
  holdout policy
```

Manifest、Registry、Eval Pack、Task Pack identity 都使用 canonical JSON digest。任何 ref 逃逸 package root、符号链接、
重复 id、digest 漂移、bucket 缺失或 binding 交叉引用错误均在调用模型前失败。

`evalBinding` 是 first-party Goal 的证据绑定，不是任意插件执行入口。Phase 2 不动态加载 registry code。

## 4. Typed activation artifact

Projector 从已冻结的 canonical Session JSONL 生成每臂一个 `activation.json`：

```text
schema_version
harness_id
session_id
events[]:
  sequence
  source_event_type = goal/change
  operation
  activation_type = activated | progressed | terminal | cleared
  goal_id
  revision
  phase
  timestamp
summary:
  activated
  event_count
  continuation_rounds
  terminal_phase
```

事件顺序、Goal transition 合法性与 summary 必须由同一个 rc.6-compatible fold 导出；不得从自由文本或工具名猜测激活。
未知 operation、非法 revision/phase/counter/timestamp、重复 sequence 或 summary 不一致使 mechanism measurement invalid。
同一合法 Session 可以在 Goal complete 或 clear 后创建新的 Goal，因此事件序列允许多个 `goal_id`；summary 描述整个
Session 的 Goal 机制轨迹，而不是把第一条 Goal 当作唯一生命周期。JSON Schema 与 Zod parser 共同负责可表达的结构约束，
连续 sequence、event count 与末态一致性等跨数组语义由 replay semantic layer 强制验证。

Control 出现任何 Goal activation 是 intervention contamination。Trigger treatment 未激活是 insufficient；non-trigger
treatment 激活是 guardrail failure；holdout 按 Task entry 的 expectation 判定。

## 5. Registry 与三桶 Task Pack

Registry 是包内静态数据，不是通用服务：

```text
registry/registry.json
eval-packs/open-coding-goal-v1/eval-pack.json
registry/tasks/<task-id>.json
```

Phase 2 Eval Pack 精确包含三个 task entry，每桶一个：

| bucket | task | 目的 |
|---|---|---|
| trigger | `ledger-full-v1` | 多步骤实现，Goal 有明确 activation opportunity |
| non-trigger | `ledger-audit-v1` | 已满足确定性行为的短审计任务，Goal 激活视为不必要开销 |
| holdout | `ledger-concurrency-v1` | 未参与 trigger/non-trigger binding 判定的聚焦并发修复 |

Task entry 绑定 public task、effective base layers、allowed paths、Oracle、behavior keys、calibration evidence 与 bucket。
Candidate workspace 只收到 materialized effective base 与 public task；看不到 registry、bucket、Oracle、calibration、arm label、
Suite path 或其他 task。

Registry loader 必须：

- 只解析 strict schema；
- 拒绝 absolute path、`..`、反斜杠、空 segment、symlink 与 special entry；
- 要求 id/ref/digest 一对一；
- 要求三个 bucket 都非空且 task id 全局唯一；
- 要求同一 Eval Pack 的 model route、permission、Oracle protocol 与 intervention 一致；
- 输出 deterministic registry snapshot digest。

## 6. Exposure ledger

Exposure ledger 采用 immutable one-record-per-file，而不是可覆盖 append file：

```text
<instance-root>/exposures/<exposure-id>.json
```

字段包含 suite/campaign/episode/session/task/bucket/arm/variant、public-task digest、base digest、candidate archive digest、
started/ended timestamp 与前置 registry/binding digest。`exposure-id` 由 suite + task + arm 唯一确定，使用 exclusive create；
相同 id 相同 bytes 幂等，不同 bytes 冲突。目录必须 realpath containment、0700，文件 0600，拒绝 symlink。

Exposure 在 Session 与 Candidate freeze 后、Oracle 前写入。失败不能伪造完整 exposure；此时 Suite measurement invalid。

Holdout 在 Suite 开始前必须没有任何既存 model exposure。永久 reservation 只能在 operator 确认与 qualification 成功后、
首个 Candidate Episode 前原子写入；拒绝或 qualification 失败不得消耗 holdout。Suite artifact replay 不产生新 exposure；
新的模型运行若重复使用已暴露 holdout，必须在调用模型前拒绝。Trigger/non-trigger 可重复运行，但报告列出 exposure count。

## 7. Multi-task Suite

`suite run` 执行顺序：

1. doctor、binding/registry validation、全部 Task calibration；
2. freeze Suite manifest 与 registry/binding pointers；
3. 确认一次最多 `2 × task_count` 个 Candidate Episodes，加一个按 Suite deployment digest 缓存的 qualification；冻结原始
   qualification 后，才原子 reserve holdout；
4. 随机化 trigger/non-trigger task 顺序；holdout 固定最后；
5. 每个 task 独立随机 arm order，fresh Session、fresh workspace、同一 task 两臂共享 Oracle seed；
6. 每臂 freeze Session/Candidate/activation/exposure，再运行 Oracle；
7. 生成每 task 的 Phase 1-compatible Paired Impact Report；
8. 生成 Suite evaluation/report JSON 与 Markdown。

Suite manifest 固定恰好三个 Task、每桶一个。用户取消、confirmation 拒绝、qualification 失败或 holdout preflight 拒绝都发生在
measurement 开始前，不得生成 measurement-invalid envelope。首个 Task measurement 开始后的 carrier/Task 基础设施失败使用
`TASK_INFRASTRUCTURE_FAILURE`；派生 artifact 或 replay 的完整性失败才使用 `ARTIFACT_INTEGRITY_FAILURE`。

Suite 不根据前一 task 或 control 结果改变后续 prompt、budget、patch 或 expectation。任一 task infrastructure-invalid 时停止
新的模型调用，保留已冻结证据并生成 Suite measurement-invalid envelope。

Suite report 展示每 task 的 Outcome / Mechanism / Cost 原始值、bucket expectation、exposure 与 cross-task summary。
不计算万能总分，不做显著性或普遍效果 claim：

```text
claim_strength = multi_task_diagnostic
effect_claim_eligible = false
```

Cross-task recommendation 仅允许：`keep`、`iterate_binding`、`keep_baseline`、`run_more`。它不执行生命周期动作。

## 8. Artifact graph 与 replay

新增 artifact：

```text
suites/<suite-id>/manifest.json
suites/<suite-id>/registry.json
suites/<suite-id>/binding.json
suites/<suite-id>/qualification.json
suites/<suite-id>/tasks/<task-id>/campaign-pointer.json
suites/<suite-id>/evaluation.json
suites/<suite-id>/report.json
suites/<suite-id>/report.md
campaigns/<campaign-id>/arms/<arm>/activation.json
campaigns/<campaign-id>/arms/<arm>/exposure.json
```

Suite manifest 必须绑定 task order、bucket、Campaign ids、registry/binding/deployment digest。每个 task Campaign 保留原始
Suite qualification，并用 source digest + projected task deployment digest 显式记录 qualification projection。Suite replay 只读
frozen bytes，逐层验证 ref+digest、Campaign semantic replay、从 Session JSONL 重投影的 typed activation、Campaign exposure
副本与 instance 0600 immutable exposure ledger、Registry/TaskPack identity、bucket expectation、aggregate derivation 与 Markdown。
任一缺失、digest mismatch、unknown extra task、重复 Campaign、交叉 Suite ref 或派生值不一致均 fail closed。

`suite report <suite-id>` 只能从 artifact 重建；不得读取 live Session、workspace、Profile 或 Registry 当前版本。

## 9. CLI

Phase 2 management surface：

```text
dsh --profile eval-clowder init
dsh --profile eval-clowder doctor
dsh --profile eval-clowder calibrate
dsh --profile eval-clowder binding show
dsh --profile eval-clowder suite run [--timeout-ms <n>]
dsh --profile eval-clowder suite report <suite-id>
```

`run` / `report <campaign-id>` 保留为 Phase 1 compatibility surface，但使用 clowder-ai instance paths。旧 fixed-root Campaign
只允许显式 read-only legacy report，不得迁移或重写 credential、Session 或 artifact。

## 10. Milestones（red → green）

### Milestone 0 — Namespace and contracts

- instance/profile/path invariants；
- Harness/Registry/Eval Pack/Task entry/Activation/Exposure/Suite schemas；
- JSON Schema 与 parser parity；
- invalid ref/digest/bucket/unknown event failure tests。

### Milestone 1 — Binding, Registry, activation

- static binding loader；
- effective Task materialization；
- rc.6 typed activation projection；
- three-bucket fixtures and calibration。

### Milestone 2 — Exposure and Suite coordinator

- immutable concurrent-safe exposure ledger；
- holdout first-exposure gate；
- multi-task paired coordinator；
- no adaptive feedback between tasks/arms。

### Milestone 3 — Artifact replay and reporting

- Suite artifact graph；
- semantic replay from frozen evidence；
- aggregate JSON/Markdown；
- corrupt/missing top-level recovery envelope。

### Milestone 4 — DSH surface and acceptance

- namespaced profiles and CLI；
- frozen package/build/import/pack gates；
- fake six-Episode E2E；
- real qualification + six Candidate Episodes；
- artifact-only Suite replay；
- independent formal review bound to exact HEAD。

## 11. Acceptance criteria

- **P2-AC1** Harness manifest 与 `evalBinding` 一对一绑定 frozen Registry/Eval Pack。
- **P2-AC2** Registry 三桶完整、path-safe、digest-closed，Candidate 不可见 bucket/Oracle/arm。
- **P2-AC3** typed activation 只来自合法 rc.6 Goal transitions，非法或未知事件 fail closed。
- **P2-AC4** control contamination、trigger miss、non-trigger over-activation 与 holdout expectation 被分别判定。
- **P2-AC5** 每个真实 Episode 有 immutable exposure；holdout 二次模型 exposure 在启动前拒绝。
- **P2-AC6** Suite 执行三个 task、六个 fresh Candidate Episodes，且无跨臂/跨 task adaptive feedback。
- **P2-AC7** 每个 Candidate 在 Oracle 前冻结；每个 task 的 Oracle 独立、确定、可 calibration。
- **P2-AC8** Suite JSON/Markdown 可从 artifact-only semantic replay 重建，derived values 不能被信任输入替代。
- **P2-AC9** 所有结论保持 multi-task diagnostic，`effect_claim_eligible=false`，无总分或自动生命周期动作。
- **P2-AC10** `eval-clowder` 与现有 `eval` Profile、Session、Campaign 和 workspace 无覆盖；ambient home 零读写。
- **P2-AC11** Phase 1 schema/artifact replay 与 CLI compatibility tests 继续通过。
- **P2-AC12** source repository 无 runtime artifact/secret，runtime root 0700，artifact 0600，credential 零读取/复制/移动/hash。

## 12. Hard invalidators

- 读取或移动 OAuth credential、ambient `~/.dsh`、Clowder runtime/data/API/ports；
- 用 profile rename 代替 Session/Campaign/workspace namespace；
- Candidate 能看到 bucket、arm、Oracle、gold、calibration 或 Suite report；
- 从自由文本推断 activation；
- holdout 已暴露仍启动新模型 Episode；
- 根据 earlier arm/task 结果改变 later task；
- Suite replay 依赖 live Profile/Session/workspace/Registry；
- 用 aggregate score、LLM Judge 或单 Suite 生成 effect claim；
- 自动删除 persisted Campaign/Suite/exposure；
- Phase 2 顺手引入 UI、远端执行、多人角色或第三方 plugin sandbox。
