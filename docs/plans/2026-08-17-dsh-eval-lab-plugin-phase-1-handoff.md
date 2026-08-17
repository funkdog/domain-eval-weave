---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, plugin, implementation-handoff, phase-1]
doc_kind: implementation-brief
created: 2026-08-17
description: "交给独立 DSH Agent 的 Phase 1 完整实现派发说明；产品以 DSH bundle/plugin 运行。"
---

# DSH Eval Lab Plugin · Phase 1 完整实现交接

> 本文是派发入口，不是第三份产品规格。发生冲突时，依次以
> [产品方案](./2026-08-17-dsh-eval-lab-product-plan.md)、
> [Phase 1 Implementation Spec](./2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md)、
> `AGENTS.md` 为准。

## 任务

在收到的隔离源码快照中，从零实现 DSH Eval Lab Phase 1 的完整目标。必须按 Implementation Spec 的
Milestone 0 → 4 顺序 red → green 推进，不能在 contracts、CLI skeleton、mock report 或局部 Demo 停止。

完成后，个人用户应能把 Eval Lab 作为 DSH bundle 安装并运行：

```sh
dsh plugin --profile eval add <local-checkout-or-built-tarball>
dsh --profile eval init
dsh --profile eval auth status
dsh --profile eval auth login
dsh --profile eval doctor
dsh --profile eval calibrate
dsh --profile eval run
dsh --profile eval report <campaign-id>
```

Phase 1 没有独立 `dsh-eval` 用户命令。package script 或内部 Node entrypoint 可以用于开发测试，但不能成为
支持的产品入口。

## 必须先读

1. `AGENTS.md`：安全边界与开发纪律；
2. `docs/plans/2026-08-17-dsh-eval-lab-product-plan.md`：产品目的、非目标与 AC；
3. `docs/plans/2026-08-17-dsh-eval-lab-phase-1-implementation-spec.md`：决策完备实现契约；
4. Implementation Spec 的 Source Map 中与 DSH CLI/profile/plugin、Session persistence、Goal、tool pipeline、
   sandbox 直接相关的一手材料。

读完前不要写实现。公开 DSH source snapshot 只提供结构证据；rc.6 安装物的 exports、dump-config 与 contract test
才是实际部署真相。

## 冻结产品形态

一个 `dsh-eval-lab` package 同时发布两个 entrypoint：

- `dsh-eval-lab/app`：management `eval` profile 的命令 app；
- `dsh-eval-lab/bridge`：`eval-runner` profile 的 model-facing safety bridge。

两者由同一个 `cordis.patch.yml` 声明。Management profile 启用 app、禁用 bridge；runner profile 禁用 app、
启用 bridge。产品插件负责 orchestration，但不能在自己的 management process/Session 中运行被计分 Agent。

每个 control/treatment arm 都必须是：

```text
fresh workspace
+ fresh child DSH process
+ fresh eval-runner Session
+ same package/model/tool/permission/bridge surface
+ only four declared Goal row differences
```

Candidate freeze 后才允许生成 hidden Oracle seed 和运行 adjudication；结果不得回灌 Agent 或开启 repair。

## 完整交付边界

实现并验证：

- DSH bundle manifest、app argument grammar、management/runner profile composition；
- 四个 artifact schemas、strict parser、canonical JSON/digest/ref replay；
- runtime-root invariant、secret-safe auth facade、doctor；
- bridge path/tool guard 与固定 `workspace_test`；
- fixed Task Pack、red/gold/mutant calibration、seeded hidden Oracle；
- headless carrier qualification、fresh Session discovery、Candidate freeze、SessionEvent projector；
- dimension-level measurement validity、paired runner、artifact-only report rebuild；
- deterministic JSON/Markdown report 与 Keep / Iterate / Revert / Run More 解释；
- fake E2E matrix 和一次经过用户显式 OAuth/成本确认的 real acceptance。

不得扩展：Web UI、第二个 Task Pack、通用 registry、LLM Judge、多人角色、远端 evaluator、自动
promote/rollback/sunset、Web carrier fallback 或任意第三方 Harness 安装。

## 隔离与防污染

- 只使用收到的 assignment snapshot；不要查看同机其他 branch、worktree、sibling repository 或历史实现。
- 不读取、复制、打印、移动或 hash OAuth credential；不读取 `~/.codex/auth.json`、`~/.dsh` 或 Clowder runtime。
- 所有 Session、Candidate、Campaign、Oracle 临时与持久 artifact 只写 dedicated runtime root。
- Oracle、gold、arm label、report 与管理插件 command surface 不得进入 Candidate prompt 或 model-facing
  request/tool evidence；runner fingerprint 只把 app-disabled 状态作为两臂相同的部署常量。
- 缺少显式 OAuth login 或真实模型成本确认时，完成所有无模型门禁并把 real acceptance 标为明确 blocker；
  不得用 fake provider 冒充 AC-3。

## 完成回执

最终回执必须包含：

1. exact Git revision 与完整 changed-file summary；
2. Milestone 0–4 每项完成证据；
3. frozen install、format/lint/typecheck/unit/contract/calibration/fake-E2E/build 结果；
4. DSH plugin install + `dsh --profile eval --help` 证据；
5. management/runner app-bridge role gate 与 exact four-row arm diff 证据；
6. Gate 0 与 real Campaign 结果，或满足安全边界的明确 blocker；
7. known blind spots、未完成项与任何 measurement-invalid / insufficient 结果。

Treatment 获胜不是完成条件。能对 pass/fail/no-effect/not-activated/measurement-invalid 的任意合法组合生成诚实、
可重放、无隐藏反馈的证据包，才是 Phase 1 完成。
