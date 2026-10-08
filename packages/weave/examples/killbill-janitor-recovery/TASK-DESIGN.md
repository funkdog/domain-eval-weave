---
feature_ids: []
topics: [coding, payments, recovery, concurrency, task-design, evaluation]
doc_kind: task-design-card
created: 2026-09-09
status: single-local-agent-episode-observed
task_candidate_id: killbill-janitor-stale-state-recovery
execution_feasibility: bounded-on-the-fly-observed
qualification: not_qualified
---

# 任务设计卡：恢复任务不能把已完成扣款的支付退回“仅授权”

**已通过 operator 初步审计，并完成限定的执行可行性验证。** 目标是让 Agent 修复真实 Java
恢复代码，验收其状态更新行为，不要求 Agent 输出决策或评分 JSON。当前已执行作者构造的
参照、旧快照回归、永不恢复和等价实现；随后冻结了[本地交付合同](CONTRACT.md)并准备公开
工作区；本题源码提交/Code Run 与原生 Harness 无模型预检已接通，首次真实 Agent 修复的
五种场景通过，回放一致，见[人读结果](RESULT.md)。现有 null-status 任务及其历史结果
保持不变。[可行性报告](FEASIBILITY.md)区分真实代码与受控端口的证明边界。

初步审计依据：2026-09-09 02:32 UTC，operator 消息
`0001788921129490-000365-b01fb4a2`（“OK 我初步审计通过”）。本次确认允许先验证可行性，
不等于正式评测资格、公共发布或新的模型运行授权。

## 1. 真实问题与业务含义

来源是 [Kill Bill #809](https://github.com/killbill/killbill/issues/809)，以及已合入的
[修复 PR #810](https://github.com/killbill/killbill/pull/810)。报告中的情况是：恢复任务拿到
一份旧的授权交易状态，等到账户锁时，其他工作已经完成授权和后续扣款；旧任务却又写入授权
成功，使整笔 Payment 的状态从 `CAPTURE_SUCCESS` 退回 `AUTH_SUCCESS`。

这里有三个不能混为一谈的概念：

| 概念 | 人读定义 | 本题为何需要 |
| --- | --- | --- |
| Payment | 一笔支付流程，承载当前业务进度；同一 Payment 可以包含授权、扣款等多步操作 | 验收要保护整笔流程已经取得的进度 |
| PaymentTransaction | 一次具体操作的记录，如授权 T-A 或扣款 T-C；有自己的身份与执行状态 | T-A 成功不代表 Payment 仍应停在授权阶段 |
| Janitor 恢复 | 核对并修正已有未决交易记录的过程 | 恢复已有记录，与发起新的支付操作分开 |

**要避免的后果：**系统记录忘记了已经完成的扣款进度，后续依赖 Payment 状态的操作可能被错误
阻挡或引导。这里不宣称真实资金发生回退、重复扣款或银行对账异常；本题只验收 core 的状态一致性。

## 2. Agent 要完成什么

候选主改文件：固定版本中的
`payment/src/main/java/org/killbill/billing/payment/core/janitor/IncompletePaymentTransactionTask.java`。
保留公开方法及现有依赖边界，让恢复操作在取得账户锁后，依据足够新鲜的交易状态决定是否更新。
正常的未决交易仍应能恢复，不能以一律跳过恢复来避免状态回退。

计划采用已有领域包固定的 **Kill Bill 0.24.21**，commit
`5da9650de60b2fa83dea556d7e95c70b79dabd39`。这个版本**已经有相应保护**，不是待修的线上缺陷。
本次已显式构造“使用锁前旧快照”的开发回归版本，复现历史失败形式；不冒充精确的 2017
部署环境，也不把人工注入的缺陷说成上游当前仍存在的 bug。源码快照和摘要已随开发证据保留；
本地任务的基座、题面、依赖与观察器已按[交付合同](CONTRACT.md)绑定任务摘要；真实 Agent
运行的提交/验收链及权限预检已独立验证，状态见交付合同；不把本地冻结当作公共正式发布。

受保护内容包括验收驱动、期望状态、依赖、状态机配置和观察端口；不允许通过改这些内容来通过。
不扩展到 invoice/payment-control 重试、真实 Provider 调用、多节点分布式锁证明或完整支付平台重建。

## 3. 主场景与验收

使用合成账户、Payment P、授权交易 T-A、扣款交易 T-C 和明确的 10 EUR 插件结果。

```text
恢复任务取得 T-A 的旧快照：UNKNOWN
  → 另一项工作完成 T-A，并完成 T-C
  → 存储中 P 已为 CAPTURE_SUCCESS，T-A/T-C 均为 SUCCESS
  → 恢复任务取得账户锁，继续处理旧的授权恢复请求
  → P 保持 CAPTURE_SUCCESS；不得用旧授权结果覆盖它
```

拟冻结的最小场景组如下；当前受控端口已观察到的子集及尚未覆盖部分见后文，不把设计要求
全部标为已验证：

| 场景 | 执行后的必要结果 | 避免的假通过 |
| --- | --- | --- |
| 旧 UNKNOWN 授权快照遇到已完成扣款 | P 的当前状态及最近成功状态均保持 `CAPTURE_SUCCESS`；交易身份/数量不变；不产生旧授权覆盖写入 | 只断言 T-A 是 SUCCESS，漏掉 Payment 状态倒退 |
| 取得锁时 T-A 确实仍为 UNKNOWN，插件给出匹配的 PROCESSED | 更新同一 T-A 为 SUCCESS，P 推进为 `AUTH_SUCCESS`，保留给定金额/币种；不新建交易 | 一律 return、永不恢复也被判正确 |
| 仍不能取得更明确的结果／PENDING 仍为 PENDING | 保留相应未决状态，不写出未经支持的成功或失败；不创建新的交易 | 把缺失证据等同失败，或把所有状态都改成功 |
| 未取得账户锁 | 不进行受保护的状态更新，保留原状态 | 省掉锁或在锁外先写入 |

观察面包含：执行前后 Payment/Transaction 快照、DAO 更新的对象与字段、操作类 Plugin 调用、
锁的取得/释放及关键顺序。主结论依赖实际存储状态及写入效果；日志中的“成功”或某个函数被调用
本身不够。该 core 路径不得发起新的 AUTHORIZE/CAPTURE 等操作；但不能把 `getPaymentInfo`
这个方法名当作所有真实插件都无写副作用的保证。测试使用合成插件，不访问真实支付系统。

执行顺序由屏障或显式调度控制，不靠 sleep/多跑碰撞。DAO 每次读取应返回独立快照，其他操作
更新存储时不能顺手修改旧快照对象，否则坏实现会因测试替身共享可变对象而被误判通过。

## 4. 领域知识在这里提供什么价值

现有领域模型提示了两个验收维度：**交易有没有成功，以及整笔支付有没有被错误回退**。
仅阅读“修复并发 bug”或只测目标方法返回值，容易漏掉后者。恢复还必须同时满足安全和进展要求，
不能用“不做任何事”获得安全表象。

本卡复用候选模块 `payments.orchestration.killbill@0.1.0-candidate.4`：

- module digest：`b4197c43db0d393e480d12874ce76c0db6d9c51187c99a4c6e4b009fa718d215`；
- [语义模型](../killbill-orchestration/docs/killbill-payment-orchestration-semantic-model.md)中的 Payment、PaymentTransaction、JanitorRecovery；
- [行为模型](../killbill-orchestration/docs/killbill-payment-orchestration-behavioral-model.md)中的恢复与跨操作状态；
- [Claim Ledger](../killbill-orchestration/docs/killbill-payment-orchestration-claim-ledger.md)的 CL-07（已有记录恢复）与 CL-12（账户级 core 锁）。

这些来源在本轮已核对与 candidate lock 的文件摘要一致。Claim 仍为候选中的 grounded，**没有
升级为 confirmed**，CL-15 的多节点顺序与 CL-16 的事件完整性等 unknown 也没有被拿来硬判。
领域知识到本任务的选择关系是显式、人工审阅的映射，不宣称已自动编译成任务。

**产品价值假设：**这样的“定义 → 业务风险 → 可执行断言 → 失败解释”能帮助 Harness 使用者判断
代码是否维护了业务语义。即使代码验收通过，这个产品价值仍需 operator/真实消费者判断；
单题成绩不能证明加入领域包一定改善 Agent，也不能证明一般并发或支付开发能力。

## 5. 执行可行性与停止条件

设计卡初版只核对了源码与历史修复；初步审计后已完成一次限定的环境/量尺可行性工作，
**实际编译并执行四个开发版本，未运行模型**。结果与原始证据见[可行性报告](FEASIBILITY.md)。

- 本题需要真正执行 `IncompletePaymentTransactionTask` 及必要的原有状态/DAO helper，
  可在账户锁、Plugin 与存储端口使用受控替身；不另写一份简化业务算法代替被测类。
- 旧 runner 的 task ID、可修改文件和三份 JAR 面向单文件状态转换器，不能原样承接这个任务。
  模型启动、隔离、来源记录和回放机制可以复用；新任务仍需专用的构建/观察 profile。
- 上游 PR 的回归使用 `TestIncompletePaymentTransactionTaskWithDB`。本地现已在实际恢复类、
  原有状态/DAO helper 与内存存储端口上观察到 Payment 回退和正常恢复。没有启动 SQL 数据库，
  因而不等于复现上游 WithDB 测试、事务隔离或完整 Capture 流程。
- 本次只执行已有 Plugin 结果的 on-the-fly 入口；`getPaymentInfo` 获取流程没有运行。
  Capture 完成状态与交易数量由显式调度夹具设置，只物化并返回已有 AUTH 记录；不把这些
  设置值当作真实扣款代码已执行或完整交易表已验证。锁是受控端口，不是分布式锁实现。
- 原参照和等价实现满足五种开发场景；旧快照回归暴露 Payment 状态回退，“永不恢复”被
  正常恢复场景拒绝。这个可行性门已通过，但作者可见开发场景不替代独立校准；本地任务冻结
  是后续独立的准备步骤，证据见交付合同。
- 如需大范围重写业务逻辑、扩张成完整平台、或额外昂贵依赖才能观察到核心结果，应返回修改
  任务范围，而不是以模型回答的决策 JSON 代替执行证据。

## 6. Eval 资格与责任（草案）

按 `eval-design` 的 E0：本题的代码规约落在可执行验证范围，新鲜证据来自实际 Java 执行和
受控存储观察；裁判为确定性 verifier，维护成本由项目开发承担，不引入 LLM Judge。
任务是否代表真实需求、是否值得复用，是 operator/消费者的价值判断，不能由该 verifier 自证。

- **utility claim / estimator：**仅在环境有效、机会与观察完整时，报告各场景的状态保护、
  正常恢复和越权副作用结果；保留分项向量，不合成“编码总分”。未修复的原基座也要入账。
- **roles：**operator 确认任务价值并决定下一步；Kill Bill 维护者提供该版本实现行为的来源；
  项目维护者构造任务与观察器。当前作者兼任设计/观察器准备，没有独立校准者，不能自发资格。
- **calibration：**历史修复/上游回归作为公开开发锚；检查旧快照回归、永不恢复反例与等价实现。
  正式 qualified 仍需独立冻结、执行/解封的验收证据，本卡没有提供。
- **repeatability：**运行前固定版本、缺陷 diff、合成状态、调度、依赖、观察器和验收规则；
  记录原始执行证据。固定调度消除碰运气；不为提高通过率反复给模型重试或回灌私有答案。
- **validity bounds：**只覆盖固定版本/默认状态机下的 core 恢复；不同插件、分布式锁、
  真实资金、副作用通道不完整、或构建/调度未成立时不能外推硬结论。公开历史题存在暴露风险。

状态为 `single-local-agent-episode-observed / bounded-on-the-fly-observed / not_qualified`。
本卡确认与开发验证不等于同意金融策略、晋升领域 Claim、发布 API 或批准正式能力排名。

## 7. 可追溯来源

1. [Issue #809](https://github.com/killbill/killbill/issues/809) 与
   [报告者对错误字段的澄清](https://github.com/killbill/killbill/issues/809#issuecomment-339867862)：
   历史报告指向 Payment 状态倒退；不是本轮新发生的事故或频率测量。
2. [PR #810](https://github.com/killbill/killbill/pull/810/files)：锁内重新读取交易的修复与
   `testUpdateWithinLock` 回归；2017-10-30 合入，merge commit
   `702b715bba5ae7d4e0696382ddeaffe5e9e9a864`。它是公开历史依据，不是隐藏答案或本轮运行证据。
3. 当前固定 core commit `5da9650de60b2fa83dea556d7e95c70b79dabd39`：
   [恢复类](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/main/java/org/killbill/billing/payment/core/janitor/IncompletePaymentTransactionTask.java#L111-L155)
   在锁内重新读取并检查状态；同类 158–219 行连接状态计算与已有交易更新。
4. 同版本 [DAO helper](https://github.com/killbill/killbill/blob/5da9650de60b2fa83dea556d7e95c70b79dabd39/payment/src/main/java/org/killbill/billing/payment/core/sm/PaymentAutomatonDAOHelper.java#L139-L227)
   将当前 Payment 状态与最近成功状态传入持久化更新，说明只检查交易状态不足以覆盖风险。
5. 本地[固定源码包](../killbill-orchestration/sources/core.json)摘要
   `a6848aa19ba4b8483f8798f65aa68bc11aae43949637a82a33a825ec8544bebf`；
   其中恢复类内容摘要 `23df7a78b85a803d61bb5dd228388b0eceebdd9a36c7055cfaae49f0bf742e7c`。

**下一步：**转向无作者现场指导的消费可用性，确认依赖准备、提交与回放是否仍依赖未交付的
作者机器材料；本次真实结果已核对，不追加同题模型尝试。不扩大成整个支付重试系统，不把
单次任务成功写成产品价值或一般 Coding 能力已经得到证明。
