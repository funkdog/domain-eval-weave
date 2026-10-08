---
feature_ids: []
topics: [coding-capsule, killbill, feasibility, provenance]
doc_kind: coding-capsule-candidate
created: 2026-09-07
status: local-component-workflow
---

# Kill Bill 代码任务候选：空插件状态转换

这是一份首个 Coding Capsule 的**本地组件级工作流**，支持固定任务、准备公开工作区、接纳新源码、
实际编译验收及回放。同一个固定任务和判定器已由 DSH 与 Codex CLI 两套实际 Harness 消费，
分别产出不同写法的 Java 修复并通过行为验收。DSH 的首次收尾失败、以及 Codex 的两次
模型调用前启动拒绝也保留在记录中。这仍是作者接入、同机单题的证据，尚未取得独立资格
或提供公共 API，不等于未经指导的外部团队已完成安装和消费。
公开任务见 [TASK.md](TASK.md)，原始可行性探测见
[probe-killbill-status-component.mjs](../../../../scripts/probe-killbill-status-component.mjs)。

外部接入者从 [CONSUMER.md](CONSUMER.md) 开始：它按 Agent、可信协调器和验收控制侧分开说明
材料、五个现有操作、源码提交及来源核验边界，并记录两套 Harness 的实际接入范围。

被测对象是 Java 源码；观察的是编译后真实方法的返回结果与异常，不接受 Agent 自报结论。

## 业务依据与基座

- 原始问题：[Kill Bill #366](https://github.com/killbill/killbill/issues/366)，2015-08-11，
  `PaymentTransactionInfoPluginConverter can throw NPE if plugin returns a null status`。
- 上游修复：[f6e13d42](https://github.com/killbill/killbill/commit/f6e13d42af033ac09305d8206fb800ee072b2239)，
  为两个转换方法加入 null 状态处理。
- 历史父提交 `9f60de4c3b4519b4ee1e0028d7c3f5310912fd03` 的 POM 使用 `0.15.3-SNAPSHOT` 及
  `killbill-oss-parent:0.33-SNAPSHOT`。本轮没有还原那个历史依赖环境，不宣称精确历史复现。
- 实际探测基座：现有领域包已经固定的 Kill Bill 0.24.21，commit
  `5da9650de60b2fa83dea556d7e95c70b79dabd39`，其中的原始 Java 文件原样提取，保留版权与 Apache-2.0 声明。
  相关领域事实是 Plugin 到 core 的状态映射（CL-04）；历史修复提供 null 状态处理的直接依据。

三个探测对象：

| 对象 | 如何取得 | 用途 |
| --- | --- | --- |
| upstream_reference | 原样使用固定的 0.24.21 类 | 上游正确行为参照 |
| seeded_regression | 明确移除两个 null 默认处理，重现历史缺陷形式 | 已知回归，不冒充真实上游当前版本 |
| authored_equivalent | 用 Optional 表达同一 null 默认处理，其余逻辑不变 | 作者可见的等价实现检查，不是独立验收 |

这里测的是有限结果转换功能，不是完整支付恢复、金融 exactly-once 或一般编码能力。该问题及修复
公开多年，存在暴露；不能用这道题声称模型具备未见任务泛化能力。

## 已观察结果

使用本机 JDK 21.0.11，以 `javac --release 11 -proc:none` 编译实际源码；复用 legacy
`StrictProcessRunner` 在 macOS sandbox 中执行，网络访问被拒绝。驱动通过真实
`PaymentTransactionInfoPlugin` 接口提供合成状态，调用两个真实转换方法。

- 上游参照：五个枚举值及 null，共 12 个方法／输入组合均符合声明映射。
- 注入回归：非空输入映射保持；null 在两个方法中均实际抛出 `java.lang.NullPointerException`。
- 作者等价实现：同样 12 个组合均符合声明映射。

原始观察、编译/执行 stderr、退出状态、源码与工具摘要存于隔离 runtime。首次尝试使用系统 Java
启动器时，受限进程无法定位 JDK，被记录为测量无效；改用显式 JDK 路径后运行成功，没有将其算成
候选业务失败。

这轮初始探测报告固定为 `feasibility_only / not_qualified`，没有运行 Agent，
没有对独立留出样本判分。后续真实 Agent 运行见下节单独记录，不改写这些探测的身份。

## 重复这项探测

当前 profile 只支持具有 `sandbox-exec` 的 macOS、仓库 Node/tsx 依赖和 JDK 21。
它不是整个 Maven 项目构建，也不修改本机 Maven、Docker 或全局设置。

先在 `/Users/slipshod/AIBuild/dsh-eval-lab-runtime` 下创建独立目录，将以下固定公开依赖下载到其中。
二进制只放 runtime，不提交源码树。脚本会逐一验证 SHA-256 后才使用：

| Maven Central 路径 | SHA-256 |
| --- | --- |
| `org/kill-bill/billing/killbill-api/0.54.0/killbill-api-0.54.0.jar` | `43cdfce3782742e111aaebf7e3c411c3dff1ded09892e44e319c1b1d905f89de` |
| `org/kill-bill/commons/killbill-automaton/0.26.15/killbill-automaton-0.26.15.jar` | `de21cb70fca2a855a599770a67abae37e57951d6a7fe39545d5ef56939ca62cc` |
| `joda-time/joda-time/2.12.5/joda-time-2.12.5.jar` | `10628411ecb40c4634196c544f34681abdeef826f377096357433d1f9a135bc6` |

下载基址为 `https://repo.maven.apache.org/maven2/`。版本来自当前固定的 parent 依赖配置。
在仓库根运行（将两个占位参数替换为实际绝对路径）：

```sh
node --import tsx scripts/probe-killbill-status-component.mjs <prepared-runtime-directory> <jdk-home>
```

输出为三个对象的实际观察摘要和一个不可覆盖的 JSON 报告路径。报告包含原始过程结果及期望值，
两者分别存储；期望值来自源代码/修复依据，不会被渲染成已观察事实。

## 固定任务后，接收新的代码

入口是 [killbill-coding-task.mjs](../../../../scripts/killbill-coding-task.mjs)，仅用于内部本地开发，
未改变 `@domaineval/weave` 公开 exports 或原 Capsule Schema。旧 probe 与新提交路径共享同一个
Java profile，复用现有严格进程隔离、canonical JSON 和不可覆盖写入。

```text
prepare → workspace（任务、缺陷源码、开发依赖）
       └→ control（固定任务、私有依赖、观察器、准备证据）
workspace 改代码 → submit → 独立源码快照 → evaluate → 不可变 Run → replay
```

从仓库根运行，参数需换成实际绝对路径；依赖及准备方式见上一节：

```sh
node --import tsx scripts/killbill-coding-task.mjs prepare <runtime-parent> <dependency-dir> <jdk-home>
node --import tsx scripts/killbill-coding-task.mjs workspace-exec <task-root> '<development-command>'
node --import tsx scripts/killbill-coding-task.mjs submit <task-root>
node --import tsx scripts/killbill-coding-task.mjs evaluate <task-root> <submission-digest>
node --import tsx scripts/killbill-coding-task.mjs replay <run-json-path>
```

- `prepare` 固定任务说明、缺陷基座、保护文件摘要、JDK 关键文件/modules/JVM 指纹、宿主 profile、
  观察器、期望映射及实现摘要；在接纳未知代码前，验证基座可编译且缺陷可观察。
- `workspace-exec` 用 macOS sandbox 执行开发命令：工作区可读写，控制目录不能读写，网络被拒绝。
  它不是 LLM 启动器，不提供模型认证或网络通道。保护文件的不可更改要求在提交时检查。
- `submit` 拒绝保护文件漂移、未知文件、链接及不稳定读入，只冻结允许的源码。提交新代码不改变
  任务摘要。`build/` 不被接纳或执行，验收器创建自己的构建输出。
- `evaluate` 核对实现、JDK、依赖未漂移，在独立目录编译冻结快照，不读取仍在编辑的工作区。
  编译失败与缺失执行观测分别报告，不把格式错误包装成方法返回成功。
- `replay` 只读 Run 保存的任务、候选、过程记录与原结果，验证摘要关联；不运行 Agent、Java 或
  当前判定器。改动执行/评分实现后，必须重新准备新摘要任务，不能静默更换旧题的尺子。

驱动在调用方法前生成本次私有随机标记，输出开始、各条观测和结束记录；观察器要求完整、一致的
记录。候选只打印预期文本后退出不能得到通过。这不是针对任意 JVM 攻击的完整安全资格证明。

结果保留 `task_digest`、`candidate_digest`、实际编译/执行回执和逐项结果。提交来源始终标为
`unattested_code_submission`，结论为 `component_code_artifact_only`，并保留
`agent_execution: not_observed`、`qualification: not_qualified`。

**权限边界：**只给拥有全宿主权限的 Agent 一个目录，不构成隔离。外部 Harness 必须通过
`workspace-exec` 或等价权限约束提供文件/命令工具，控制面只交给可信协调者。命令包装器不证明
模型实际输入、配置、预算和生成来源；环境指纹不代表封存整个 OS，内容摘要也不是发布者签名。

定向验证仅覆盖本次接缝，可执行：

```sh
KILLBILL_DEPS_DIR=<dependency-dir> KILLBILL_JDK_HOME=<jdk-home> node --import tsx --test scripts/tests/killbill-coding-task.test.mjs
```

## 独立 DSH Harness 接入（内部实验入口）

[dsh-coding-run.mjs](../../../../scripts/dsh-coding-run.mjs) 接入本机已经安装的 DSH
`0.1.0-rc.6` 与 Codex connector。使用官方 boot、AgentLoop 和 headless driver，
没有重写模型循环，也不调用会调整共享模块链接的 DSH CLI profile 启动路径。
配置与会话单独存于本次任务的私有 `control/dsh-run.*`；模型只能看到公开工作区。

```sh
node --import tsx scripts/dsh-coding-run.mjs prepare <runtime-parent> <dependency-dir> <jdk-home>
node --import tsx scripts/dsh-coding-run.mjs preflight <launch-json-path>
node --import tsx scripts/dsh-coding-run.mjs live <launch-json-path>
```

- `prepare` 冻结任务、提示词、DSH/connector 依赖指纹、接入代码摘要、模型与预算；
  每次创建新工作区。当前实验固定 `openai-codex / gpt-5.6-sol / xhigh`，最多 5 分钟、
  12 次模型请求、32 次工具调用、每次模型请求最多 8192 输出 tokens。
- `preflight` 启动真实 DSH，但不加载模型 provider、不发模型请求。检查实际工具集恰为
  `workspace_read / workspace_write / workspace_exec`，公开文件可读、私有控制目录不能读写、
  原生 bash 不存在。`live` 必须绑定该检查的同一 launch 摘要。
- 文件/命令工具复用已有沙箱；读写工具限制公开文本与唯一可提交源码，命令工具用于工作区开发。
  Agent 可以自主编译、修改源码；它拿不到私有验收结果，不负责提交、评分或生成结果 JSON。
- 模型认证只由已有专用 DSH home 的 provider SDK 正常处理。协调器仅检查认证文件的类型、
  链接数及权限元数据，不读取、复制或散列凭据。不会装载旧 profile、改写共享模块链接或恢复旧会话。
- `live` 每个 launch 只允许调用一次。结束后可信协调器核验实际任务输入、模型配置、工具集与
  新根 Session，再冻结源码并执行组件验收。超时或运行错误保留过程记录，不自动更换模型重试。
- 成功录制后，`coding-episode.json` 关联 launch、实际 Session 原文及摘要、受限工具事件、
  进程记录、源码提交与 Code Run。原 Code Run 的 `unattested_code_submission / not_observed`
  不被改写；新回执仅增加 `observed_in_trusted_local_dsh_run` 的本地协调者来源证明。

接入运行的可追溯性不等于判定器独立资格，也不等于未见任务：这道公开历史问题仍有
预训练暴露风险。没有发布公共 Harness adapter API。

## 首次真实运行：代码通过，接入收尾超时

2026-09-07 使用接入提交 `6bc937d` 发起一次新 DSH Session，实际记录如下：

| 层次 | 观察结果 |
| --- | --- |
| 模型执行 | `gpt-5.6-sol / xhigh`，5 次模型请求、6 次工具调用，单轮任务 45.860 秒，`turn/end: completed` |
| 实际交付 | Agent 通过工具写入 Java 源码；空状态归一为 `UNDEFINED`，两个方法分别返回 `UNKNOWN` / `EXCEPTION` |
| 开发过程 | 第一次编译依赖未设置的 `JAVA_HOME` 而失败；Agent 随后使用公开环境文件中的绝对 JDK 路径编译成功 |
| 进程收尾 | headless 已写出完成回执，但 worker 未退出；协调器在 300.029 秒时 SIGTERM，原始 `timedOut: true` 保留 |
| 恢复验收 | 不重新调用模型；核对实际任务、配置、Session、工具事件链，最终源码与模型写入内容逐字一致，再冻结并验收 |
| 组件结果 | 实际编译及方法调用有效，12 个方法／输入组合全部符合要求；artifact-only replay 一致 |
| 结论边界 | `not_qualified`；一次公开组件题的代码与执行证据，不是通用编码能力、未见泛化或完整支付系统验收 |

原回执不能因后续恢复而改为成功退出：这次是
`agent_completed_process_shutdown_timed_out`，不是完整无人工介入的成功 episode。
恢复是在控制侧独立执行的；Agent 没有获得私有评分结果，也没有重新生成候选。

证据都在隔离 runtime：

- 运行根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/killbill-coding.oqdjPl/control/dsh-run.Nfvjv8`
- 原 launch：`05e2a3b3f625752cd263bbb326b942ce75fd954947989da3b3e2b95f2da2d61a`
- Session：`session-d7781323-0444-4a60-81a0-b0f388297465`
- 恢复回执：运行根内 `coding-episode-recovered.json`，摘要
  `904b04b647d61fb3b3f72bdfc9d58f9b6819be694727b1eb3bac193287530775`
- 源码提交：`07beb60b81da327853887d5340418be530cc87eb0f71c72262ebcc0815be6b0c`
- Code Run：任务的 `control/runs/d1261dc6d859a334468961df937a860d7d02cfa1069d8b4dcd56655bd2044263.json`

恢复回执保留原始 launch、进程超时、Session 原文、工具事件、精确源码、验收引用及恢复脚本本身。
`recover-completed-run.mjs` 是仅针对该次记录的诊断产物，运行前核验了当时 `6bc937d` 的实现与依赖；
不是新的公共恢复接口。代码修订后不能绕过旧 launch 的漂移检查重新运行它。

根因在接入层：官方 headless 的 `appExit` 是退出请求，不保证 Node 事件循环随之结束；新 worker
只等待 disposal，没有完整承接有界退出职责。旧 carrier 里已有相同 rc.6 收尾风险的处理。
原记录未采集具体残留句柄，所以不进一步断言是哪一个 provider 连接或 disposer。
现在 worker 会先 flush 证据与输出，再有界 disposal，写独立 `*-shutdown.json` 并显式退出。
flush/disposal 失败或超时不会渲染成进程成功，正常回执也必须核验 shutdown 记录。

本次只增加并执行 3 个对应故障的无模型回归检查（残留句柄、disposal 超时、flush 失败），
以及 1 个真实 DSH 无模型接合检查；未跑全量测试、未额外调用模型。
这组无模型检查没有被当成修订后的实测成功；另一次获准的真实运行记录见下节。

## 修订后的真实运行：自动闭环通过

operator 在 2026-09-07 明确授权后，以提交 `ebed4b0`、相同任务摘要、新工作区和新根 Session
执行一次验证。未恢复旧 Session，未将上一次的源码或私有验收结果注入本次输入。
本次命令自行产出了 `coding-episode.json`，没有人工恢复、追加模型运行或修改验收规则。

| 层次 | 观察结果 |
| --- | --- |
| 托管命令 | 约 87 秒，退出码 0；包括加载核验、worker 和组件验收 |
| Agent 任务 | `gpt-5.6-sol / xhigh`，7 次模型请求、7 次工具调用，单轮任务 76.064 秒，`turn/end: completed` |
| worker 收尾 | 79.889 秒退出，`exitCode: 0 / signal: null / timedOut: false`；独立 shutdown 回执为 `disposed / exitCode: 0` |
| 代码来源 | 实际输入、模型配置和三工具集已核对；Session 与桥接工具事件相符，冻结源码与模型最后一次完整写入逐字一致 |
| 代码验收 | 编译及真实方法观察有效，12 项映射全部符合要求，`valid / pass`；artifact-only replay 一致 |
| 证据层次 | 外层 episode 为 `observed_in_trusted_local_dsh_run`；内部 Code Run 仍只判代码，不改写它的 `agent_execution: not_observed` |

过程并非每个工具命令都成功：首先直接调用系统 `javac` 返回 1（沙箱中未定位 JDK），随后使用
公开环境说明中的绝对 JDK 路径编译成功；另一次 `git diff` 返回 129，因为这是组件工作区而非
Git checkout。两条原始错误都保留在 Session 与工具记录中，没有被抹掉或误作代码最终失败。

第二次运行与第一次产生相同源码摘要，但这是同题、同模型下两次运行的事实，不能解读成
任务覆盖扩大、未见泛化或独立资格。首次超时的原始记录及其恢复身份仍然保留。

本次证据锚：

- 运行根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/killbill-coding.Tyz5p5/control/dsh-run.ujWFoM`
- launch：`b28ce88d95792db690979e1049bbf3eb397683daf60f916b0d73f8d529f78b0a`
- Session：`session-72f23baa-cee5-4f5f-b0c8-ef04d6afd2a5`
- 自动回执：运行根内 `coding-episode.json`，摘要
  `22282183932b5a4c09bcf268755bbfc03e92d056e97497e20102d3e03912008f`
- 源码提交：`07beb60b81da327853887d5340418be530cc87eb0f71c72262ebcc0815be6b0c`
- Code Run：任务的 `control/runs/f3ce7383210392f9a7d6178dff9539e4781edbe0bab33de4e1a83004803deec1.json`

该次 DSH 回执核对仅使用已有证据的摘要关联、原始 Session、模型工具写入及结果回放，
没有为核对额外调用模型或运行测试套件。后续 Codex 运行单独记录如下；当前仍为
`not_qualified`，不据此发布能力排名。

## 第二个 Harness：Codex CLI 实际消费通过

2026-09-07，独立授权的 Codex CLI 0.153.4 使用提交 `e473a69` 的协调器、新工作区和新会话，
实际完成了同一 Java 任务。前两次模型调用前拒绝已在 [CONSUMER.md](CONSUMER.md) 单列；
本次才是首次真实 Codex 编码，并自动产出 episode 与 Code Run，没有人工恢复或改动候选。

- 原生进程 129.391 秒正常退出，无超时或输出截断；托管完整命令约 130 秒。
- Agent 单轮 125.662 秒；记录 9 条模型响应计量记录、8 条顶层工具调用，固定 `gpt-5.6-sol / xhigh`。
- 新 Session、实际输入、模型、原生文件/网络权限、工具调用与结果关联已核对。
- 控制侧在进程停止后冻结源码，实际编译并调用两个方法，12 个方法／输入组合全部符合要求；
  `valid / pass`，artifact-only replay 一致。

Codex 使用 `if (pluginStatus == null)` 直接返回各自的默认结果；DSH 的提交使用空状态归一化。
控制侧已逐项核对两份 Code Run 的固定 task 对象完全一致，其中包括观察器、判定规则与实现
指纹，而源码不同。因此这项证据支持的是**同题同尺、不同 Harness、不同实现的真实消费**，
不是与作者补丁逐字匹配。

过程中的非成功信息仍保留：一条开发中的功能开关警告，以及辅助 `git status` 命令在受限
环境里的 xcrun 错误。读取源码/环境和后续 Java 开发继续完成；没有将该辅助命令错误当成最终
业务失败，也没有为此更改宿主开发工具安装。

证据根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/killbill-coding.0tfk4O/control/codex-run.pecPAI`

- launch：`92635e462dbacae9598bfbf09f5d7ad0294fa660074e96f02174c536d4a015f7`
- Session：`01a07b34-f400-7e40-8425-7c90c472068d`
- `coding-episode.json`：`d6553b57f4203f596d35877cd959996cff1f32e54830c9975fe9aa7bd109f5c3`
- 源码提交：`7bd2df2fb134d049becc64804ee5e8de02c1e9da1c0e4f9790185dabd8425a39`
- Code Run：任务 `control/runs/038a97a4fe78f380d7d0c1535e430e747243795455e93c68bd5005970a539954.json`

外层是 `observed_in_trusted_local_codex_run`；内层 Code Run 的 `agent_execution: not_observed`
仍表示代码判定层不自行证明作者身份。两层不能压成一个标志。两套 Harness 的工具与预算并未
归一化，不能用这些耗时或调用数比较能力/成本；公开单题也不能证明未见泛化。所有结果仍为
`not_qualified`。本次结束核对没有新增模型调用或测试套件。

## 仍未完成的交付

下一项业务型任务的[设计卡](../killbill-janitor-recovery/TASK-DESIGN.md)基于真实 Issue #809 /
PR #810，已获 operator 初步审计通过。[限定可行性验证](../killbill-janitor-recovery/FEASIBILITY.md)
已执行真实恢复类、原有 helper 与受控端口，区分旧快照覆盖和永不恢复；新的[本地交付合同](../killbill-janitor-recovery/CONTRACT.md)
与公开工作区已冻结准备，剔除依赖中的目标类原始字节码，并复核参照/缺陷基座。新题的
[首次真实 Agent 修复](../killbill-janitor-recovery/RESULT.md)已完成：恢复锁内重读路径，五个
场景通过，原始证据回放一致。不改变本题的冻结内容，也不把单次任务成功升级为资格。
Janitor 另有[本地消费说明](../killbill-janitor-recovery/CONSUMER.md)与[搬移演练](../killbill-janitor-recovery/CONSUMPTION-RESULT.md)：
同宿主的新目录已可不依赖原仓库运行；[新会话 Agent 的实际反馈](../killbill-janitor-recovery/CONSUMER-FEEDBACK.md)
确认命令链完成，同时指出外部摘要漏发。作者仍提供接入适配器，真人可用性尚未验证。

1. 未经作者现场指导的消费及跨宿主验证：两套 Harness 已跑通，但仍依赖本项目协调器和专用本机路径。
2. 任务级独立校准；作者参照/回归/等价对象和同题重复运行不能代替资格证据。
3. 公共 Coding 消费合同与 SDK/CLI 正式演进；先验证消费约定，当前脚本及 legacy runner 不是已发布通用接口。
4. 更具代表性的真实仓库变更、完整项目构建与跨任务复用；此单类任务不能代表一般 coding 能力。

在这些环节闭合前，本候选不进入正式 Coding 能力比较，也不升级公共 API 或领域 Claim 状态。
