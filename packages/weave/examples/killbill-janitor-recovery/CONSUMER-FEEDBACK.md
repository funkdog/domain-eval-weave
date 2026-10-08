---
feature_ids: []
topics: [coding, consumer, feedback, provenance, evidence]
doc_kind: consumer-trial-result
created: 2026-09-09
status: command-flow-complete-source-check-incomplete
fresh_context_agent_consumer_observed: true
independent_human_consumer_observed: false
author_supplied_adapter: true
qualification: not_qualified
---

# 首次新会话消费者反馈：命令链完成，交付摘要漏发

**新会话 Agent 在作者预先提供的受限适配器下，按包内 README 完成了命令链；但消费者侧
的来源摘要核对没有闭合。** 后一项是本次发现的实际交付缺口，不能被八个完成标志掩盖。

## 实际完成的工作

本轮由 operator 消息 `0001788946676859-000030-078dc411` 授权，固定使用 Codex 0.153.4、
gpt-5.6-sol/xhigh，一次根会话。原生进程 90.082 秒正常退出，无超时/输出截断。
记录有 8 条模型响应记账、7 次顶层工具调用：先发现可用工具，再执行下列 6 次控制端调用。

```text
read_guide → doctor → prepare → submit → evaluate → replay
```

消费者没有修复、阅读或审查 Java 源码；源码由可信控制端原样提交并执行。用户角色的输入
只有环境信息和初始试用任务，没有运行中追加的作者消息；正常原生系统说明和工具声明仍存在。
所有控制端调用均正常完成。

| 观察 | 实际结果 |
| --- | --- |
| 环境检查、创建实例、提交源码 | 完成，一个新实例，基座源码未改 |
| 未修复基座验收 | measurement valid；仅 concurrent_capture 为 fail，其余四项 pass |
| 结果含义 | 消费者正确区分“发现基座业务缺陷”和“工具失效” |
| 回放 | 消费者实际调用 replay，结果与保存的 Code Run 一致 |
| 固定包输入 | 66 个文件字节不变，包摘要不变 |
| 运行中额外作者指导 | 未观察到；原生用户消息只有初始环境与任务输入 |

## 被发现的交付缺口

消费者指出：README 要求把 doctor 返回的 kit_digest 与交付者另行提供的预期摘要核对，
但本次没有收到外部预期值，因此只能记录返回值，不能独立核对来源。

这个反馈已对原始输入核实：初始提示未包含预期摘要，read_guide 返回的也是不含具体摘要的
原 README。控制端启动清单持有并校验了固定 kit digest；这属于控制端的字节完整性检查，
**不等于消费者收到另行交付的预期值并完成对表，更不等于密码学来源认证**。

消费者认为说明没有阻碍本轮命令执行的歧义，这是它的体验意见，不据此宣布文档普遍易用。
“缺少外部摘要”则由输入证据确认，可以作为交付改进项。

按 eval-design 的范围区分，原始 `consumer_completed: true` 只表示预先冻结的八项命令/
产物观察成立。它没有覆盖外部摘要核对，不能改读为“README 的全部要求均已独立完成”。
本轮不改写该回执、不事后篡改判据或补发消息装作当时已经完成。

## 本轮已补的交付物

新增一份可与包**分开发送**的[交付回执](DELIVERY-RECEIPT.md)，给出精确包摘要、任务摘要、
用途、环境和信任边界。它不放进旧包，也不改变旧包 f653cf46… 或原始消费者会话。
后续交付应把这份回执作为显式输入；如再设计完整交付验收，摘要对表需单列观察。
这次只是补齐回执，**尚未复测消费者能否正确使用它**，没有追加第二轮模型或 Java 执行。

## 核对依据

- 实现版本：`25d690b`。
- 原始根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-trial.qS8L4y`。
- launch：`7a5e4fac43b9dded815ececff37b4948c4c0fa2e839ddb500aa686240810992b`。
- consumer-episode：`e144661db869c62715afe0098f7e43696e25f75d5932c94d982e9d3c8a28d6d8`。
- Session：`01a08590-e5e8-7e91-b1cc-746c2c4ad720`。
- broker 事件链末摘要：`2f95d7d296a4b3346ce287b40cae88a1b458d93b682df3c1e9e669ce2c23f605`。
- Code Run：`d624b9c4164bc49420ce89377c6449266e6fd5b7fed3ef24671c258b2d18df3f`。
- 源码提交：`99c5d33103f60d53584cbecdd05d9e066db8a8ca6f233298f6e4f58579398f56`。

核对了磁盘新增 Session 与内嵌原文、授权来源及准确工具配置、12 条成对 broker 事件及
对应原生 MCP 调用参数/返回、源码与基座相同、Code Run 相互引用和 artifact replay。
原生开发中特性警告和 Java 的 SLF4J 警告保留。核对阶段没有模型/Java 重跑或全量测试。

本轮不是独立组织自行搭建接入，不是真人试用，也不证明一般可用性、跨宿主兼容性、领域包
提升编码能力或判定器独立资格。`author_supplied_adapter: true`、真人未观察及
`not_qualified` 均保留。此次价值是同时获得可执行消费证据和一个具体的交付漏项。
