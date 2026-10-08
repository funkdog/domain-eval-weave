---
feature_ids: []
topics: [evaluation-authoring, janitor, processed-money, acceptance-maintenance]
doc_kind: task-brief
created: 2026-09-10
status: verifier-author-task-local-v2
qualification: not_qualified
---

# 为 Janitor 验收补齐金额与币种来源检查

**任务类型：维护可执行验收。** 你是验收代码的维护者，不是支付组件的修复者。
仅在交付给你的工作区操作，按 `ENVIRONMENT.json` 中的绝对 JDK 路径构建和运行。
本地任务不授予访问工作区以外目录、网络、提权、委派或启动其他模型的权限。

## 为什么有这个任务

现有 Janitor 验收检查恢复是否保护整笔 Payment 的进度，以及正常未决交易是否能够推进。
但其 Plugin 结果始终带有明确的金额和币种，没有覆盖这些字段缺失时的处理。

现在需要扩展验收，让它能检查字段缺失时恢复后的**状态、处理金额和币种是否符合固定版本的实现约定**。
这是一项本项目的覆盖维护需求，不是假称上游出现了新 bug。

## 你需要交付什么

1. 修改 `src/JanitorProbe.java`，保留包名、类名与 `public static void main(String[] args)` 入口。
   正常返回表示该实现通过验收；发现违反约定的行为时抛出 `AssertionError`。
   其他异常、超时或提前结束进程都不算有效的业务拒绝。不要调用 `System.exit` 或 `halt`。
2. 在 `INFORMATION.md` 说明每项关键断言的资料路径／位置、复用和新增内容，以及仍需用户确认的信息。
   区分“资料中已有但没查到”“新政策需要决定”“实现证据不足”，不要编造用户补答或自报节省数量。
3. `build/` 只放开发编译输出。提交只接纳验收源码和上述说明，不采用开发 build 产物。

评判依据是验收代码运行时能否接受合理实现、识别目标错误，并保留已有回归要求；
**不是你自报“覆盖完整”、输出评分 JSON 或引用了多少个 Claim ID。**

## 范围

- 沿用 Kill Bill 0.24.21，core commit `5da9650de60b2fa83dea556d7e95c70b79dabd39`。
- 入口仍为传入 Plugin 结果的 on-the-fly Janitor；使用已有真实状态／DAO helper 与受控内存存储、账户锁。
- 原始材料在 `sources/`，环境和可执行组件已经给出；目录中其他交付资料可按需使用。
- 实现行为以固定版本的原始来源核对。若认为行为不符合某项业务政策，另列问题，
  不能擅自改判据要求组件采用你偏好的政策。
- 不修改 `src/IncompletePaymentTransactionTask.java`、`lib/`、题面、环境或任何交付资料。
- 保留既有旧快照、正常恢复、未明确结果、PENDING 与取锁失败场景的有效检查。
- 不接真实 Provider、数据库或网络，不改变原交易身份，不把受控锁当分布式锁证明。
- 可以自行做笔记、重构自己的验收代码；只输出限定交付文件。不查看其他会话、组别、控制目录或已有答案。

本轮没有运行中作者补答；若确实不能判断，在说明中如实列出，不以猜测替代。
