---
feature_ids: []
topics: [payments, kill-bill, behavioral-model, state-machine, recovery]
doc_kind: behavioral-model
created: 2026-09-03
version: 0.5.0
status: candidate-revision
decision_provenance: thread_msx25fw48rony7bs
scope_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-scope-declaration.md
  accepted_commit: 177d892e488f3304ddf0a1201ff4eaba9a5c0181
source_matrix_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-source-feasibility-matrix.md
  source_delta_commit: e639a216c2be6bcf56f09615cf5f713571f57561
semantic_model_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-semantic-model.md
  accepted_model_commit: bb3e547b62e35f97b5293b4d9f0a42bf6a0df6ce
  operator_message_id: 0001788419988271-000189-92337bf0
behavioral_authorization:
  authorized_at: 2026-09-03
  operator_message_id: 0001788402058387-000118-2dc5f6aa
  authorized_stage: behavioral-model
behavioral_review:
  resumed_at: 2026-09-03
  operator_message_id: 0001788419988271-000189-92337bf0
  next_stage_if_accepted: claim-ledger-candidate
behavioral_acceptance:
  accepted_version: 0.2.0
  accepted_at: 2026-09-03
  operator_message_id: 0001788420387857-000196-465a2f00
  accepted_model_commit: 662dbba3133939b20a354335b710f437948e4106
  gate: four-point-human-review-surface
  authorized_next_stage: claim-ledger-candidate
scenario_revision:
  authorization_message_id: 0001788709457042-000342-14108df4
  method: pinned-source-walkthrough
  scenario: purchase-timeout-recovery
adapter_profile:
  authorization_message_id: 0001788710303553-000356-15ee62bb
  plugin: stripe-plugin-8.0.4
  plugin_commit: 7c5577920a6fa23e1cd40aeee163ff8da14d8b74
  sdk: stripe-java-21.15.0
  sdk_commit: 8013108073a5ca1d5e11b462e9b6ba3dc5a6ed81
  evidence_mode: exact-code-links-and-current-provider-docs
  runtime_verified: false
recovery_decision_contract:
  contract_id: purchase-timeout-recovery
  version: 0.1.0-candidate
  authorization_message_id: 0001788712200918-000388-d874b9ef
  status: proposed-application-policy
  implementation_status: not-implemented
---

# Kill Bill Payment Orchestration Behavioral Model v0.5

## 1. Purpose and limits

This candidate defines actors, commands, state transitions, internal event categories, ordering, failure
and incomplete-state recovery for the accepted `payments.orchestration.killbill` Model Context.

Version 0.2 preserves the exact v0.1 behavior extraction, binds it to the accepted Semantic Model v0.2
and adds a Chinese human-review surface before the source-oriented detail.

Version 0.3 is a source-based amendment discovered while tracing a PURCHASE timeout: amount defaults
depend on the call path, and reissuing PURCHASE with the same key is distinct from a read or explicit
PENDING completion. The v0.2 acceptance above remains historical; this amendment is a candidate.

It describes Kill Bill `0.24.21` behavior from exact docs, code, locked APIs, automaton implementation and
maintainer tests. It does not yet create Claims, product commitments, observation completeness rules,
grader predicates or Bench cases.

The model keeps three descriptions separate:

- **exact entry point** — a named Kill Bill API or internal mechanism;
- **behavioral label** — stable language used by this DomainEval representation;
- **external consequence** — Provider or financial behavior that Kill Bill cannot establish.

## 2. 行为模型人工审阅入口

本节先用业务语言说明“命令怎样变成交易、交易怎样进入状态、失败怎样恢复”。第 3 节以后保留
精确入口、执行顺序、状态机、事件、失败矩阵和来源覆盖，供实现与证据审计使用。

### 2.1 一次直接支付操作的完整生命周期

```text
调用方提交支付命令
  → 解析 Payment / Transaction 身份
  → 校验 Account
  → 必要时先用 Janitor 重新观测 PENDING / UNKNOWN
  → 校验 external key、交易类型和已有未决状态
  → 判断当前 PaymentStateName 是否允许目标操作
  → 创建一条初始为 UNKNOWN 的 PaymentTransaction
     （首笔操作同时创建 Payment）
  → 根据 PaymentMethod.pluginName 找到 PaymentPluginPort
  → 调用 AUTHORIZE / CAPTURE / PURCHASE / CREDIT / REFUND / VOID
  → 把 Plugin 结果映射为 TransactionStatus 和 PaymentStateName
  → 更新 Payment 与 PaymentTransaction
  → 发布对应的内部 Payment 事件
  → 重新读取并返回 Payment 投影
```

这条顺序有两个重要例外：

- Account、key、币种或状态转换等前置检查失败时，不创建新 PaymentTransaction，也不发起支付操作；
  对已有 Payment 的 Janitor 查询可能在 key 等检查之前已经发生；
- 显式完成已有 PENDING 交易时，复用原 PaymentTransaction，不创建新交易，也不再次调用 Plugin。

因此，“Kill Bill 中已经存在一条交易记录”只证明编排记录已经建立，不证明 Provider 已收到或
完成该操作。

### 2.2 五类业务流程

| 流程 | 允许的主路径 | 人可读含义 |
| --- | --- | --- |
| 授权与扣款 | `AUTHORIZE → CAPTURE → CAPTURE…` | 成功授权后可以进行一次或多次扣款 |
| 授权撤销 | `AUTHORIZE → VOID` | 成功授权后可以发起撤销；成功 CAPTURE 后默认状态机不再允许 VOID |
| 直接购买与退款 | `PURCHASE → REFUND → REFUND…` | 直接购买成功后可以进行一次或多次退款 |
| 直接 CREDIT | `CREDIT → result` | CREDIT 可以作为初始操作；默认配置没有从 CREDIT_SUCCESS 出发的后续操作 |
| 未决与不确定恢复 | `PENDING → explicit completion`；`UNKNOWN → Janitor re-observation` | PENDING 可由可信调用方显式完成；UNKNOWN 必须重新观测，不能直接猜成成功或失败 |

此外，`CAPTURE_SUCCESS → REFUND` 也是允许路径。CHARGEBACK 与 reversal 在精确状态机中可见，但
仍属于邻接域，不进入上述活动流程。

### 2.3 每种操作共享的结果状态机

```text
<TYPE>_INIT
  ├── SUCCESS   → <TYPE>_SUCCESS
  ├── FAILURE   → <TYPE>_FAILED
  ├── PENDING   → <TYPE>_PENDING
  └── EXCEPTION → <TYPE>_ERRORED

<TYPE>_PENDING
  ├── SUCCESS   → <TYPE>_SUCCESS
  ├── FAILURE   → <TYPE>_FAILED
  └── EXCEPTION → <TYPE>_ERRORED
```

这里的 `<TYPE>` 分别是 AUTH、CAPTURE、PURCHASE、REFUND、CREDIT 和 VOID。精确 XML 没有定义
`PENDING → PENDING` 的完成转换；仍然未决时应保留 PENDING，而不是发明一个终态。

### 2.4 Plugin 结果如何成为 Kill Bill 状态

| Plugin 报告或异常 | Payment 状态后缀 | TransactionStatus | 内部事件类别 | 安全解释 |
| --- | --- | --- | --- | --- |
| `PROCESSED` | `_SUCCESS` | `SUCCESS` | `PaymentInfoEvent` | Kill Bill 记录为成功；不等于结算完成 |
| `PENDING` | `_PENDING` | `PENDING` | `PaymentInfoEvent` | Provider 结果尚未结束 |
| `ERROR` | `_FAILED` | `PAYMENT_FAILURE` | `PaymentErrorEvent` | Plugin 报告 Provider 处理并拒绝 |
| `CANCELED` | `_ERRORED` | `PLUGIN_FAILURE` | `PaymentPluginErrorEvent` | Plugin 报告操作未正常提交 |
| `UNDEFINED`、timeout、exception、非法空结果 | `_ERRORED` | `UNKNOWN` | `PaymentPluginErrorEvent` | 外部经济效果未知，不能归类为已失败 |

### 2.5 恢复不是重试

| 恢复方式 | 处理对象 | 是否新建交易 | 是否调用 Plugin | 所需权威 |
| --- | --- | --- | --- | --- |
| `CompletePendingExplicitly` | 一条已有 `PENDING` PaymentTransaction | 否 | 否 | 调用方必须持有 Kill Bill 之外的可信结果依据 |
| `JanitorRecovery` | 已有 `PENDING` 或 `UNKNOWN` 交易 | 否 | 是，调用 `getPaymentInfo` | Plugin 后续观测；不充分时继续保留不确定性 |
| 新的业务重试 | 上一次失败后发起的新操作 | 是 | 是 | external key、类型、币种与状态转换校验 |

Janitor 只重新观测已有经济操作，不会自动重新提交资金。新的业务重试与状态恢复是两种不同
行为，不能合并成一个“retry”概念。

### 2.6 本模型明确不作出的承诺

- 不承诺累计 CAPTURE 不超过 AUTHORIZE；
- 不承诺累计 REFUND 不超过 PURCHASE/CAPTURE；
- 不承诺退款一定回到原支付工具；
- 不承诺 external key 或 Account lock 能实现 Provider 侧 exactly-once；
- 不承诺内部事件构成完整且无遗漏的外部事件流；
- 不把 Kill Bill `SUCCESS` 等同于 Provider 结算、商户到账或会计闭合。

这些规则需要后续 Provider/Product/Observation Contract，而不能从 Kill Bill 编排实现中推出。

### 2.7 本轮确认点

1. 新直接操作在调用 Plugin 前创建 UNKNOWN Transaction，这一执行顺序是否作为领域行为保留；
2. 六类操作共享结果状态机，跨操作只允许第 8 节列出的链接，是否合理；
3. PENDING 显式完成、UNKNOWN Janitor 重新观测和新业务重试是否保持为三个不同概念；
4. 金额上限、资金最终性、Provider exactly-once 和事件完整性是否继续留在本 Module 之外。

## 3. Actors and responsibilities

| Actor | Behavioral role in this model | Does not establish |
| --- | --- | --- |
| `MerchantCaller` | Submits direct payment commands, identifiers, amount/currency and plugin properties | Provider acceptance or settlement |
| `KillBillPaymentCore` | Resolves identity and routing, performs sanity checks, selects state-machine operations, persists records and returns API outcomes | Provider-specific amount, mandate or financial rules |
| `PaymentAutomaton` | Evaluates state-machine and link-state-machine availability and maps an operation result to a final PaymentStateName | Provider truth or economic finality |
| `PaymentPlugin` | Implements `PaymentPluginApi`, calls or represents one Provider and returns `PaymentTransactionInfoPlugin` | Universal behavior of other Providers |
| `ExternalProvider` | Performs or rejects the external operation under its own contract | Kill Bill state persistence |
| `PaymentStore` | Persists Payment, PaymentTransaction, processed values, state names and audit history | Independent business authority |
| `InternalEventBus` | Receives a transaction-derived event category after the completion update path | Delivery to external consumers unless separately observed |
| `JanitorRecovery` | Re-queries plugin information and reconciles incomplete Kill Bill state | A new external payment attempt or automatic financial retry |

## 4. Commands and exact entry points

| Behavioral command | Exact entry point | Creates a new Payment? | Creates a new Transaction? | Calls Plugin? |
| --- | --- | --- | --- | --- |
| `AuthorizePayment` | `PaymentApi.createAuthorization` / direct REST payment create | when no Payment resolves | yes | `authorizePayment` |
| `PurchasePayment` | `PaymentApi.createPurchase` / direct REST payment create | when no Payment resolves | yes | `purchasePayment` |
| `CreditPayment` | `PaymentApi.createCredit` / direct REST payment create | when no Payment resolves | yes | `creditPayment` |
| `CapturePayment` | `PaymentApi.createCapture` / POST to an existing Payment | no | yes | `capturePayment` |
| `VoidPayment` | `PaymentApi.createVoid` / DELETE existing Payment | no | yes | `voidPayment` |
| `RefundPayment` | `PaymentApi.createRefund` / POST refunds | no | yes | `refundPayment` |
| `CompletePendingExplicitly` | `notifyPendingTransactionOfStateChanged` / PaymentTransaction REST action | no | no; reuses the PENDING transaction | no; core supplies the success/failure result |
| `ReadWithPluginInfo` | retrieve Payment with `withPluginInfo=true` | no | no | `getPaymentInfo` through on-the-fly Janitor |
| `RunScheduledJanitor` | Janitor notification task | no | no | `getPaymentInfo` |

`PaymentAttempt`-creating payment-control and automatic retry commands remain adjacent and are not
silently included by this table.

## 5. Common operation pipeline

For a new direct operation, the exact implementation follows this behavioral order:

```text
1. Resolve Payment identity from explicit ID, PaymentExternalKey or TransactionExternalKey.
2. If an existing Payment is involved, verify Account ownership.
3. Re-observe incomplete existing state through the on-the-fly Janitor when enabled.
4. Apply transaction-key, completion-candidate and transaction-type sanity checks.
5. Select the current state from the last successful Payment state.
6. Resolve PaymentMethod → PluginName and load the default or plugin-specific state-machine configuration.
7. Resolve the destination operation and any link-state-machine transition.
8. Refuse before Plugin invocation if no legal transition exists.
9. Leaving-state callback checks existing-transaction and currency consistency, then persists a new
   UNKNOWN PaymentTransaction; for the first operation it persists Payment and Transaction together.
10. Resolve PluginName → PaymentPluginPort and invoke the operation-specific method under the configured
    dispatch/lock path.
11. Translate PaymentPluginStatus to OperationResult and TransactionStatus.
12. Enter the result state and atomically update Payment/Transaction completion fields.
13. Post the corresponding internal payment event from the transaction update path.
14. Re-read and return the Payment projection.
```

For completion of an existing PENDING transaction, step 9 does not create another transaction. Explicit
completion also bypasses the Plugin invocation in step 10 and supplies a core success/failure result.

This ordering means “a Transaction record exists” is not proof that a Provider accepted or even received
the operation.

## 6. Per-operation result state machine

Each active TransactionType has the same result shape with a type-specific prefix:

```text
<TYPE>_INIT
  ├── OperationResult.SUCCESS   → <TYPE>_SUCCESS
  ├── OperationResult.FAILURE   → <TYPE>_FAILED
  ├── OperationResult.PENDING   → <TYPE>_PENDING
  └── OperationResult.EXCEPTION → <TYPE>_ERRORED

<TYPE>_PENDING
  ├── SUCCESS   → <TYPE>_SUCCESS
  ├── FAILURE   → <TYPE>_FAILED
  └── EXCEPTION → <TYPE>_ERRORED
```

Active prefixes are `AUTH`, `CAPTURE`, `PURCHASE`, `REFUND`, `CREDIT` and `VOID`.

The exact XML does not define `PENDING → PENDING` completion. A still-pending Provider observation stays
incomplete through Janitor handling rather than being treated as a new terminal transition.

## 7. Plugin result, persisted status and event category

| Plugin result or condition | Automaton result | Payment state suffix | TransactionStatus | Internal event category |
| --- | --- | --- | --- | --- |
| `PROCESSED` | `SUCCESS` | `_SUCCESS` | `SUCCESS` | `PaymentInfoEvent` |
| `PENDING` | `PENDING` | `_PENDING` | `PENDING` | `PaymentInfoEvent` |
| `ERROR` | `FAILURE` | `_FAILED` | `PAYMENT_FAILURE` | `PaymentErrorEvent` |
| `CANCELED` | `EXCEPTION` | `_ERRORED` | `PLUGIN_FAILURE` | `PaymentPluginErrorEvent` |
| `UNDEFINED`, timeout, exception or invalid null result | `EXCEPTION` | `_ERRORED` | `UNKNOWN` | `PaymentPluginErrorEvent` through the default branch |

For a new direct operation ending in `SUCCESS` or `PENDING`, missing Plugin amount/currency falls back to
the request-context values passed to `PaymentAutomatonDAOHelper`. Janitor instead passes the existing
Transaction's `processedAmount` and `processedCurrency` as defaults. Therefore recovery does not guarantee
restoration of the original requested amount when the Plugin omits it. Non-SUCCESS/PENDING statuses store
zero processed amount in this helper. Explicit completion constructs its Plugin result from the existing
processed values. The caller path must remain part of this statement.

These are Kill Bill projections. They do not determine Provider settlement or accounting treatment.

## 8. Cross-operation transition links

The exact `PaymentStates.xml` link-state machines permit these active operation-family transitions:

| Last successful state | Next operation initial state | Meaning inside Kill Bill |
| --- | --- | --- |
| `BIG_BANG_INIT` | `AUTH_INIT` | Start a Payment with AUTHORIZE |
| `BIG_BANG_INIT` | `PURCHASE_INIT` | Start a Payment with PURCHASE |
| `BIG_BANG_INIT` | `CREDIT_INIT` | Start a Payment with CREDIT |
| `AUTH_SUCCESS` | `CAPTURE_INIT` | Add a CAPTURE after successful authorization |
| `AUTH_SUCCESS` | `VOID_INIT` | Add a VOID after successful authorization |
| `CAPTURE_SUCCESS` | `CAPTURE_INIT` | Add another capture |
| `CAPTURE_SUCCESS` | `REFUND_INIT` | Add a refund after capture |
| `PURCHASE_SUCCESS` | `REFUND_INIT` | Add a refund after purchase |
| `REFUND_SUCCESS` | `REFUND_INIT` | Add another refund |

The source also contains links involving CHARGEBACK and reversal; both remain adjacent and are not copied
into the active transition model.

There is no active outgoing link from `CREDIT_SUCCESS` or `VOID_SUCCESS` in the exact default
configuration. This is an implementation-specific absence, not a universal payment rule.

## 9. Business flow A — authorize, capture and void

### A1. Authorization succeeds, then one or more captures

```text
MerchantCaller       KillBillPaymentCore       PaymentPlugin       PaymentStore/EventBus
      │ AuthorizePayment(amount, currency, keys)     │                       │
      ├──────────────────────→│                       │                       │
      │                       │ persist Payment + AUTH Transaction UNKNOWN   │
      │                       ├──────────────────────────────────────────────→│
      │                       │ authorizePayment ─────→│                     │
      │                       │←──── PROCESSED + processed money             │
      │                       │ persist AUTH_SUCCESS / SUCCESS + InfoEvent   │
      │←──────── Payment ─────┤                       │                       │
      │ CapturePayment(partial amount, new tx key)   │                       │
      ├──────────────────────→│ capturePayment ───────→│                    │
      │                       │←──── result            │                    │
      │←──────── Payment with new CAPTURE Transaction───────────────────────│
```

Preconditions for CAPTURE:

- Payment resolves to the same Account;
- last successful state permits CAPTURE (`AUTH_SUCCESS` or `CAPTURE_SUCCESS`);
- currency matches the first transaction for this active path;
- the transaction key passes operation/outcome-specific sanity checks;
- unresolved UNKNOWN state must first be revisited by Janitor.

Multiple capture transactions are permitted. The core state links do not establish a cumulative capture
ceiling; Provider/Product authority must supply that rule.

### A2. Authorization succeeds, then void

`AUTH_SUCCESS → VOID_INIT` is permitted. VOID creates a new Transaction and calls the plugin. The same
result mapping applies. The model does not claim that an external authorization hold was released without
Provider evidence.

The default active links do not permit VOID after `CAPTURE_SUCCESS`.

## 10. Business flow B — purchase and refunds

```text
PurchasePayment
  → create Payment + PURCHASE Transaction
  → invoke purchasePayment
  → PURCHASE_SUCCESS / SUCCESS
  → RefundPayment
  → create REFUND Transaction
  → invoke refundPayment
  → REFUND_SUCCESS / SUCCESS
  → optional further RefundPayment from REFUND_SUCCESS
```

The model establishes only Kill Bill's orchestration path:

- PURCHASE may start a Payment;
- REFUND may follow successful PURCHASE or CAPTURE;
- multiple successful REFUND operations may be appended;
- deleted PaymentMethod records may still be included for VOID/REFUND plugin resolution.

The model does not establish refund eligibility, cumulative refund ceilings, original-tender return or
external financial completion. Payment Test Plugin `8.0.1` is also unsuitable as the successful-refund
runtime oracle because of its recorded null amount/currency defect.

## 11. Business flow C — direct credit

```text
CreditPayment
  → create Payment + CREDIT Transaction
  → invoke creditPayment
  → CREDIT_SUCCESS | CREDIT_PENDING | CREDIT_FAILED | CREDIT_ERRORED
```

CREDIT shares the initial-operation, Plugin and result-state machinery. The default active links provide
no later operation from `CREDIT_SUCCESS`.

This model does not equate CREDIT with REFUND, accounting credit, wallet funding or settlement.

## 12. Business flow D — explicit PENDING completion

```text
Initial or subsequent operation
  → Plugin returns PENDING
  → existing Transaction becomes PENDING
  → PaymentInfoEvent is posted
  → trusted caller later invokes CompletePendingExplicitly(transactionId, SUCCESS|FAILURE)
  → core verifies the transaction is PENDING
  → no new Transaction and no Plugin call
  → same Transaction becomes SUCCESS or PAYMENT_FAILURE
  → Payment state and event category are updated
```

Guards:

- completion by transaction ID/key must resolve one candidate;
- requested completion TransactionType must match the existing transaction;
- a second unrelated PENDING initial AUTHORIZE/PURCHASE/CREDIT is rejected while one is unresolved;
- explicit completion authority and the external evidence behind it are not established by Kill Bill and
  require a later Observation/Product Contract;
- unresolved UNKNOWN cannot use the direct pending-completion path.

## 13. Business flow E — UNKNOWN and Janitor recovery

```text
Plugin timeout / exception / UNDEFINED / invalid null result
  → TransactionStatus UNKNOWN
  → Payment state <TYPE>_ERRORED
  → PaymentPluginErrorEvent
  → later trigger:
       a) scheduled Janitor notification, or
       b) ReadWithPluginInfo, or
       c) a new operation against the existing Payment
  → getPaymentInfo on the same PaymentPlugin
  → compare later plugin observations with incomplete Transactions
  ├── sufficient updated result → reconcile existing state
  └── still unknown/incomplete  → preserve uncertainty
```

On-the-fly Janitor runs before a new operation against an existing Payment. If UNKNOWN cannot be resolved,
the core refuses completion of that UNKNOWN transaction when selected by its transaction ID/key. This is
not a global guard against every newly keyed operation; the identity selection and operation matter.

Default polling delays documented for the deployment are configuration values, not semantic invariants.
Janitor recovery is re-observation of an existing operation, not automatic resubmission of funds.

### E1. PURCHASE 超时后的场景推演（静态来源分析）

前提：同一个 Account 下已有 Payment P 和 PURCHASE Transaction T，事务 key 为 K。core 已把
T 记录为 UNKNOWN。客户端超时本身不证明这些记录存在，也不证明扣款失败；应先解析原记录。
本节没有运行真实 Plugin，没有生成运行时判分结果。

| 查询后的情况 | 现有 core 行为 | 调用方可据此作出的判断 |
| --- | --- | --- |
| 单纯读取记录，`withPluginInfo=false` | 该读取路径不获取 Plugin 交易信息、不触发此处的状态修正 | 看到旧 UNKNOWN 不等于 Provider 没有后续结果 |
| `withPluginInfo=true`，返回与 T 匹配的 PROCESSED | Janitor 可把同一 T 修正为 SUCCESS | 查看恢复后的金额/币种及来源，不能只凭状态认定原金额已完成 |
| 返回 PENDING | UNKNOWN 可变成 PENDING；已有 PENDING 再收到 PENDING 时不写更新 | 可以继续查询/等待；该局部事实不证明调度或外部事件流完全一致 |
| 没有匹配 T 的结果，或结果仍不确定 | 没有可用修正时保留已有不确定状态 | 查询缺失不是支付失败证据 |
| 同 key K 再发 PURCHASE，查询后 T 仍为 UNKNOWN | completion-candidate 检查拒绝该操作 | 这条保护绑定原交易身份；不能推广为所有重试都安全 |
| 同 key K 再发 PURCHASE，查询后 T 已是 SUCCESS | successful-key 检查拒绝重复 key | API 拒绝不意味着原支付失败，应读回 T 的状态 |
| 同 key K 再发 PURCHASE，查询后 T 是 PENDING | 复用 T，但普通操作路径仍可调用 `purchasePayment` | 同 key、同一 Transaction 不等于只查询或只调用一次 Provider |
| 换新 key/新 Payment 再发起支付 | 可能成为另一项操作，无法凭旧 K 的保护推导结果 | 需要产品与 Provider 的重试策略，不能从本模块承诺无重复经济效果 |

只有专门的 `notifyPendingPaymentOfStateChanged` 显式完成入口使用 override 并绕过操作插件；普通
PURCHASE 不具备这个前提。查询 Plugin 的 `getPaymentInfo` 本身仍受该 Plugin 契约约束。

金额反例（源码推导，未运行）：请求 100 CNY 的交易在异常路径被写成 UNKNOWN、processedAmount=0；
若后续匹配观测为 PROCESSED 却没有 amount，Janitor 把已有 processedAmount=0 作为默认值传给 helper，
因此可能形成 SUCCESS 与处理金额 0 并存。它不能被解释成已完成原请求的 100 CNY。

精确来源均为 core commit `5da9650de60b2fa83dea556d7e95c70b79dabd39`，保存在 `../sources/core.json`：

- `PaymentAutomatonRunner.retrievePaymentId/run`：定位原 Payment，选择状态机；
- `PaymentProcessor.performOperation/runSanityOnTransactionExternalKey/findTransactionToCompleteAndRunSanityChecks`：先查询、再判断 key 与完成候选；
- `PaymentRefresher.toPayment/invokeJanitor`：有无 Plugin 信息的读取区别及匹配后的更新；
- `IncompletePaymentTransactionTask.updatePaymentAndTransactionInternal`：同状态不写更新，以及使用已有 processed money 默认值；
- `PaymentOperation.doOperation`、`PurchaseOperation.doCallSpecificOperationCallback`、`PurchaseInitiated` 与 `PaymentLeavingStateCallback.leavingState`：复用 T 与再次调用插件可以同时发生；
- `PaymentAutomatonDAOHelper.processPaymentInfoPlugin`：新直接操作与恢复调用传入不同默认值。

本场景说明模型已能区分身份、命令、查询、状态与金额；尚缺具体 Plugin 的查询完整性/幂等语义，
以及调用方允许重试的产品规则。四条 unknown 不因本次推演整体升级。

### E2. Stripe Plugin 8.0.4 的具体边界与重试决策

这里对照具体适配器来检验 E1 的假设。它是有版本限制的场景分析，不是新增通用支付规则或把
Stripe Provider 语义合并进核心 Module 的 16 条 Claim；本轮没有运行支付、测试或修改插件代码。

#### 版本与来源

- Plugin 固定为 [`stripe-plugin-8.0.4`](https://github.com/killbill/killbill-stripe-plugin/tree/7c5577920a6fa23e1cd40aeee163ff8da14d8b74)。[README](https://github.com/killbill/killbill-stripe-plugin/blob/7c5577920a6fa23e1cd40aeee163ff8da14d8b74/README.md) 声明 8.0.y 对应 Kill Bill 0.24.z；未进行实际组合运行验证。
- [Plugin POM](https://github.com/killbill/killbill-stripe-plugin/blob/7c5577920a6fa23e1cd40aeee163ff8da14d8b74/pom.xml) 固定 stripe-java 21.15.0，并继承 parent 0.146.63；[该 parent](https://github.com/killbill/killbill-oss-parent/blob/1e0f74f1acac5c11d8790480c86119ad3d93b3dd/pom.xml) 固定 base-plugin 5.1.9、Kill Bill API 0.54.0、Plugin API 0.27.3。
- SDK 精确 commit 为 `8013108073a5ca1d5e11b462e9b6ba3dc5a6ed81`。[ApiVersion](https://github.com/stripe/stripe-java/blob/8013108073a5ca1d5e11b462e9b6ba3dc5a6ed81/src/main/java/com/stripe/ApiVersion.java) 实际指定 `2022-08-01`，而 Plugin README 表格仍写 `2020-08-27`；本分析按 SDK 和 RequestOptions 的默认路径解释版本，不把 README 表格当作实际请求头证据。
- Stripe 官方说明按本次查阅时内容使用，链接在下文；未取得可代表该旧 API 版本历史行为的文档快照，亦未把当前说明倒填为历史事实。下述代码链接为精确版本链接，本节新增外部资料没有加入核心源码快照集。

#### 身份与幂等键怎样传递

`K` 表示 Kill Bill external key，`T` 表示 Kill Bill Transaction UUID，`J` 表示 Stripe HTTP 幂等键。
三者是不同的值，不能只因为谈的是同一笔支付就假定相等。

| 位置 | 精确源码中的行为 | 可以和不能推出的结论 |
| --- | --- | --- |
| `StripePaymentPluginApi.purchasePayment`，696–713 行 | 按 T 和 tenant 更新/查找本地 response；有记录就返回，没有才进入 PaymentIntent 创建 | 可短路一种顺序重复调用；不证明丢失记录或并发时不会重复提交 |
| `executeInitialTransaction`，858–981 行 | 创建 PaymentIntent，metadata 包含 kbTransactionId=T；随后保存 response | metadata 用于关联；未见把 K/T 显式设置为 J |
| `StripeConfigProperties.toRequestOptions` | 设置 timeout、API key 等，但不调用 setIdempotencyKey | 必须继续看 SDK，不能断言线上请求没有幂等 header |
| stripe-java `StripeRequest.buildHeaders`，197–202 行 | 若未显式传入幂等键，POST 使用随机 UUID | 有 HTTP 幂等键，但新的请求对象不保证沿用上一次 J；本地 T 不自动成为稳定重试键 |

来源：[Plugin API](https://github.com/killbill/killbill-stripe-plugin/blob/7c5577920a6fa23e1cd40aeee163ff8da14d8b74/src/main/java/org/killbill/billing/plugin/stripe/StripePaymentPluginApi.java#L696)、[配置](https://github.com/killbill/killbill-stripe-plugin/blob/7c5577920a6fa23e1cd40aeee163ff8da14d8b74/src/main/java/org/killbill/billing/plugin/stripe/StripeConfigProperties.java)、[SDK 请求头](https://github.com/stripe/stripe-java/blob/8013108073a5ca1d5e11b462e9b6ba3dc5a6ed81/src/main/java/com/stripe/net/StripeRequest.java#L197)。

Stripe 当前[幂等请求说明](https://docs.stripe.com/api/idempotent_requests)要求重试复用同一键与相同
参数；键可在至少 24 小时后清理，清理后复用可能成为新请求。[错误处理说明](https://docs.stripe.com/error-low-level)
区分网络错误与 500：500 仍可能产生效果，不能通过换键把它当作从未发生。本插件的本地重复记录
保护并不足以证明这条 Provider 重试契约已经贯通。

#### getPaymentInfo 实际上会做什么

| Plugin 已有记录的状态 | 具体行为 | 对 E1 的修正 |
| --- | --- | --- |
| 本地 response 为空 | 父类从 dao.getResponses 读取，子类直接返回空列表 | 不会凭空找到“Stripe 已接受但本地未保存”的 PaymentIntent；本地空不代表 Provider 没有交易 |
| PENDING | retrieve PaymentIntent；requires_confirmation 时调用 confirm；满足配置下的 3DS 失败条件时可能 cancel；之后更新本地 response | 名为查询的方法可以发出 Provider 写操作，不能承诺纯读取 |
| UNDEFINED | 用 metadata[kbTransactionId] 搜索 Charge；返回列表只有一条且带 PaymentIntent 时 retrieve 并更新 | 此处判断的是返回列表条数；搜索结果不能替代完整性保证 |
| UNDEFINED 且搜索为空 | 写本地 overriddenTransactionStatus=CANCELED | 这是本地推断，不是对原 PaymentIntent 执行取消，更不是证明未扣款 |
| Stripe 查询异常 | 记录 warning，可能返回旧交易列表 | 正常返回列表不保证数据已刷新 |

来源：[父类数据库读取](https://github.com/killbill/killbill-plugin-framework-java/blob/a854894c67a5f3737753ce36dcbd4c24a6274516/src/main/java/org/killbill/billing/plugin/api/payment/PluginPaymentPluginApi.java#L92)、[Plugin getPaymentInfo](https://github.com/killbill/killbill-stripe-plugin/blob/7c5577920a6fa23e1cd40aeee163ff8da14d8b74/src/main/java/org/killbill/billing/plugin/stripe/StripePaymentPluginApi.java#L136)。

Stripe 当前[Charge 搜索契约](https://docs.stripe.com/api/charges/search)明确告知不要将 Search 用于要求
严格一致性的写后读；通常有短暂延迟，故障时延迟可能更长。因此，“搜索为空→本地 CANCELED→core
PLUGIN_FAILURE→允许新的业务尝试”有把未确认结果过早变成重试依据的风险。这里指出的是代码与
当前 Provider 说明之间的条件缺口，未声称已经复现重复扣款。

金额也需要区分来源：[StripeDao.addResponse/updateResponse](https://github.com/killbill/killbill-stripe-plugin/blob/7c5577920a6fa23e1cd40aeee163ff8da14d8b74/src/main/java/org/killbill/billing/plugin/stripe/dao/StripeDao.java#L182)
初始保存请求 amount/currency，刷新路径更新 additional_data；[TransactionInfoPlugin.build](https://github.com/killbill/killbill-stripe-plugin/blob/7c5577920a6fa23e1cd40aeee163ff8da14d8b74/src/main/java/org/killbill/billing/plugin/stripe/StripePaymentTransactionInfoPlugin.java#L48)
从这些本地列填充金额。字段齐全不等于本次已重新核对 Stripe 实际处理金额，E1 的通用零默认值
反例也不能不加条件地宣称在此插件路径必然出现。

#### 本场景的使用决策（建议，非已部署策略）

| 已掌握的证据 | 建议动作 |
| --- | --- |
| 已知且可靠关联的 PaymentIntent ID | 优先按该 ID 核对对象状态、账号/环境、金额和币种；查询路径需有清晰副作用边界 |
| 只有本地 UNKNOWN、CANCELED、查询异常或 Search 空结果 | 保留业务上的“结果待查”，不据此自动另建扣款 |
| 保存了第一次实际 Stripe 请求的 J、原参数与上下文，且适用幂等窗口 | 可依据 Stripe 对相同请求的重试契约设计重试；尚需确认适配器能复用这些数据 |
| 缺少上述身份/键/完整性证据 | 持续核对已有操作或人工处理；延迟多久、何时终止由明确的产品策略定义 |

本 profile 支持的结论是：该版本可用于研究查询、恢复与重试的边界，现有证据不足以把它作为
“UNKNOWN 后可自动安全重扣”的参考实现。后续应先明确业务重试许可所需证据，以及查询可能执行
confirm/cancel 时的责任，再决定是否修改或选择另一个适配器。

### E3. PURCHASE 超时恢复决策契约（候选）

本节把 E1/E2 的事实转成应用侧可审阅的决策约定。契约 ID 为 `purchase-timeout-recovery`，版本为
`0.1.0-candidate`。它是建议的产品行为，尚未实现；不属于 Kill Bill 原生行为，也不作为 16 条 core
Claim 的新真值。它没有被伪装成已编译的 Domain View/Product Contract；当前只作为固定人读文档
保留在候选包中。

**目的。** 对一笔已经提交、结果尚未确认的 PURCHASE，决定下一步是核对原交易、等待、记录已有
结果、重发同一 Provider 请求，还是转人工。它不授权新建另一笔扣款，不自动执行 confirm/cancel。

#### 必要输入与责任

| 输入 | 描述 | 缺失时如何处理 |
| --- | --- | --- |
| `operation_ref` | 商户侧原购买意图的稳定引用；将多个网络调用关联回同一业务意图 | 不自动发起写操作，先找回原意图 |
| `execution_context` | Kill Bill tenant/account、Provider account、test/live 模式、API 版本与原操作类型 | 不假定同一 key 在不同账号或环境中指向同一请求 |
| `core_refs` | 原 Payment ID、Transaction ID T、external key K 与已记录状态 | 状态只能描述 core 记录；K 不替代 Provider 幂等键 J |
| `provider_ref` | 原 PaymentIntent/Charge ID 及其与 operation_ref、T 的关联依据 | Search 同金额或相似记录不能自动成为可靠身份绑定 |
| `original_request` | 实际发送的 method、endpoint、参数指纹、Provider 幂等键 J、首次发送时间；敏感凭据不进入此契约 | 缺失 J 时不能补一个新键冒充原请求；指纹不能从当前重新生成的请求倒推 |
| `observations` | 每条状态、实际处理金额/币种的字段语义与来源、对象 ID、HTTP/网络错误类别、观测时间、事件时间或版本及证据引用 | 不以请求金额代替处理金额，不以本地行、Search 空结果或旧事件推断原操作没发生 |
| `query_capability` | 将要调用的方法，以及已明确的副作用：read-only / may-confirm / may-cancel / unknown | 未知或带写副作用的方法不自动作为核对动作执行 |
| `retry_capability` | 适配器能否原样复用 J、endpoint、参数与 Provider 上下文 | 仅“SDK 支持幂等”或“同 K 重调 PURCHASE”不满足 |
| `retry_policy` | 针对此 Provider 的保留窗口依据、观测有效期、次数预算、退避、截止条件与相应产品策略引用 | 不发明通用次数/等待时长；缺少策略时不自动重放 |
| `coordination` | 同一 operation 是否有其他本地发送者正在写入，以及执行前的单一调度责任 | 未协调好本地并发发送时不发出自动重放许可；不由此推断原 Provider 请求已停止 |

调用方负责业务意图、原始请求记录和执行协调；适配器负责如实说明查询副作用与 J 复用能力；
Provider 对其请求、对象和幂等契约负责；产品负责人决定预算与等待策略。人工接手也必须保留
证据，不能把“人工点击”作为原操作未发生的证明。

#### 可返回的六种决策

| decision | 含义与允许动作 | 明确禁止 |
| --- | --- | --- |
| `RECORD_ORIGINAL_SUCCESS` | 已可靠确认原对象成功，且对象绑定、金额、币种、账号/环境与原意图吻合；记录原结果 | 再发 PURCHASE；直接推断结算到账 |
| `OBSERVE_ORIGINAL` | 已有可靠 Provider 对象身份，选择已确认只读的按 ID 核对方法 | 把 may-confirm/may-cancel 方法伪装成读取 |
| `WAIT_FOR_EVIDENCE` | 暂无充分结果，按明确的观察/等待条件继续核对，或等待适用事件 | 用超时、Search 空结果、本地 CANCELED 自动判为可重扣 |
| `REPLAY_ORIGINAL_REQUEST` | 满足下列全部重放条件，可重发原 Provider 请求，保持同一个 J 和参数 | 新 key、新 Payment 或以普通 PURCHASE 重调替代原请求重放 |
| `RECONCILE_REQUIRED` | 身份/金额/证据冲突、无法安全核对或缺少执行前提；交由有责任的处理者补证据 | 自动选择一个方便的状态继续扣款 |
| `NEW_OPERATION_OUT_OF_SCOPE` | 原操作已被可靠判定结束，业务仍想发起新的支付；转交独立业务流程 | 把恢复契约当成新扣款授权 |

#### 判定顺序与重放条件

先检查身份和证据一致性。不同对象、账号、模式、金额/币种不匹配，或无法解释的互斥观测，返回
`RECONCILE_REQUIRED`。较早的 PENDING 与较新的成功可以是正常状态演进，不应机械当成冲突；
无法判明顺序/来源时，不能靠事件到达先后来覆盖结果。

已可靠确认原操作成功时返回 `RECORD_ORIGINAL_SUCCESS`。core 的 UNKNOWN 或旧镜像不覆盖可靠的
原 Provider 对象结果；必要的 core 镜像修正是另外的受控动作。

其余情况下，若有可靠对象 ID 与明确只读方法，且还没有符合观测有效期的结果，优先
`OBSERVE_ORIGINAL`。一次查询后重新判定，不能仅因“可以查询”就无限循环。收到 Provider 的未决、
requires_action 或 requires_confirmation 状态时保持待处理；需要用户动作或 Provider 写操作的
分支交给相应业务流程，不在本契约内暗中确认/取消支付。

`REPLAY_ORIGINAL_REQUEST` 只针对结果不确定的原请求，以下条件必须同时满足：

1. 原意图与 Provider 上下文绑定完整；原请求不是已知成功或已知需另行用户动作的操作；
2. 保留了第一次实际请求使用的 J 和原参数；method、endpoint、参数与上下文仍相同；
3. 已有适用于该 Provider/版本的重放规则，并有依据证明尚在原键的保证保留窗口内；
4. 此次错误类别适用该规则；不能把 500、认证/参数错误等一律套成可重试网络错误；
5. 执行适配器能够原样复用 J；本地相同 T/K 或 SDK 为新请求生成随机 J 不满足；
6. 没有另一个并发重放的本地发送者，次数/退避/截止条件满足，当前业务授权仍有效。

第 6 项约束执行方协调；原 Provider 请求是否仍在执行可能恰好未知，这由同 J 请求的 Provider
契约处理。不能为了“证明原请求已停止”去猜测超时意味着失败。

`unknown` 输入不会自动按 true 处理。如果暂缺证据且存在明确的等待/补证路径，返回
`WAIT_FOR_EVIDENCE`；无法安全核对或预算已耗尽时返回 `RECONCILE_REQUIRED`。本候选没有设定默认
重试次数或等待秒数，避免把未知策略包装成行业常量。

Stripe 的窗口、相同请求和错误类别依据见 E2 的官方说明；E3 的查询优先、自动动作边界和责任
分配属于本候选策略建议，不声称由 Stripe 或 Kill Bill 替商户作出。

#### 每次决策留下什么

```text
RecoveryDecision {
  contractRef                 // 本候选版本及包摘要
  operationRef, contextRef    // 原意图与执行上下文
  decision, reasonCodes       // 上面六种决策及理由
  allowedAction              // 具体对象/原请求引用；不包含任意命令
  evidenceRefs, missingFacts  // 使用的证据与尚缺信息
  decidedAt, recheckBefore    // 决策时间与执行前需要重新核对的条件
}
```

这只是输出形状定义，当前没有写入任何真实运行决策。每次写操作执行前要重新核对最新结果、
并发占用和策略预算；新 Provider 结果、请求参数变化、窗口截止或意图撤回都使旧重放许可失效。
执行仍使用同一个 J；即便重放得到成功响应，也必须核对它与原意图的关联，而不是创建第二项业务。

#### 四个可读示例（不是新增测试）

| 输入事实 | 候选决策 | 为什么 |
| --- | --- | --- |
| core=UNKNOWN，只知道 K；未保存 J，也没有可靠 PaymentIntent ID | `WAIT_FOR_EVIDENCE`；无补证路径则 `RECONCILE_REQUIRED` | 无法安全定位或重放，不能现造 J |
| Plugin 因 Charge Search 空结果标了本地 CANCELED | `WAIT_FOR_EVIDENCE` | 缺少严格完整性证据，不能确认原操作没发生 |
| 原 PaymentIntent 已可靠关联且成功，Provider 明确的处理金额为 100 CNY，与原意图一致 | `RECORD_ORIGINAL_SUCCESS` | 使用处理金额而非仅请求金额；不再创建扣款，也不推断结算 |
| 原请求网络结果不明，J/参数/账号齐全且在适用窗口，预算与协调满足，适配器能复用 J | `REPLAY_ORIGINAL_REQUEST` | 这是相同 Provider 请求的有条件重放 |

根据 E2，当前研究的 Stripe Plugin 8.0.4 不能仅凭其普通 PURCHASE/getPaymentInfo 接口满足上述
自动重放许可：稳定 J 复用与只读查询边界尚未贯通。落地前应先提供这两种明确能力，再补具体
产品预算与原始请求留存；不能只靠调整重试次数弥补这些缺口。

## 14. Failure, retry and key behavior

| Condition | Core behavior | New Transaction? | Safe interpretation |
| --- | --- | --- | --- |
| Invalid cross-operation transition | Refuse with `PAYMENT_INVALID_OPERATION` before Plugin invocation | no | Requested operation is not allowed by exact state configuration |
| Payment belongs to another Account | Refuse before operation | no | Account isolation failed |
| Currency differs from first transaction | Refuse for active non-chargeback path | no | Payment transaction currencies must match in this implementation path |
| Existing successful transaction uses same transaction key | Refuse, except adjacent chargeback reversal handling | no | Prevents one class of duplicate success; not universal exactly-once |
| Existing PENDING/UNKNOWN uses same key | Resolve existing Payment and consider completion/recovery rules | normally no when completing | Key correlates with an incomplete operation |
| Existing PAYMENT_FAILURE/PLUGIN_FAILURE | A later call may retry from the last successful Payment state if other guards pass | yes for a new attempt transaction | Failure does not erase the last successful state |
| Plugin `ERROR` | Persist PAYMENT_FAILURE / `_FAILED` | yes | Provider processed and rejected according to plugin report |
| Plugin `CANCELED` | Persist PLUGIN_FAILURE / `_ERRORED` | yes | Plugin reports operation was not submitted |
| Plugin outcome unknown | Persist UNKNOWN / `_ERRORED` | yes | External economic effect remains indeterminate |
| Registered Plugin service cannot be resolved during the operation callback | Persist an errored/UNKNOWN transaction through the exception path | yes | Missing adapter is not Provider failure evidence |
| Sanity, transition or leaving-state failure before transaction creation | Return an error; direct API has no transaction-derived event to rely on | no | Absence of Transaction is not Provider failure evidence |

The dispatch path can use an Account lock to serialize core work for that Account. This controls Kill Bill
concurrency only; it does not serialize Provider systems or prove external idempotency.

## 15. Time model

| Time concept | Source field/trigger | Behavioral meaning | Limitation |
| --- | --- | --- | --- |
| `recorded_at` | Entity created/updated dates from internal call context | When Kill Bill persisted or updated its record | Not Provider processing time |
| `effective_at` | requested effective date, defaulting to core `utcNow` when absent | Business-effective time stored on Transaction | Caller/provider correctness not established |
| `provider_observed_at` | plugin result created/effective dates | Time claimed by the Plugin observation | Requires Provider authority to trust externally |
| `recovered_at` | Janitor or explicit completion update time | When Kill Bill changed its knowledge/state | Does not rewrite when the external effect occurred |
| `poll_due_at` | Janitor notification schedule | Earliest configured re-observation opportunity | Configuration-dependent and not guaranteed execution time |

These times must remain separate. A later Observation Contract must define lateness, ordering and
completeness before a hard verdict may use absence or timing.

## 16. Exact internal event projection

| TransactionStatus after completion update | Exact event class family | What consumers may infer |
| --- | --- | --- |
| `SUCCESS`, `PENDING` | `DefaultPaymentInfoEvent` | Kill Bill persisted an informational payment result with that status |
| `PAYMENT_FAILURE` | `DefaultPaymentErrorEvent` | Kill Bill persisted a provider-decline category |
| `PLUGIN_FAILURE`, `UNKNOWN` and default branch | `DefaultPaymentPluginErrorEvent` | Kill Bill persisted plugin/incomplete error information |

The DAO posts these events from the transaction update path. Event class and persisted status remain
different facts. External delivery, subscriber processing and exactly-once consumption are outside this
model unless separately observed.

## 17. Source-to-behavior coverage

| Behavior family | Primary exact source surfaces |
| --- | --- |
| Command and Plugin entry points | `KB-API-0.54.0`, `KB-PLUGIN-API-0.27.3`, direct API docs |
| Per-operation outcome transitions | `KB-CORE-0.24.21:PaymentStates.xml`, `PaymentStateMachineHelper` |
| Cross-operation links | `KB-CORE-0.24.21:PaymentStates.xml`; `KB-COMMONS-0.26.15:DefaultState` |
| Create-before-call ordering | `PaymentLeavingStateCallback`, `PaymentAutomatonDAOHelper` |
| Result mapping and persistence | `PaymentOperation`, `PaymentTransactionInfoPluginConverter`, `PaymentAutomatonDAOHelper` |
| Transaction-derived event category | `DefaultPaymentDao` and payment event classes |
| Pending completion | `TransactionResource`, `PaymentProcessor`, completion tests |
| UNKNOWN and Janitor | payment-state docs, `PaymentRefresher`, Janitor tasks and tests |
| External-key and retry sanity | `PaymentAutomatonRunner`, `PaymentProcessor`, key-sanity tests |
| Time fields | locked API interfaces and core DAO models |

This table establishes source coverage, not Claim confirmation.

## 18. Open behavioral questions

| Question ID | Question | Current treatment | Required later evidence |
| --- | --- | --- | --- |
| `BQ1 aggregate-boundary` | Do all consistency rules close at Payment? | Retain aggregate candidate | Behavioral mutation and persistence tests |
| `BQ2 plugin-missing` | Which exact API/error/event shapes occur for every missing/deleted Plugin case? | Keep fail-closed, not fully generalized | Dedicated static/test extraction |
| `BQ3 pending-again` | How should a Plugin that repeatedly reports PENDING be exposed to consumers? | Preserve PENDING; no invented terminal transition | Janitor configuration and observation contract |
| `BQ4 retry-versus-resubmit` | Which caller retries reuse a Transaction versus create a new one? | Separate completion from new retry transaction | Per-operation key/outcome tests |
| `BQ5 credit-consumer` | Is standalone CREDIT meaningful to downstream users without Provider semantics? | Keep Kill-Bill-specific | Consumer use case during Landscape composition |
| `BQ6 event-completeness` | Can internal payment events be treated as a complete observation feed? | No | Persistent-bus and subscriber completeness evidence |
| `BQ7 account-lock` | What concurrency properties hold across nodes and Provider calls? | Core-local/account-scoped only | Deployment and distributed-lock evidence |
| `BQ8 money-limits` | Where are capture/refund amount ceilings enforced? | Outside this Module | Provider/Product Contract and observations |

## 19. Behavioral Model acceptance gate

Accepting this candidate means agreeing that:

1. the common pipeline creates/persists a new Transaction before Plugin invocation, except completion of
   an existing PENDING transaction;
2. operation outcome state and TransactionStatus are separate but deterministically related in the exact
   default configuration;
3. active cross-operation links are limited to the exact table in section 8;
4. multiple capture/refund operations are representable without inventing amount ceilings;
5. explicit PENDING completion reuses the existing Transaction and requires external authority not
   supplied by Kill Bill;
6. UNKNOWN recovery is re-observation through Janitor, not automatic economic retry;
7. failed new transactions may be retried from the last successful state subject to key/type/currency
   guards;
8. account locking and external keys constrain core concurrency but do not prove Provider exactly-once;
9. internal event categories do not prove external event-feed completeness;
10. all Provider financial effects, amount limits and settlement consequences remain outside;
11. the eight open questions remain explicit rather than silently resolved;
12. after acceptance, the next artifact is a Claim Ledger candidate only; Product Contract, Observation
    Contract and Bench remain unauthorized.

Reject or amend any item before Claim construction. Acceptance does not publish a Domain Release.
