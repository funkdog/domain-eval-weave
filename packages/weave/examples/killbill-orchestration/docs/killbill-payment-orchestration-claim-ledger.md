---
feature_ids: []
topics: [payments, kill-bill, claim-ledger, provenance, epistemic-state]
doc_kind: claim-ledger
created: 2026-09-03
version: 0.3.0
status: candidate-for-operator-review
decision_provenance: thread_msx25fw48rony7bs
scope_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-scope-declaration.md
  accepted_commit: 177d892e488f3304ddf0a1201ff4eaba9a5c0181
semantic_model_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-semantic-model.md
  accepted_model_commit: bb3e547b62e35f97b5293b4d9f0a42bf6a0df6ce
  operator_message_id: 0001788419988271-000189-92337bf0
behavioral_model_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-behavioral-model.md
  accepted_model_commit: 662dbba3133939b20a354335b710f437948e4106
  operator_message_id: 0001788420387857-000196-465a2f00
stage_authorization:
  authorized_at: 2026-09-03
  operator_message_id: 0001788420387857-000196-465a2f00
  authorized_stage: claim-ledger-candidate
authority_contract_resolution:
  issue_message_id: 0001788421362068-000210-ce416458
  authorization_message_id: 0001788428561700-000254-7f0792f5
  status: implemented-local-candidate
  source_kind: implementation_artifact
  authority_kind: implementation_maintainer
candidate_packaging:
  authorization_message_id: 0001788707486995-000333-999215e0
  status: candidate-only
  module_path: packages/weave/examples/killbill-orchestration/module.yaml
---

# Kill Bill Payment Orchestration Claim Ledger v0.3

本次 PURCHASE 超时场景推演修订 CL-05 的默认金额适用条件，并明确 CL-07 的同状态不更新行为。
依据是精确源码调用链；没有新增运行时证据，也没有提升 Claim 为 confirmed。

## 1. 目标与成本边界

本候选记录 `payments.orchestration.killbill` 已接受 Semantic/Behavioral Model 上的限定命题。它不会
把每个字段、枚举值和状态转换都机械复制成 Claim。

只有当一个命题发生变化会影响下列至少一项后续决策时，它才进入 Ledger：

- a cross-implementation Mapping;
- a Domain View or Closure result;
- an observation requirement;
- an Eval predicate or failure interpretation.

概念定义留在 Semantic Model，详细时序留在 Behavioral Model，精确源码位置留在 Source
Feasibility Matrix 和两个模型的 source-coverage 部分。这样无需为每一行源码创建一个 evidence
Mapping，Claim 审阅成本与其决策价值保持相称。

本候选没有创建任何 `confirmed` Claim。Behavioral Model 的验收只授权构造 Claim，不能代替逐条
Claim 确认。

## 2. 共享 Claim Envelope

除非某一行另有说明，所有 Claim（含 unknown）都使用下面的适用范围。机器包为本次来源快照
另记 recorded_at，保留本清单 2026-09-03 的作者记录；Claim 状态不因打包提升。

| 维度 | 共同值 | 含义 |
| --- | --- | --- |
| applicability | implementation=`Kill Bill`; core=`0.24.21`; API=`0.54.0`; Plugin API=`0.27.3`; state machine=`default PaymentStates.xml` | 不能外推到其他版本、自定义状态机或 Provider |
| valid time | 候选以 core commit 时间 `2026-08-12T06:30:33Z` 为版本模型的查询下界 | 建模约定；不是软件部署、生效日期或所有历史环境的事实，查询同时必须匹配精确版本 |
| recorded time | `2026-09-03T07:30:06Z` | 本 Ledger 候选记录命题的时间 |
| provenance | accepted Scope → exact Source Matrix → accepted Semantic v0.2 → accepted Behavioral v0.2 | 后续阶段不能绕过前序边界 |
| source independence | one Kill Bill maintainer ecosystem | 多个仓库或证据面仍属于同一个维护者生态，不能建立行业共识 |

### Authority assertion `A-KB-IMPLEMENTATION-MAINTAINER`

| 字段 | 值 |
| --- | --- |
| semantic authority kind | `implementation_maintainer` |
| sources | 按各 Claim 适用：`KB-DOC-9EF10C7`、`KB-CORE-0.24.21`、`KB-API-0.54.0`、`KB-PLUGIN-API-0.27.3`、`KB-COMMONS-0.26.15` |
| authority scope | 精确 Kill Bill 版本声明、公开、实现并在维护者测试中期望的行为 |
| explicitly not authoritative for | Provider 支持能力、支付行业共识、法律义务、清算、结算、打款、银行入账或会计闭合 |
| serialization status | internal M1 contract supports `implementation_artifact → implementation_maintainer`; 已编入同目录上层的 candidate Module |

此前的 authority vocabulary 缺口已经通过最小正交扩展解除；它没有被 `service_provider`、
`industry_standard`、`product_owner` 或 `industry_expert` 代偿。候选打包保留 Claim 原文、状态和精确来源；
编译通过只证明结构、引用和类型配对一致，不认证 Claim 语义真值。

## 3. 已有充分来源支撑的描述性 Claims

本节 Claim 都使用 `kind=descriptive_fact`、`epistemic_state=grounded` 和 authority
`A-KB-IMPLEMENTATION-MAINTAINER`。

| Claim ID | 主体 | 限定命题 | 可观测性 | Source IDs |
| --- | --- | --- | --- | --- |
| `KB-CL-01-initial-operation-set` | `Payment` | 在精确默认配置中，一笔直接 Payment 可以由 AUTHORIZE、PURCHASE 或 CREDIT 开始。 | `observable` | `KB-DOC-9EF10C7`, `KB-API-0.54.0`, `KB-CORE-0.24.21` |
| `KB-CL-02-cross-operation-links` | `PaymentStateName` | 活动链接集合为：initial→AUTH/PURCHASE/CREDIT；AUTH_SUCCESS→CAPTURE/VOID；CAPTURE_SUCCESS→CAPTURE/REFUND；PURCHASE_SUCCESS→REFUND；REFUND_SUCCESS→REFUND。CREDIT_SUCCESS 和 VOID_SUCCESS 没有活动出边。 | `observable` | `KB-CORE-0.24.21`, `KB-COMMONS-0.26.15` |
| `KB-CL-03-create-before-plugin` | `PaymentTransaction` | 新的直接操作会在调用 Plugin 前先持久化一条初始状态为 UNKNOWN 的 Transaction；首笔操作同时持久化 Payment 与 Transaction。 | `partially_observable` | `KB-CORE-0.24.21` |
| `KB-CL-04-plugin-result-mapping` | `PaymentPluginStatus` | PROCESSED→SUCCESS；PENDING→PENDING；ERROR→PAYMENT_FAILURE；CANCELED→PLUGIN_FAILURE；UNDEFINED、timeout、exception 或非法空结果→UNKNOWN。 | `observable` | `KB-DOC-9EF10C7`, `KB-API-0.54.0`, `KB-CORE-0.24.21` |
| `KB-CL-05-processed-money-normalization` | `ProcessedMoney` | 新的直接操作在 SUCCESS/PENDING 且 Plugin 缺少金额或币种时使用请求上下文默认值；Janitor 恢复路径的默认值来自已有 Transaction.processedAmount/processedCurrency，不保证回填原请求值。其他结果类别的 processed amount 由 helper 保存为零。 | `partially_observable` | `KB-API-0.54.0`, `KB-CORE-0.24.21` |
| `KB-CL-06-explicit-pending-completion` | `PaymentTransaction` | 合格的 PENDING Transaction 可以通过显式完成 API 变为 SUCCESS 或 PAYMENT_FAILURE；不创建新 Transaction，也不再次调用 Plugin。 | `partially_observable` | `KB-DOC-9EF10C7`, `KB-API-0.54.0`, `KB-CORE-0.24.21` |
| `KB-CL-07-janitor-reobservation` | `JanitorRecovery` | Janitor 通过 getPaymentInfo 重新查询已有交易，并可根据匹配的更明确结果修正记录；仍为相同状态时不写交易更新，无法获得更明确结果时保留已有状态。这条 core 恢复路径不重新提交支付操作。 | `partially_observable` | `KB-DOC-9EF10C7`, `KB-PLUGIN-API-0.27.3`, `KB-CORE-0.24.21` |
| `KB-CL-08-failed-operation-new-retry` | `PaymentTransaction` | PAYMENT_FAILURE 或 PLUGIN_FAILURE 后，后续合法业务调用可以从最近成功 Payment 状态创建新 Transaction，但仍受 key、类型、币种和状态转换约束。 | `observable` | `KB-CORE-0.24.21` |
| `KB-CL-09-success-key-reuse-rejected` | `TransactionExternalKey` | 在活动操作中，复用已有成功 Transaction 的 external key 会被拒绝；chargeback reversal 例外继续留在邻接域。 | `observable` | `KB-CORE-0.24.21` |
| `KB-CL-10-currency-consistency` | `RequestedMoney` | 新的活动非 chargeback Transaction 如果币种与第一条 Transaction 不同，会在调用 Plugin 前被拒绝。 | `observable` | `KB-CORE-0.24.21` |
| `KB-CL-11-transaction-event-category` | `PaymentTransaction` | SUCCESS/PENDING 更新发布 PaymentInfoEvent；PAYMENT_FAILURE 发布 PaymentErrorEvent；PLUGIN_FAILURE/UNKNOWN 经 transaction update path 发布 PaymentPluginErrorEvent。 | `partially_observable` | `KB-CORE-0.24.21` |
| `KB-CL-12-account-scoped-core-lock` | `AccountRef` | dispatch path 可以使用 Account-scoped lock 串行化 Kill Bill core 内的工作；这只是 core 并发机制，不是 Provider 串行化。 | `partially_observable` | `KB-CORE-0.24.21` |

### 不另外拆成 Claim 的直接推论

- `KB-CL-03` 说明 Transaction 在 Plugin 调用前创建，因此记录存在不能单独证明 Provider 已收到请求；
- `KB-CL-06`、`KB-CL-07` 修改已有 Transaction，因此恢复必须与 `KB-CL-08` 的新业务重试分开；
- `KB-CL-12` 只约束 core，不能推出 Provider 侧 exactly-once。

这些推论跟随其父 Claim 保存，避免人为增加 Claim 数量。

具体 Stripe Plugin profile 见行为文档 E2。CL-07 只描述 core 调用了查询端口，而不保证该端口的
实现没有外部写操作：8.0.4 插件在 getPaymentInfo 中可能 confirm/cancel，也可能从 Search 空结果
推断本地 CANCELED。这些是插件限定发现，没有升级为本核心 Module 的通用 Claim。

## 4. 明确保留的 unknown Claims

这些命题仍在 Kill Bill 编排或部署边界内，但没有足够精确证据形成稳定结论。`unknown` 不代表 false，
也不能直接转换成 Eval 的 hard failure。

| Claim ID | 主体 | 真值仍未知的命题 | Kind | Epistemic state | Observability | 已检查证据/缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| `KB-CL-13-missing-plugin-uniformity` | `PaymentPluginPort` | 所有 Plugin 缺失、已删除或无法解析的路径都会产生完全一致的 API error、Transaction state 和 event shape。 | `descriptive_fact` | `unknown` | `partially_observable` | `KB-CORE-0.24.21` exception path 可见，但尚未穷举提取并测试所有变体 |
| `KB-CL-14-repeated-pending-surface` | `PaymentTransaction` | scheduled 与 on-the-fly Janitor 面对重复 PENDING 观测时，对外始终产生同一种稳定结果。 | `descriptive_fact` | `unknown` | `partially_observable` | `KB-DOC-9EF10C7`、`KB-CORE-0.24.21` 保留未决状态，但部署/配置行为尚未闭合 |
| `KB-CL-15-distributed-account-ordering` | `AccountRef` | Account-scoped locking 在所有受支持的多节点部署中提供相同操作顺序保证。 | `descriptive_fact` | `unknown` | `partially_observable` | `KB-CORE-0.24.21` 包含 core lock path，但已接受来源缺少精确部署与 distributed-lock 证据 |
| `KB-CL-16-internal-event-feed-complete` | `PaymentTransaction` | 内部支付事件为每次持久化 Transaction 更新提供完整且无缺口的观测流。 | `descriptive_fact` | `unknown` | `unknown` | `KB-CORE-0.24.21` 有 event creation path，但没有 durable delivery 与 subscriber completeness 证据 |

没有任何 authority assertion 确认这些命题。相关 source ID 只表示检查过的证据面，不表示真值背书。

CL-14 的局部机制现已查清：`IncompletePaymentTransactionTask` 在再次得到相同 PENDING 状态时返回
原状态而不写交易更新；但该事实不覆盖调度周期、外部 API 响应、Plugin 行为和事件投递，因此原命题
仍为 unknown。本次未枚举 CL-13 的全部错误路径，也未验证 CL-15/16 的部署和消息完整性。

## 5. 有意排除在本 Ledger 之外的命题

| 排除的命题族 | 处置 | 原因 |
| --- | --- | --- |
| cumulative CAPTURE ≤ AUTHORIZE | `out_of_scope` for this Kill Bill Module | Requires Product/Provider amount authority; core transition links do not establish it |
| cumulative REFUND ≤ captured/purchased value | `out_of_scope` | Requires Product/Provider refund authority |
| refund returns value to original tender | `out_of_scope` | Requires Provider/payment-instrument semantics |
| Plugin supports every active TransactionType | `out_of_scope` | Capability is Provider-specific |
| Kill Bill SUCCESS means clearing/settlement/payout | `out_of_scope` | Kill Bill orchestration status has no financial-finality authority |
| external key or Account lock guarantees Provider exactly-once | `out_of_scope` | Cross-system economic effect requires Provider observations and Mapping |
| Payment Test Plugin successful-refund behavior | source-oracle gap, not Domain Claim | The exact test-plugin refund defect remains in the Source Matrix |

这些命题没有被写成 Kill Bill 的 `unknown` Claim，因为其治理权威属于其他 Model Context；这里的
正确状态是 `out_of_scope`，而不是假装 Kill Bill 还缺一份证据。

## 6. Ledger summary

```text
grounded descriptive Claims: 12
unknown descriptive Claims:   4
confirmed Claims:              0
conflicted/contested Claims:   0
normative/product/legal Claims:0
independent source ecosystems: 1
machine serialization:        candidate module materialized; verification command in ../README.md
```

没有发现冲突不代表形成共识；本候选只有一个适用的 implementation-maintainer 生态。

## 7. Claim Ledger 验收门

接受本候选表示确认：

1. 只有会影响后续 Mapping、Closure、Observation 或 Eval 决策的命题才进入 Ledger；
2. 12 条 grounded 命题准确描述了精确 Kill Bill 版本范围；
3. Behavioral Model 的接受不会自动把任何 grounded Claim 提升为 `confirmed`；
4. 4 条未解决命题继续保持 `unknown`，不被静默判断为 false 或 true；
5. Provider、财务、产品和法律命题明确留在当前 Module 之外；
6. Kill Bill 来源组合只算一个维护者生态，不能建立行业共识；
7. `implementation_artifact → implementation_maintainer` 是如实且已由内部 Schema/Compiler 支持的
   Source Authority 配对，并继续拒绝与其他 authority kind 相互替代；
8. 接受后唯一获准的下一产物是 candidate Module Release package；Mapping、Landscape、Product
   Contract、Observation Contract 和 Bench 均未获授权。

任何 Claim 都可以单独拒绝或修订。接受只会冻结 Ledger 候选以供打包，不会让后续 Module Release
自动成为 published 或 supported。
