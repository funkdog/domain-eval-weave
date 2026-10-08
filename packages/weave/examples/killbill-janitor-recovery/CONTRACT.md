---
feature_ids: []
topics: [coding, payments, task-contract, observation, harness]
doc_kind: local-task-contract
created: 2026-09-09
version: 0.1.0-local.1
status: single-local-agent-episode-observed
qualification: not_qualified
---

# Janitor Coding 本地交付合同

本合同将[已验证的业务切面](FEASIBILITY.md)固定为一项 Java 源码任务。冻结是把本轮输入与
判据绑定到不可变摘要，不是宣布产品正式发布或判定器获得独立资格。
机器定义在 [task-contract.json](task-contract.json)，给 Agent 的题面在 [TASK.md](TASK.md)。

## 交付的两侧

```text
workspace/                    control/（不交给 Agent）
  TASK.md                       task.json：冻结题目、源码、依赖与判据
  src/目标类.java               oracle/JanitorProbe.java
  ENVIRONMENT.json              dependencies/：可信依赖副本
  DEPENDENCIES.json              development-evidence.json
  LICENSE                       preparation/：参照与缺陷基座的执行证据
  lib/                          preparation.json：准备结果，不是 Agent 成绩
  build/（开发输出）
```

公开侧只允许最终提交 `src/IncompletePaymentTransactionTask.java`。其他公开输入受保护，
`build/` 不进入验收，验收须重新编译。题面要求修改业务代码，不要求模型生成评分 JSON。
两侧目录分开不自动构成访问控制；Harness 接入前仍须验证实际读写权限，不能只靠提示词保密。

`task.json` 的 digest 绑定题面、基座源码、观察驱动、分项期望、依赖字节、JDK 指纹和准备器
实现摘要。JDK 路径及宿主指纹是这个本地实例的组成部分，不宣称跨宿主 task digest 稳定。
旧 null-status 任务、其任务摘要和成功会话均不变，不让原来的硬编码 profile 接受新题。

## 依赖中也不能夹带参考答案

开发依赖锁包含 24 个工件，其中一个是源码 JAR。准备时不公开源码 JAR，只提供 23 个二进制
依赖；并从 `killbill-payment-0.24.21.jar` 的新副本中移除目标类及其 3 个内部类。
原下载物、源码包和历史证据不改变。

准备器核对待移除项恰好符合固定清单，拒绝有签名的归档；处理后检查保留条目集合、顺序和
解压内容不变，并扫描所有交付 JAR，确认没有目标类或本项目观察器。保留实际状态/DAO helper，
记录原始/派生 JAR 摘要、移除清单和工具指纹。编译与准备期执行统一使用派生依赖。

这消除了直接读取目标类原始字节码的捷径，不等于证明模型从未见过公开历史修复。题目仍是
公开历史导出的开发任务，不能作为未见题或一般能力排名的依据。

## 验收看什么

度量单位为一次给定恢复机会的代码执行：输入状态与 Plugin 结果 → 在受控账户锁下执行 →
内存 DAO 的实际更新字段与最终状态。保留五个场景向量，不生成综合 Coding 分数。

| 场景 | 约束或进展目标 |
| --- | --- |
| 旧请求遇到已完成扣款 | Payment 当前/最近成功状态保持 CAPTURE_SUCCESS，不再写旧授权结果 |
| 正常未决授权恢复 | 同一 AUTH 变为 SUCCESS，Payment 为 AUTH_SUCCESS，金额/币种保留 |
| 明确 UNDEFINED | 保留 UNKNOWN，不虚构终态 |
| PENDING 未变化 | 保留 PENDING，不虚构终态 |
| 账户锁失败 | 不更新状态 |

观察前置包括完整的五种场景、源代码实际被加载、原有 helper 被加载、初始快照未被别名修改、
交易身份匹配、锁获取/释放成对、主场景交错确实发生。业务结果比较覆盖 Payment 当前状态、
最近成功状态、AUTH 状态、处理金额/币种、更新次数和返回的 changed；金额不因小数尾零不同被拒。
读次数只做诊断，不强迫某一种等价实现。`transaction_count` 是夹具设置，**不作为数据库完整性
的硬判据**。无完整观察、进程失败或环境失败先标无效，不凭缺失记录推断业务正确或错误。

题面中的禁止新增交易/支付操作是任务约束。当前严格 DAO 端口会拒绝非预期操作，但并未穷尽
任意 Java 代码可能访问的副作用通道，不能据此声称所有恶意行为均可归因和定罪。
冻结的同 JVM 观察器不是抗恶意反射/篡改的安全边界；这种观测完整性仍是正式资格前的缺口。

## 资格、角色与变更

- 可验证 claim 是限定入口是否满足上述代码规约；新鲜证据来自 Java 执行与 DAO 端口，
  工程维护成本由项目开发承担。是否值得复用、是否体现真实任务价值由 operator/消费者判断。
- observer 是实际 Java 观察驱动与准备期分析；domain owner 是固定实现行为的维护者来源，
  本题选择与交付边界由 operator 确认；consumer 是 operator 和后续 Harness 使用者。
- 作者设计题面、准备器和观察器，角色有重叠；当前没有独立 calibrator，不把作者反例当成
  独立资格证据。领域 CL-07、CL-12 仅作为 grounded 来源，不晋升为 confirmed。
- 原开发四版本是开放开发证据。派生依赖只复核参照与缺陷基座，不能冒充新的独立 holdout。
- 当前为单次限定任务，无持续排名、自动优化或纵向指标循环；不配置无消费者的定时评测。
- 若出现合法等价实现被误拒、坏代码过关、缺失观察被当成业务失败、依赖/源码/观测入口改变，
  应重开合同、生成新版本和摘要，保留旧证据；不原地改旧 Run 或为了分数再试模型。

已知限制保持不变：真实恢复类与 helper、内存 DAO、显式锁调度、直接给定 Plugin 结果。
不测真实 Capture、SQL、定时查询、多节点锁、Provider、真实资金或完整项目构建。
不承诺保护本地宿主上的任意同权限进程；所有未知 Candidate 须经独立实际权限预检后才可执行。

## 准备入口与下一道边界

在仓库根使用已有依赖与已保存的开发分析，不联网、不启动模型：

```sh
node --import tsx scripts/prepare-janitor-task.mjs <依赖目录> <开发assessment.json> <JDK目录>
```

准备器创建新的 runtime 目录，冻结 `control/task.json`，验证派生依赖下参照应通过、缺陷基座
应仅在主场景失败，最后写 `control/preparation.json`。准备检查失败也保留原始数据。
`prepared: true` 仅表示这一步成功；`agent_ready: false` 明确阻止将准备当成真实运行放行。

准备检查点之后须接通本题源码提交与 Code Run，并完成实际 Harness 权限预检。下节记录后续
完成情况；旧准备回执的 pending 字段保持原样，不原地改写历史。仍为 `not_qualified`，
不新增公共 API、新 Harness 或高成本依赖。

## 本轮冻结与验证回执

operator 在消息 `0001788924490812-000381-d3138ce9`（2026-09-09 03:28 UTC，“OK推进”）
确认推进上一轮所述任务冻结步骤。本轮没有请求或运行模型。

- 实例根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-task.dNxL3b`
- 冻结任务 digest：`6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8`
- 准备回执 digest：`903fcae78cb3f1beded29cf28d31a9e788996136cfa9b288ff532c2a0df986d1`
- 派生支付 JAR SHA-256：`0ce2141dcbb7f3b997cb72a024f62694957c85105ae7b10125dd2ba11ebfda71`

公开侧共 28 个文件，集合及字节摘要与冻结任务一致，无软链接或硬链接。支付 JAR 移除 4 项，
保留 261 项，其余解压内容一致；23 个交付 JAR 均未发现目标类或本项目观察器条目。
这次没有改变原始发布 JAR，只生成新的派生副本；原件和旧报告可完整恢复/追溯。

派生依赖下只运行参照和缺陷基座，各有 5 份完整观察。两者编译和执行退出码均为 0，参照五项
均符合规约；基座只在 `concurrent_capture` 出现 Payment 当前/最近成功状态被写回 AUTH_SUCCESS、
产生一次不该发生的更新、changed 为 true。SLF4J 无 provider 的警告仍保留在原 stderr。
其余两种作者开发版本没有重复运行，原证据由 development assessment digest 绑定。

状态为 `prepared: true / agent_ready: false / not_qualified`。这个回执证明准备器及新依赖布局
成立，不证明任意 Candidate 的安全隔离、独立判定资格、源码提交或 Harness 接入已完成。

## 后续：源码提交、执行与回放已接通

operator 消息 `0001788932174408-000407-121d97d4`（2026-09-09 05:36 UTC）授权沿既定动线
持续推进。新增的本地入口如下，均非公共包 API：

```sh
node --import tsx scripts/janitor-coding-task.mjs materialize <冻结任务模板>
node --import tsx scripts/janitor-coding-task.mjs submit <新任务实例>
node --import tsx scripts/janitor-coding-task.mjs evaluate <新任务实例> <源码提交digest>
node --import tsx scripts/janitor-coding-task.mjs replay <Code-Run.json>
```

materialize 验证准备证据并重建同一任务的全新公开工作区，不重复运行准备期 Java。
submit 检查受保护输入及允许文件集合，拒绝软链接/硬链接与不稳定读取，保存唯一源码快照。
evaluate 只读该快照与可信依赖，在独立执行目录重编译，不使用 Agent 的 build 产物或后续源码。
Code Run 内嵌冻结任务、源码、判读器版本/源码摘要、原始进程结果和分项判定。
replay 不调用 Java/模型、不读取原工作区或 JDK；使用匹配的判读器版本从原输出重算结果，
不是直接相信存下来的 verdict。判读器代码版本不同会拒绝回放，要求使用记录对应的实现。

业务向量保持原合同；编译或执行失败、缺失/重复/坏格式观察先为 measurement invalid，
不由缺失记录推测行为。内层始终是 code-artifact-only 的来源语义：`agent_execution: not_observed`，
Agent 身份和真实运行关联由外层原生 Session 证据单独承担。同 JVM 反篡改缺口依旧，不晋升资格。

四项定向检查先红后绿，没有运行全量测试；其中实际执行基座和作者等价源码各一次，证明新提交
入口会读正确快照。证据根 `janitor-coding.AOIbNL`（均在项目 runtime 下）：

- 基座 fail Code Run：`63fdd7e3c8958db509c060e9954ec6308b6bf2a2cf71c3d93ac29b2bfb565921`
- 等价 pass Code Run：`c89e45e5bbf69916006b0430e9183345bd426bfdd404b56d0517c2694185c00b`
- 提交后写坏工作区，已提交源码的验收仍通过；修改保存 verdict 并重算外壳 digest，回放拒绝。
- 实际 workspace-exec 在 `janitor-coding.klyh50` 验证公开读写、私有/别名/仓库读写拒绝和
  网络 EPERM；没有读取凭据或真实业务数据。负例及其工作区保留，不自动清理。

## 后续：已有 Codex 原生入口已绑定本题

复用已有原生 CLI、argv 构造器和 Session 验证逻辑，仅增加明确的 `janitor` 本地任务分支。
旧 status 任务分支及历史任务/Run 不修改；旧启动清单遇到协调器代码摘要变化会拒绝重跑。
按[官方非交互模式权限说明](https://learn.chatgpt.com/docs/non-interactive-mode#permissions-and-safety)，
使用隔离配置、明确权限而非全盘访问；具体 0.153.4 能力以本机实际预检为准，不据当前文档
推定旧版本实现细节。

```sh
node --import tsx scripts/probe-codex-coding-tools.mjs --janitor-template <冻结任务模板>
node --import tsx scripts/codex-coding-run.mjs prepare-janitor <预检根> <已独立登录目录> <冻结任务模板>
```

预检采用新建、无登录的 CODEX_HOME 和 loopback 合成服务，9 次合成交换/8 次工具动作，真实
模型请求为 0。13 个门均通过，包含真实题面保留、公开工作区 Java 编译、私有 task.json/补丁/
图片访问拒绝、换 cwd 仍拒绝、提权与网络拒绝、原始 canary 不变。4 项既有原生轨迹检查也通过，
只分析该次保存的轨迹，没有重复原生调用。

- 预检根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/codex-tool-probe.K1qWVk`
- 已准备 live launch：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-coding.NzbStP/control/codex-run.Jfnrbi/launch.json`
- launch digest：`75ea873657f4374c0681f40c82e73c9b844b1837183c58f66ea57cb349915621`
- task digest 仍为 `6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8`

实际编码沿用 `gpt-5.6-sol / xhigh`、原生既有权限与独立登录，单次 300 秒、输出 1 MiB 上限。
登录文件只检查元数据，不打开、复制或散列内容。此处记录的是当时的 launch 准备检查点；
随后的唯一真实结果见下一节，不把预检或作者等价源码结果冒充 Agent 成绩。

## 首次真实运行已完成并核对

实现版本 `4c58200` 的本次原生进程 110.389 秒正常退出，无超时/截断；新 Session
`01a084bb-548c-7e31-9971-8485cc34bc7c` 有 8 条模型响应记账和 7 次顶层工具调用。
Agent 删除锁前旧快照读取，恢复锁内重读与资格检查，最终源码与固定上游参照字节一致。
27 个公开受保护输入不变；可信执行的五个场景全部 valid/pass，原始输出重算回放一致。

- episode：`122cc757854152c0cfa38369d0ad670936016afc30e29aba585ad97d3f787c23`
- 源码提交：`c7c65c8afadae9587e0e2431410923b59412d3c0d0ac3ec8162b64342c2e09d6`
- Code Run：`aa5ecad0ac130c46ce002bb44884f96de16da242eda3caf24f8c567c0ab5c256`

核对包括实际原生 Session 原文、题面/模型/权限/工具结果、源码字节、Run 引用以及与开发
Run 的 task/grader/执行实现完全一致。辅助 Git/xcrun 错误和 SLF4J 警告保留，没有修改宿主。
本次回收只做证据读取、artifact replay 和文档增量校验，没有新增模型或 Java 运行。
详见[人读结果与证据索引](RESULT.md)。这是单次本地任务成功，不是独立资格或一般能力，
仍为 `not_qualified`。下一项产品缺口是无作者指导的消费可用性，而不是继续重复这道题。

## 本地消费包与作者搬移演练

后续已形成[消费说明](CONSUMER.md)与可复制的本地包，包含固定源码闭包、任务种子和23份
派生二进制依赖，不含登录、会话或参考修复源码。包内入口使用 Node 24，无需原仓库或 npm 安装。
目录绑定只对包自己的 state 子树生效，原仓库入口默认边界不变；任务与判读器没有换版。

新目录中的检查/准备/提交/验收/回放已走通，原目录访问被拒，基座仍正确失败，静态文件漂移
也会拒绝。该[搬移证据](CONSUMPTION-RESULT.md)只支持同宿主的工程自包含，不是独立消费者
可用性验收或跨机支持。Node 控制端文件权限与候选 OS 沙箱分别记账，不能把允许创建子进程的
Node 权限模式当作抗恶意控制端保证。后来新增的[新会话 Agent 消费](CONSUMER-FEEDBACK.md)
已观察到命令链完成和外部摘要漏发；适配器仍由作者提供，真人未观察，仍为 `not_qualified`。
