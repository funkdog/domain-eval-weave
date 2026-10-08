---
feature_ids: []
topics: [coding, payments, recovery, concurrency, feasibility, evaluation]
doc_kind: feasibility-report
created: 2026-09-09
status: bounded-feasibility-observed
task_candidate_id: killbill-janitor-stale-state-recovery
agent_execution: not_observed
qualification: not_qualified
---

# Janitor 恢复任务：执行可行性报告

结论：**这道题能通过执行真实恢复代码，区分“保护业务进度”“旧快照覆盖”和“永不恢复”。**
这解决了[设计卡](TASK-DESIGN.md)中的执行可行性问题；尚不是完成的 Agent 任务或合格能力评测。
operator 于 2026-09-09 02:32 UTC 初步审计通过后，本轮只做了限定的开发验证，没有调用模型。

## 1. 实际发生了什么

我们执行固定 Kill Bill 0.24.21 的 Java 恢复代码，在它等待账户锁时，受控夹具把整笔支付推进到
“扣款成功”。随后让恢复继续，观察它是否把 Payment 错误写回“授权成功”。另一个场景保留真正
未决的授权，确认恢复仍能把它推进到成功，避免“什么都不做”假通过。

| 执行的代码版本 | 已完成扣款后继续旧恢复请求 | 确实需要恢复的授权 | 判读 |
| --- | --- | --- | --- |
| 固定上游参照 | Payment 保持 `CAPTURE_SUCCESS`，不再覆盖写入 | 推进至 `AUTH_SUCCESS`，更新已有交易 | 安全和进展均满足 |
| 人工注入旧快照回归 | Payment 被写回 `AUTH_SUCCESS` | 仍能正常推进 | 发现业务进度回退 |
| 人工注入永不恢复 | 保住 `CAPTURE_SUCCESS` | 卡在 `AUTH_ERRORED` / `UNKNOWN`，没有更新 | 发现进展缺失 |
| 作者等价写法 | 与参照一致 | 与参照一致 | 本次改写未被误拒 |

最重要的观察是：**参照和旧快照坏版本的 AUTH 交易最后都是 `SUCCESS`。** 如果只核对这条交易，
就会漏掉整笔 Payment 已从扣款阶段退回授权阶段。领域模型在这里帮助选对了验收对象。
这不是“领域包提升了 Agent 能力”的对照实验，也不能据此给一般 Coding 能力打分。

四个版本各执行五种场景，共取得 20 份完整观察：旧恢复遇到已完成扣款、正常恢复、明确的
`UNDEFINED`、`PENDING` 保持未决、账户锁获取失败。参照与等价版本五项均满足开发判据；
旧快照版本仅主场景失败，永不恢复版本仅正常恢复失败。这里的“失败”是预期被识别的代码错误，
不是测量环境失效；观察不完整或进程失败会先拒绝形成这份可行性结论。

## 2. 哪些是真的，哪些是受控边界

| 部分 | 本次执行方式 | 能证明的范围 |
| --- | --- | --- |
| `IncompletePaymentTransactionTask` | 从固定源码实际编译四个版本；核对加载位置，防止 JAR 中原类遮蔽候选 | 此版本 on-the-fly 入口的恢复行为 |
| 状态与 DAO helper | 实际 `PaymentStateMachineHelper`、`PaymentAutomatonDAOHelper`，没有重写恢复算法 | 原有状态计算与传给 DAO 的更新字段 |
| DAO 存储 | 严格受控的内存端口，每次读取返回独立 AUTH 快照；按真实 helper 提供的字段更新 | Payment 当前/最近成功状态、已有 AUTH 状态、金额币种、更新次数和身份 |
| 账户锁 | 校验账户 key，获取锁前显式推进夹具，记录读写/获取/释放顺序 | 固定交错中的旧快照风险，不证明真实多线程或分布式锁 |
| Plugin 结果 | 合成的实际结果对象直接传入 on-the-fly 入口 | 此次已给定结果的处理，不覆盖定时查询或真实 Provider |

主场景中 Capture 完成及“已有两笔交易”的数量是夹具设置，**不是执行 Capture 业务代码得到的**。
存储端口只物化已有 AUTH 快照，没有完整 SQL 交易表。不得把数量字段读数当作数据库完整性、
完整扣款流程或资金 exactly-once 的证明。未识别的 DAO 操作、错误对象写入和锁外写入直接拒绝。

五种场景中，`UNDEFINED` 是明确传入的插件枚举，不代表所有缺失结果/查询异常均已覆盖。
本次没有执行 `getPaymentInfo`，没有真实数据库、网络支付、定时恢复队列或 invoice/payment-control。
受控账户数据、配置和上下文只满足这个入口所需字段，不宣称整个 Kill Bill 系统已经启动。

调度不依赖 sleep 或碰运气。坏版本的关键顺序是“锁前读 UNKNOWN → 夹具推进 CAPTURE_SUCCESS
→ 取得锁 → 旧授权写回 AUTH_SUCCESS”；参照则“取得锁 → 重新读 SUCCESS → 跳过旧恢复写入”。
记录保留了 detached 初始快照、锁释放和真实进程输出，不能由一句“执行成功”代替。

## 3. 依赖、失败与证据保留

从 Maven Central 固定取得 24 份发布工件，共 8,025,641 字节；包括源码 JAR，实际运行 classpath
只使用二进制 JAR。坐标、URL、仓库 SHA-1 和本地 SHA-256 在[依赖锁](dependency-lock.json)中。
目标类使用领域包固定源码；真实 helper 使用对应版本发布 JAR。不宣称已逐字核验发布源码 JAR。
Mockito 使用 subclass 模式，没有安装 JVM attach agent。没有启动 Maven、Docker 或外部服务。

初次参照编译通过，但执行遇到缺失 `PersistentBus`，归为环境无效。补齐同一 commons 版本的
`killbill-queue` 后才执行完整四版本观察，未修改业务判据来绕过错误。原失败报告保留在
`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-feasibility.bHEwxx/report.json`。
成功执行仍有 SLF4J 无 provider、使用 NOP logger 的警告，原 stderr 保留。

最终证据位置：

- 依赖目录：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-dependencies.F8D6Uj`
- 执行目录：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-feasibility.ZxT1nF`
- 原始 `report.json` digest：`b9b45673432c9ec84ca29d67b51851ab2823270500d3ba790f835395c91c9560`
- 分析文件：`assessment-6dab3a3f08f35e94331ae0896f31c7cb805cc9e20146744fbe98cefa3403a6e4.json`
- 分析 digest：`6dab3a3f08f35e94331ae0896f31c7cb805cc9e20146744fbe98cefa3403a6e4`

分析文件内嵌四份源码、观察驱动、依赖锁、原始进程结果与分项期望。检查五个门：参照安全与进展、
旧快照反例、永不恢复反例、作者等价写法、单看交易 SUCCESS 会漏判，结果均成立。
后续分析只读取保存的执行结果，没有再次运行 Java。旧失败和较早分析快照未删除或覆盖。

## 4. 开发入口与下一步

以下为仓库内开发入口，不是已发布 CLI/SDK；依赖本项目 TypeScript 环境与现有隔离执行器。
全部输出写入项目独立 runtime，源码库不包含 JAR、编译输出或模型会话。重新执行是生成另一份
开发证据，不会自动改写本报告或晋升评测资格。

```sh
node scripts/prepare-janitor-dependencies.mjs
node --import tsx scripts/probe-janitor-recovery.mjs <依赖目录> <JDK目录>
node --import tsx scripts/assess-janitor-feasibility.mjs <执行目录>/report.json
```

第一条也接受已有依赖目录作为可选参数，校验并复用已下载字节。本次 JDK 是
`/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home`，编译目标 Java 11。
每个版本的编译/执行各限 30 秒，输出各限 256 KiB，运行 Java 堆上限 256 MiB。
第三条只校验并分析已有数据，不编译、不调用模型；运行证据与当前依赖锁/驱动不匹配时拒绝。

该可行性检查点的下一步是**冻结这一个任务的专用交付合同**：明确公开要求、候选允许改动的文件、缺陷基座、
依赖与构建、观察字段及可信验收资产；复用现有提交与 Harness 来源链，不假定旧转换器 profile
可以直接承接此任务。完成隔离与必要校验、获得新的有界运行授权后，再让 Agent 消费。

后续本地冻结与派生依赖验证已独立记录在[交付合同](CONTRACT.md)，不改写这里的原始开发结果。
按 `eval-design`，这里仅为作者可见开发例与反例，未获得独立校准/解封证据，所有产物仍是
`not_qualified`。领域 Claim 状态不变；公共 API、Agent 实作结果、无作者指导消费和一般能力判断
均未在本轮交付。
