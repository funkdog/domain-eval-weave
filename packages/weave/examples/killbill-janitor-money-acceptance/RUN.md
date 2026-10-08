---
feature_ids: []
topics: [knowledge-consumption, native-agent, paired-trial]
doc_kind: operator-runbook
created: 2026-09-11
status: self-execution-scheduler-blocked
qualification: not_qualified
---

# 两组 Agent 试用入口

这一步把已准备的材料和判题工具接到真实 Agent。首次命令在模型调用前被入口校验拦住；
修正后的真实试用已返回：原始资料组超时，知识包组按停止规则未启动。
已核对的运行、环境问题与部分代码产出见 [RESULT.md](RESULT.md)，没有知识包对照结论。
下文另记修复后的新轮次：共同环境问题已修复，5uXHdK的A又在截止时未交付，B未启动；
此次A实际跑通了基座，没有重现原环境错误。结果与预算／停止规则问题见 [RESULT-REPAIRED.md](RESULT-REPAIRED.md)。

## 本轮实际到达的位置

原生无模型检查已经通过，两组启动配置已经冻结。
operator 以 `0001789061886456-000354-4b36bb6e` 明确要求“不用交叉审阅，直接运行起来看结论”，
因此撤回入口交叉审阅请求，并授权本对各一次、各最多 300 秒的探索运行；这不是审阅通过或资格晋升。
首次原始资料组命令退出后确认，其目录只有 launch，没有 attempt、invocation、process 或 episode：
入口误把消息 ID 限为 13 位时间戳，而真实 ID 的时间段是补零后的 16 位。失败通知
`0001789062215574-000361-98b293d4` 保留；没有调用原生 CLI／模型，不计作模型试用结果。
修订把审计引用当有界、非空的 opaque ID，保留原文而不猜内部格式；真实 ID 的定向回归先红后绿。
允许在两组都尚未启动时追加冻结 manifest 修订，旧文件不覆盖，新旧修订共用同一 runRoot/attempt 锁，
不能借修订获得第二次模型机会。入口代码变更后的原生预检和新 pair 已完成，业务校准与材料不变。
最终产物仍保留未独立审阅、`not_qualified`，用户授权不替代开放价值结论的证据。

- 实现版本：`082e37c`；两项配置／提前拒绝检查通过。
- 原生预检根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/codex-tool-probe.nFjRTE`；13 项通过，
  `result.json` digest `cd2dc71ce6784188275b576e03262647e879dd9d5942e54e1077dd65a7f6e838`。
- 已对照原始工具输出：私有读写及控制／两个原工作区的读取全部为 EPERM，公开 Java 编译成功。
  原生 Session 投影与错提示词／扩权／缺工具输出拒绝，复用四项既有检查通过，无额外 Java／模型执行。
- pair：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-knowledge-trial.Zz6x2C/control/knowledge-pair.json`，
  digest `82289798da71dfe39ec1ef43ccb921617c0f73e4cca4b38a65bc06a473fbd7ab`。
- 原始资料组 launch：同一 control 下 `verifier-run.6iyZBE/launch.json`，
  digest `681fd066a75126db6b0c42ab115e4fd83e27664d94a6c1fc15c1fb4f75b77457`。
- 知识包组 launch：同一 control 下 `verifier-run.6zPHTH/launch.json`，
  digest `82ff12d0d8f722b2f1cea251d3cd4807e6ff24a187c008e4c058ddde32d70a47`。

启动前重读 pair，已核对提示词相同、配置仅工作区不同、参数可从冻结配置准确重建、两组均尚无 attempt。
之后已观察到一次真实超时的过程／源码保全与第二组停止；没有实跑其他失败类别，也未尝试第二次启动。

### 修正后实际采用的配置

实现版本 `86809c3`；新原生预检 `codex-tool-probe.R5HD1I` 的 13 项检查通过，
result digest `d287456ecf8f090545e9bd70f740d968af5701d32c14a7bcb910be3be4ff9adc`。
已从原始 Session 核对准确提示词、权限和工具结果；private/control/两个工作区读取被拒，公开编译成功。

正式采用同一 control 下 `knowledge-pair.b0f93efe73698d5f740efbebba0ff051d45be02ad20c1114cac2e63b3e77d6c7.json`，
其 digest 为 `b0f93efe73698d5f740efbebba0ff051d45be02ad20c1114cac2e63b3e77d6c7`。
原 pair 和原 launch 留作未启动历史，不再使用。新 launch：

- 原始资料组：原运行槽 `verifier-run.6iyZBE` 内
  `launch.ddc37f36848e7a1242f1d40fb5173b269f3a38bcc0c262018c73e44276d71867.json`。
- 知识包组：原运行槽 `verifier-run.6zPHTH` 内
  `launch.bb0280bd4b32db4c6751261d7542b254e20fe65ef87432e23569ea54ed813f2c.json`。

托管命令 `hold-ball-1789062606536-sbvaap` 已发起 `live-pair`，授权引用为上述 operator 消息。
按原始资料组、知识包组的顺序执行；原始资料组300秒超时，因此未进入第二组。
episode保存了源码和原生过程，evaluation=null；本轮没有重跑模型或追加Java判题。

两组做同一件事：根据相同简短需求，补写真正的 Java 验收代码，并说明用了什么资料。
原始资料组自己查来源；知识包组还可使用选题前已有的 Module 和五份人读文档。
交付后由控制侧运行验收，不相信 Agent 自报的分数。信息差异见 [信息账](INFORMATION-LEDGER.md)。

## 原限时轮次的运行边界（历史）

- 复用已经采用的 Codex CLI 0.153.4、gpt-5.6-sol、xhigh；不换 Harness／模型／依赖。
- 每组一个新会话、一次启动、最长 300 秒，输出上限 1 MiB；无自动重试或会话续跑。
- 顺序固定为原始资料组，再知识包组。单对、固定顺序、作者选题均限制外推，不作统计排名。
- 相同配置，只替换本组工作区。模型工具不能访问作者控制目录、另一组工作区、网络或凭据。
- 仅允许修改验收源码并交付 INFORMATION.md。原始资料、业务类和依赖在提交时逐项查验未变。
- CLI 自身沿用 operator 已独立登录的隔离 auth home；组织者只检查文件元数据，不读、复制或散列凭据。
- 费用没有换算成金额；记录实际原生用量与运行时间。启动前需 operator 确认这两个有界模型会话。
- 第一组原生运行或测量无效时先停止诊断，不自动启动第二组；业务缺陷漏检不是运行基础设施失败。

这里复用的事件记录方式参考 [OpenAI 非交互运行文档](https://learn.chatgpt.com/docs/non-interactive-mode)：
JSONL 记录会话、工具与完成事件。本地版本的权限和实际提示词另由原生预检及 transcript 校验，
不以网页介绍替代本机检查。

## 内部命令

以下入口仅供组织者使用，不发给被测 Agent。所有运行目录必须位于项目 runtime 目录，且不是符号链接。
`NODE` 在以下命令中代表 `/Users/slipshod/.nvm/versions/node/v24.16.0/bin/node`。

```text
NODE --import tsx scripts/probe-codex-coding-tools.mjs --verifier-trial <trial-root>
NODE --import tsx scripts/janitor-knowledge-run.mjs prepare <trial-root> <calibration-report> <preflight-root> <isolated-auth-home>
NODE --import tsx scripts/janitor-knowledge-run.mjs live <pair.json> raw_sources <operator-message-id>
NODE --import tsx scripts/janitor-knowledge-run.mjs live <pair.json> prior_knowledge <operator-message-id>
NODE --import tsx scripts/janitor-knowledge-run.mjs live-pair <pair.json> <operator-message-id>
NODE --import tsx scripts/janitor-knowledge-run.mjs replay <consumer-episode.json>
```

预检使用无凭据的临时 home 和本地合成响应，不调用真实模型；仅在独立副本中编译起始验收，
不动未来两组工作区，也不重复运行已通过的业务样本校准。它验证共同题面经过原生 CLI 后未改变，
以及越界读取／写入、改 cwd、提权、联网和公开 Java 编译的实际行为。

prepare 要求预检和校准绑定同一冻结 trial 与当前入口代码，随后冻结两组 launch 和一个 pair。
同一 trial 只有一对运行槽，live 对每组写独占 attempt 记录；失败后不能用同一入口再启动模型。
尚未启动的配置修正只追加内容寻址的 pair/launch 文件并复用原运行槽，不重置任何 attempt。
live-pair 顺序执行已授权的两组；任一组运行／测量无效便停止，不重试。
operator message ID 只是授权的审计引用，不是身份验证器；调用方仍须核对原始用户授权，不能编造引用。

## 实际产物与失败处理

- `launch.json`：本组准确提示词、材料标识、模型、权限和预算。
- `attempt.json`、`invocation.json`、`process.json`：唯一启动和实际进程记录。
- `native-capture.json`：实际 Session、原始工具输入输出、用量记录；失败时保存可归属的残留记录。
- `submission-receipt.json`：停止模型进程后捕获的验收源码／解释的摘要。
- `consumer-episode.json`：上述记录与实际 Java 判题结果的关联，不自动宣称内容完整或知识有效。

原生调用失败时仍尝试捕获本组源码，但不把超时或缺少工具证据计为业务失败。
若出现多个新增 Session，不擅自挑一个归属本次运行。若投影或判题中断，保留原 run 诊断，
不重新发模型；replay 只读已有完整产物，不启动模型或 Java。
关闭边界仍是 `not_qualified`；正式运行后需要独立核验旧回归范围和来源解释。

给人看的最终结果应逐项回答：知识包多提供了什么、实际用了哪些、变成了哪些正确／错误断言、
还有什么需要人补充。没有发生的补答不能算作“节省了”，也不把知识包整体作用归因于 YAML／本体。

## 共同运行环境修复（2026-09-11）

operator 在 `0001789091868508-000402-d5564e74` 要求继续解决已明确的工程问题，仅在认识／方向问题上讨论。
因此修复公开工作区缺失的配置并继续既定试用，不重复请求执行细节确认。上次 RESULT 保留，不改写。

- 两组共同增加 `resources/mockito-extensions/org.mockito.plugins.MockMaker`，使用控制侧相同的
  `mock-maker-subclass`；公开 run_command 加入 resources classpath。
- 原生预检改为执行 ENVIRONMENT.json 中的真实 build_command 与 run_command，要求起始五场景
  完整结束；不再用简单 Probe 的 JAVA_READY 冒充起始验收能运行。
- pair 准备额外检查 `public_baseline_execution_observed=true`，拒绝沿用旧的仅编译预检。
- 新冻结根 `janitor-knowledge-trial.5uXHdK`，trial digest
  `b65db6e565a864aacc8daf6370056a096aa1c567ba6631dad640e97d0a768f05`；旧Zz6x2C及其失败／部分代码不动。
- 已机械核对新旧差异只在共同的 ENVIRONMENT.json 和新增资源文件；共同文件现在35项。
  起始验收源码、五个组件、作者验收、可信包装器、JDK/依赖及领域知识差异完全不变。

本次代码／冻结版本变化后，沿用原有定向校准并执行修正后的原生预检，不新增业务题目或全量测试。
实现提交 `0e63af0`；这两条检查在23秒内完成。校准 `5uXHdK/calibration.qvrcSZ/report.json`
digest `f3b1f599bb3f10833957bc8bcd7896eff6b6e7d0b1795ca8ea295b5037326e5b`，五种验收对五种组件符合预期。
原生预检 `codex-tool-probe.5eROt9/result.json` digest
`7f48eb64b20daee4445f15888fb85e14ddd725bb77f55401602de28984eff6bd`；13项通过，
`public_baseline_execution_observed=true`，实际公开运行输出五个旧场景与END，没有Mockito初始化错误。
主Agent已核对原始工具输出、原生Session的准确提示词/权限及校准回放，没有再运行Java。

修复后pair：`5uXHdK/control/knowledge-pair.json`，digest
`10eced5424c713a8fbd161fa088968567b1348cd4a87d1ab7ce6d87a1d7139d0`。
原始资料组 `control/verifier-run.UAJHiQ/launch.json` digest
`4cee4acea7e144272ae5859b4b08987f4eeb4ea92b23ae245102840ef6f175d2`；
知识包组 `control/verifier-run.0FO7dw/launch.json` digest
`d35e4f7c87611d4c07e49dbcb0d3e361d94b7e0d9f788f933ae7670e18d75ceb`。
两组各一次、各最多300秒的live-pair已通过托管命令 `hold-ball-1789092394560-iwtx62` 发起；
依据当前继续推进指令，不再请求已明确工程步骤确认，仍不放宽权限或为了正结果追加尝试。
该命令最终在A的300秒截止后停止；已接收并核验结果，B未启动，不表示两组完成或知识包有效。

## 当前轮次：以完整交付为终点，不设实验时间截止

operator `0001789093433167-000429-11b9616a` 将验证方向／价值置于运行限额之前。
本轮两组使用全新工作区和Session，保留共同任务、原始资料、已修复资源、模型和知识差异；
不把旧限时A与新不限时B合并，不修改旧结果。

- 原生消费者manifest使用 `budgets.wall_ms=null`，运行器不注册任务超时计时器。
- 每组仍只启动一次、无自动重试，隔离与权限不变；不规定完成必须得到正面业务分数。
- 原有1 MiB进程输出保护仍保留；外层托管每条命令目前最长1小时。这些是基础设施边界，
  不是本轮效用或能力门槛；触发后记录中断，不自动加分／扣分或重试。
- 收到operator／平台SIGTERM或SIGINT时，停止子进程并保留中断标识，避免取消任务后仍留下模型进程。
- 两项无模型进程检查先红后绿：null预算允许自然结束，既有有限预算仍能中止超时子进程。
- 新材料根 `janitor-knowledge-trial.7sSm8O`，trial digest
  `f48fb30ed88e513b347f390069167147cf2c666bc537998b4374409dc599a578`；模型尚未启动。

接下来在当前执行版本上完成必要的同链路检查并冻结pair，分别托管两组运行。
运行后先核对真实Java、来源解释和样本结果，再按信息账解释知识包究竟提供了什么，时间与用量只作观察。

准备已完成：代码 `82303bd`；`7sSm8O/calibration.JIzFdR/report.json` digest
`3d08cd8367f36eb566bebdb3a7abe35732152b86241347f536476afb4fd869af` 通过；
`codex-tool-probe.AwN0Wr/result.json` digest
`b0de3ebaf84e5fcc6faee423e68c88a96da2ceeeebd6e90edf97380022dbf347` 的13项及公开五场景通过。
原生Session的准确提示词／模型／权限已核对；材料与修复后上一轮逐字一致。

当前pair：`7sSm8O/control/knowledge-pair.json` digest
`c9e1c0e9d42fe5e7515260aa9d188dd946e11ee11f70a0cc4ba073976414361b`。
A `control/verifier-run.09JTMU/launch.json` digest
`bbfad057982143da9bdbca9c79193e47081e6522dfc6fc2cf0969f2fc934ba8e`；
B `control/verifier-run.NmaZ5k/launch.json` digest
`42346d9b3d0a3d2e71615e040863c2285447a4e30d5b45298f6a4f719069c1be`。
冻结后确认wall_ms均为null、prompt相同、配置仅工作区不同、两组均无attempt。

宪宪当前小时托管额度3/3，依调度规则将现成命令的执行交给砚砚，非交叉审阅。
执行任务 `0001789094209883-000445-0870f006`，结构化交接消息 `0001789094304624-000447-12c68f90`。
执行责任已路由，实际模型启动／完成证据尚未返回；砚砚执行与回传，宪宪接回价值分析。
不把任务接收写成模型已经运行，也不由另一身份再执行同一个attempt。

operator于 `0001789095818445-000483-f15bbf77` 明确要求宪宪本人执行、不再传球。
宪宪已重新核对两运行槽只有launch，代码／参数／null预算未漂移，并用消息
`0001789095993494-000485-ff7d72f7` 撤回旧委派，禁止砚砚启动旧命令。
随后本人启动A的托管请求仍返回429 `maxHoldsPerWindow (3 per ~1h window) reached`，
没有产生新的托管任务或模型运行。执行责任已按operator指令收回；平台任务面板的旧委派记录
不代表仍有执行授权。当前等待调度额度恢复，不换身份／其他入口绕过限制，不重复准备材料或校准。
