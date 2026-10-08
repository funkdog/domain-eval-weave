---
feature_ids: []
topics: [coding, consumer, local-delivery, task-usage]
doc_kind: consumer-guide
created: 2026-09-09
status: local-consumer-kit
qualification: not_qualified
---

# Janitor 本地消费包：从收到任务到回放结果

你收到的是一项 Java 代码修复任务及其本地验收器。任务要求恢复已有交易时不覆盖更晚的支付
进度，同时保证正常恢复仍能推进。这里不启动模型、不自带 Harness，也不要求被测 Agent 输出评分 JSON。

这个包目前只支持**同一宿主上的目录搬移**：Node 24、macOS 及包中固定的原 JDK/宿主指纹。
不需要原项目仓库、pnpm、tsx、npm install、数据库、网络下载或作者的历史运行目录。
JDK 不随包分发；不同宿主/JDK 必须重新绑定和验证，目前 doctor 会拒绝，不声称跨机支持。

## 谁可以看什么

整个包属于消费者的**评测控制端**，包含私有判据和观察器；不能把整个包交给被测 Agent。
`prepare` 返回的 `workspace` 才是 Agent 的输入。Agent 只应有该工作区及给定开发工具的必要权限，
不得访问包的其余目录或父目录。仅有目录分开还不够，接入的 Harness 必须验证实际权限。

包中没有登录凭据、原生会话、参考修复源码或以前 Agent 的答案。既有 helper 的派生 JAR 已移除
目标类原始字节码；私有验收判据仍存在，这是评测端所需资产，不是给 Agent 的答题输入。
所有本地状态留在包内 `state/`，默认持久化，无自动清理。原来的 `state/seed` 是只读种子，
不能直接拿它改代码；用 prepare 得到新的实例。

## 1. 检查收到的包

进入包目录，用 Node 24 执行：

```sh
node cli.mjs doctor
```

应返回 `ready: true`、`task_digest` 与 `kit_digest`。核对 kit_digest 与交付者另外提供的摘要。
`kit.sha256` 加文件清单用于发现损坏或意外变更，不是数字签名，不能自行证明一个未知来源的包可信。
不要执行来历不明的包。所有命令先校验固定文件，遇到 drift 不会回退到作者仓库找缺失文件。

## 2. 准备一个新的答题工作区

```sh
node cli.mjs prepare
```

保留返回的 `root`（实例目录）和 `workspace`（公开工作区）。同一包创建的实例绑定相同任务摘要。
公开题面在 workspace/TASK.md，绝对 JDK 路径与编译参数在 ENVIRONMENT.json。
只接收 `src/IncompletePaymentTransactionTask.java` 的最终源码；`build/` 只用于开发，
不作为验收输入。其他公开文件与依赖受保护。

将**公开工作区**交给你选择的 Harness，让 Agent 按题面完成代码修复并停止，再进行下面的提交。
本包不创建或调度模型会话；模型、预算、工具权限及 Agent 输入输出来源由消费者自己的 Harness 负责。
如需通过包提供的受限 shell 开发，可使用 `workspace-exec <实例目录> <命令>`；这不是完整 Agent 适配器。

## 3. 提交源码与执行验收

```sh
node cli.mjs submit <实例目录>
node cli.mjs evaluate <实例目录> <上一步返回的源码提交digest>
```

提交器检查文件集合、保护输入和链接，保存不可变源码快照。验收器重编译这个快照，不读取
后续改动的工作区源码，不采用开发 class 文件。每个编译/执行进程各限 30 秒，输出 256 KiB，
Java 堆 256 MiB；没有候选联网权限。

返回 `path` 指向 Code Run，`result.checks` 是五个场景的分项结果。没有修改初始缺陷源码时，
主场景 `concurrent_capture` 应为 fail：Payment 被旧恢复请求从 CAPTURE_SUCCESS 写回 AUTH_SUCCESS。
这是预期的缺陷被发现，**不表示包安装失败**。仅在具有完整有效观察时才给行为 pass/fail；
编译、环境或观测失败是 `measurement_validity: invalid / verdict: inconclusive`，先看 diagnostic
与保存的原始输出，不把“没有记录”当作业务成功或失败。

## 4. 回放结果

```sh
node cli.mjs replay <Code-Run.json路径>
```

它从该 Run 的原始输出重算结果，不执行 Java 或模型。Run 必须在此包的 state 子树内；移动
整包会保留相对布局，命令参数用移动后的绝对路径。回放要求包内判读器与 Run 记录的版本一致。
Code Run 不自行证明是谁写了源码：内层 `agent_execution: not_observed` 是有意的来源边界。
要声称真实 Agent 表现，需另行绑定消费者自己的会话、实际输入/配置/工具轨迹和提交。

## 边界与反馈

五种场景分别检查新支付进度不回退、正常恢复推进、UNDEFINED/PENDING 保留不确定性、锁失败
不写状态；这是受控内存 DAO 和锁调度下的组件任务，不是 SQL、真实 Capture、Provider 或资金验收。
公开历史暴露、同 JVM 观察器反篡改与独立校准问题仍未解决，始终为 `not_qualified`。
这是本地开发交付包，不是已发布 SDK/CLI、通用任务格式或获准公开再分发的产品发行版。

如果操作失败，请记录命令、返回的 diagnostic、task/kit digest 和对应本地证据路径；**不要附上
认证文件或生产数据**。另请记录是否需要作者临时解释：哪个术语不清、哪份输入缺失、是否能找到
失败原因、是否理解证明边界。工程搬移成功不能代替这份独立消费者的可用性反馈。
