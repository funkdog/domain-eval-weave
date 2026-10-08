---
feature_ids: []
topics: [coding, payments, recovery]
doc_kind: coding-task
created: 2026-09-09
task_id: killbill-janitor-stale-state-recovery
version: 0.1.0-local.1
---

# 修复旧恢复请求覆盖支付新进度的问题

交付物是修改后的 Java 源码，不是决策 JSON、评分或“已修复”的文字说明。

## 业务背景

Payment 表示一整笔支付流程；PaymentTransaction 表示其中一次授权、扣款等操作。
一笔授权交易成功，不代表整笔支付还停在授权阶段——它可能已经继续完成扣款。
Janitor 负责核对和恢复已有未决交易，不能用旧交易快照覆盖整笔支付的新进度。

你维护的恢复组件收到一个旧的授权恢复请求。等待账户锁期间，其他操作可能已经完成授权
和扣款；当前实现仍可能依据旧快照更新，把 Payment 从 `CAPTURE_SUCCESS` 写回
`AUTH_SUCCESS`。请修复 `IncompletePaymentTransactionTask` 的已有结果恢复入口：

1. 取得账户锁后，如果授权交易已完成、Payment 已推进到扣款成功，应保留 Payment 的
   当前状态与最近成功状态，不再用旧授权结果覆盖它。不能依赖锁前快照仍然有效。
2. 如果授权确实仍为 `UNKNOWN`，给定对应交易的 `PROCESSED` 插件结果时，应正常更新
   同一交易为 `SUCCESS`，Payment 推进到 `AUTH_SUCCESS`，保存该结果的金额和币种。
   不得通过永远跳过恢复来修复第一项。
3. 明确的 `UNDEFINED` 结果应保持 `UNKNOWN`；`PENDING` 仍为 `PENDING` 时不虚构终态。
4. 未取得账户锁时不执行受保护的更新；取得的锁须释放。恢复已有记录，不创建新交易，
   不发起 AUTHORIZE/CAPTURE 等支付操作，不引入网络或文件副作用。

保留包名、构造器、公开方法签名和现有依赖边界。修复只限
`src/IncompletePaymentTransactionTask.java`；不修改依赖、观察端口或验收规则。
实现形式不限，不要求与某份参考补丁逐字相同；不要针对特定账户、金额或测试身份硬编码。

## 开发与交付

公开工作区的 `ENVIRONMENT.json` 给出绝对 JDK 路径和编译目标。可在工作区执行：

```sh
<java_home>/bin/javac -proc:none --release 11 -classpath 'lib/*' -d build src/IncompletePaymentTransactionTask.java
```

`build/` 仅用于开发输出，正式验收重新编译源码，不采纳已有 class 文件或 patch 文件。
`TASK.md`、`ENVIRONMENT.json`、`LICENSE`、`DEPENDENCIES.json`、`lib/` 是受保护输入。
除 `build/` 中临时产物外，不新增交付文件。最终提交冻结唯一允许的源码文件。
不联网、不请求提权、不委派其他 Agent；只在给定公开工作区开发，不访问其父目录或其他工作区。

## 范围说明

本题在固定 Kill Bill 0.24.21 源码上显式重新引入历史类型的旧快照缺陷；不声称上游该版本
本来有此缺陷。验收执行实际恢复类及原有 helper，用受控账户锁和内存 DAO 安排交错，观察
状态更新。Plugin 结果直接传入，不测定时查询、真实 Provider、SQL 事务或完整 Capture 流程。
运行环境中的“扣款已完成”是外部完成状态的受控输入，不是真实资金操作。

依赖中的目标类原始字节码已移除，须编译你的源码；其他原有 helper 保留。本题来自公开历史，
不声称是训练未见题，也不能代表一般支付或并发开发能力。任务要求是公开规约，验收结果由
外部执行记录产生，请勿自报分数。
