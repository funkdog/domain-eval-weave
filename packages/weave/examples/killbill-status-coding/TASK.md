---
feature_ids: []
topics: [coding, payments, plugin-status, regression-repair]
doc_kind: coding-task
created: 2026-09-07
status: local-component-task
version: 0.1.0-local.1
---

# 修复支付插件状态转换中的空状态处理

任务 ID：`killbill-plugin-status-null-regression`。能力场景：Java 代码修复。
业务领域：Kill Bill 支付编排的 Plugin 结果转换。

你维护的支付组件需要把插件的结果转换成内部交易状态和状态机操作结果。插件对象存在，但其
`getStatus()` 可能返回 `null`。当前候选代码在这种情况下抛出异常，未能正常表达“结果未知”。

修复 `org.killbill.billing.payment.core.PaymentTransactionInfoPluginConverter`，要求：

1. 插件对象非 null、状态为 null 时，`toTransactionStatus` 正常返回 `TransactionStatus.UNKNOWN`，
   `toOperationResult` 正常返回 `OperationResult.EXCEPTION`。后者是一个枚举结果，不是抛出 Java 异常。
2. 保留现有非空状态的业务映射：

   | Plugin 状态 | TransactionStatus | OperationResult |
   | --- | --- | --- |
   | PROCESSED | SUCCESS | SUCCESS |
   | PENDING | PENDING | PENDING |
   | ERROR | PAYMENT_FAILURE | FAILURE |
   | CANCELED | PLUGIN_FAILURE | EXCEPTION |
   | UNDEFINED | UNKNOWN | EXCEPTION |

3. 保持两个公开方法签名和包名不变；只修改这个类，不替换依赖、观察驱动或验收规则。
4. 不引入网络访问、文件副作用或实际支付操作。插件对象本身为 null 不在这项任务的保证范围内。

交付物是修改后的 Java 源码，不是决策 JSON、测试分数或“已经修复”的文字说明。
若使用补丁，先应用到给定工作区；提交器冻结最终源码，不直接接收 patch 文件。
验收将编译并调用你的方法。具体实现形式可以不同，不要求与某份参考补丁逐字相同。

`src/PaymentTransactionInfoPluginConverter.java` 是唯一被接纳的代码文件；`build/` 可放开发编译
输出，但不会进入验收。`TASK.md`、`ENVIRONMENT.json`、`LICENSE` 和 `lib/` 是受保护输入，提交时
会检查是否改变。Java 路径和编译目标见 `ENVIRONMENT.json`。

本任务是从真实历史问题导出的回归修复练习。准备阶段将在固定的 0.24.21 源码上显式重新引入
对应缺陷；不是声称上游 0.24.21 本来有此问题。运行 profile 是该类及真实依赖的组件级编译，
不是整个 Kill Bill 项目的构建验收。本地入口已支持准备、提交及验收。外部 Harness 必须使用限制
在公开工作区内的工具执行能力，不得将控制目录或整个宿主文件系统暴露给被测 Agent。
