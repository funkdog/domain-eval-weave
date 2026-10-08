---
feature_ids: []
topics: [payments, kill-bill, semantic-model, identity, domain-modeling]
doc_kind: semantic-model
created: 2026-09-02
version: 0.2.0
status: accepted-semantic-model
decision_provenance: thread_msx25fw48rony7bs
scope_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-scope-declaration.md
  accepted_commit: 177d892e488f3304ddf0a1201ff4eaba9a5c0181
source_matrix_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-source-feasibility-matrix.md
  accepted_commit: 6fd2fd2cb0a4e0d471ce7af96852f5274f25d411
  operator_message_id: 0001788341725109-000061-2bd763ba
semantic_acceptance_history:
  - accepted_at: 2026-09-02
    operator_message_id: 0001788343112984-000075-20e0cc2e
    accepted_scope: concept-vocabulary-relations-and-definitional-invariants
    superseded: true
    superseded_by_message_id: 0001788408548774-000149-10ae300d
structural_repair:
  issue_message_id: 0001788408548774-000149-10ae300d
  process_confirmation_message_id: 0001788408754373-000152-0ba52537
  authorization_message_id: 0001788409229977-000157-d07eec01
  behavior_acceptance: resumed-for-review
semantic_acceptance:
  accepted_at: 2026-09-03
  operator_message_id: 0001788419988271-000189-92337bf0
  accepted_model_commit: bb3e547b62e35f97b5293b4d9f0a42bf6a0df6ce
  gate: all-fourteen-items
  authorized_next_stage: behavioral-model-review
behavioral_model_ref:
  path: packages/weave/examples/killbill-orchestration/docs/killbill-payment-orchestration-behavioral-model.md
  accepted_model_commit: 662dbba3133939b20a354335b710f437948e4106
  acceptance: accepted-behavioral-model
  operator_message_id: 0001788420387857-000196-465a2f00
---

# Kill Bill Payment Orchestration Semantic Model v0.2

## 1. Purpose and modeling discipline

This candidate gives stable language, formal structures, identity, relations and definitional invariants
to the accepted `payments.orchestration.killbill` Model Context.

The operator accepted the v0.1 vocabulary, relations and definitional-invariant gate on 2026-09-02, then
reopened the stage after identifying that the artifact did not contain a concentrated formal definition
of entity fields, types, nullability and data roles. Version 0.2 preserves the accepted vocabulary while
adding that missing structural layer. Semantic v0.2 and Behavioral v0.2 were subsequently accepted on
2026-09-03, as recorded in their acceptance metadata. The original gates below describe stage order;
current package readiness is recorded in the package README and release lock.

It is not a transcription of Java packages. A source type becomes a domain concept only when it carries
identity, meaning or responsibility inside the accepted Scope. Conversely, implementation details that
belong to payment control, invoice retry, chargeback or provider finance remain adjacent even if they are
reachable from the same API.

This stage does not define commands, events, transition paths, timing rules, Claims or grader predicates.
Those remain downstream work. Existing behavioral analysis is referenced but is not silently accepted by
this amendment.

Evidence labels used below:

- `source_fact` — represented directly by exact docs, API or implementation;
- `modeling_decision` — a DomainEval representation choice supported by source facts but not named by
  Kill Bill as a DDD construct;
- `open` — insufficient evidence for a stable semantic decision.

## 2. Context view

```text
External Account Context
        │ AccountRef
        ├──────── owns ──────── 0..* PaymentMethod
        │                              │
        │                              └── routes_via ── PluginName
        │                                                   │ runtime resolves
        └──────── owns ──────── 0..* Payment                 ▼
                                       │ uses 1       PaymentPluginPort
                                       │                    │ returns
                                       ├── PaymentMethod    ▼
                                       │             ProviderTransactionObservation
                                       │
                                       ├── contains 1..* PaymentTransaction
                                       │                    ├── TransactionType
                                       │                    ├── TransactionStatus
                                       │                    ├── RequestedMoney
                                       │                    ├── ProcessedMoney 0..1
                                       │                    ├── TransactionExternalKey
                                       │                    └── GatewayFailureDetail 0..1
                                       │
                                       └── has PaymentStateName
                                                ▲
                                                │ may reconcile incomplete state
                                       JanitorRecovery
                                                │ reobserves via getPaymentInfo
                                                └──────────────→ PaymentPluginPort
```

The diagram is semantic ownership and reference structure, not an execution sequence. Runtime ordering
belongs to the Behavioral Model.

## 3. 正式领域模型定义（人工审阅入口）

本节是面向人的主审阅面。读者不需要打开 Java 源码，也不应该只凭名称猜测含义，就能理解每个
对象是什么、包含什么、由谁拥有，以及它能证明和不能证明什么。第 4 节以后保留面向证据审计
的术语和覆盖明细。

### 3.1 阅读符号与字段角色

| 符号/角色 | 含义 |
| --- | --- |
| `T` | The domain representation requires one known value after the object has been established |
| `T?` | The value may legitimately be absent, or the source boundary may report it incompletely |
| `T[0..*]` / `T[1..*]` | Zero-or-more / one-or-more collection cardinality |
| `identity` | Stable entity identity; equality of another field never substitutes for it |
| `stored` | Persisted by Kill Bill core as part of the orchestration record |
| `derived` | Computed from transaction history; not an independently writable source of truth |
| `projection` | Returned by an API view but may combine stored, derived or optional data |
| `boundary` | Supplied or observed across the Plugin port; not independently authoritative |
| `adjacent` | Visible in the source API but owned by a Model Context outside this active Module |

`createdAt` 和 `updatedAt` 在内存对象构造期间可以为空，但精确版本的支付表要求持久化后的审计
时间存在。因此，下文在表示边界把它们写成 `Instant?`，并在字段描述中注明持久化后的要求。

### 3.2 模型闭包：每类值究竟是什么事实

| 事实类别 | 示例 | 解释规则 |
| --- | --- | --- |
| Entity identity | `PaymentId`, `PaymentTransactionId`, `PaymentMethodId` | UUID identity controlled by Kill Bill; never replace it with an external key or provider reference |
| External reference | `AccountRef`, `paymentMethodRef`, `paymentRef`, `attemptRef` | Reference to another identity; it does not import that object's entire lifecycle into this aggregate |
| Stored orchestration fact | transaction type/status, state names, requested and processed columns | Describes what Kill Bill recorded; it does not prove an external economic result |
| Derived aggregate value | authorized/captured/purchased/credited/refunded amounts, currency, authorization-voided flag | Recomputed projection over transaction history; do not model it as a second writable balance |
| Opaque boundary data | Plugin detail, provider references and Plugin properties | Preserve without assigning unsupported structure or authority |
| Adjacent projection | `PaymentAttempt` list/reference | Visible for source completeness but excluded from direct-operation and Janitor ownership here |

### 3.3 共享实体元数据与基本类型

```text
EntityMetadata {
  id: UUID
  createdAt: Instant?
  updatedAt: Instant?
}

PaymentId            = UUID with Payment identity role
PaymentTransactionId = UUID with PaymentTransaction identity role
PaymentMethodId      = UUID with PaymentMethod identity role
PaymentAttemptId     = UUID reference to the adjacent payment-control context
AccountRef           = UUID reference to an Account outside this Model Context

PaymentExternalKey       = String with Payment correlation role
TransactionExternalKey   = String with transaction correlation/idempotency role
PaymentMethodExternalKey = String with PaymentMethod correlation role
PluginName               = String used as a runtime service-registration key
PaymentStateName          = String naming a state in the exact core configuration
ProviderReference         = opaque String reported by a Plugin
Decimal                   = exact decimal amount represented by BigDecimal
Currency                  = one value from the exact Kill Bill Currency contract
Instant                   = one point in time represented by DateTime
PluginProperty            = opaque Plugin-specific key/value extension

TransactionType = AUTHORIZE | CAPTURE | CHARGEBACK | CREDIT | PURCHASE | REFUND | VOID
TransactionStatus = SUCCESS | UNKNOWN | PENDING | PAYMENT_FAILURE | PLUGIN_FAILURE |
                    PAYMENT_SYSTEM_OFF
PaymentPluginStatus = PROCESSED | PENDING | ERROR | UNDEFINED | CANCELED
RecoveryOutcome = CoreStateCorrected | UncertaintyPreserved
```

这些类型别名用于防止“值相同就语义相同”的误判。同一段 UUID 或字符串出现在两个角色中，并不
会让它们指向的概念变成同一个对象。

### 3.4 `Payment`——中心支付编排聚合候选

**描述。** `Payment` 是 Kill Bill 对一次支付编排的有身份容器。它绑定所属 Account 的引用、选定
的 PaymentMethod、内部状态名和一组有类型的 PaymentTransaction 历史。它展示的金额汇总是从
交易历史计算出来的视图，不是账本余额，也不是清算或结算已经完成的证据。

```text
Payment {
  id: PaymentId
  createdAt: Instant?
  updatedAt: Instant?

  accountRef: AccountRef
  paymentMethodRef: PaymentMethodId
  paymentNumber: Integer
  externalKey: PaymentExternalKey
  currentState?: PaymentStateName
  lastSuccessState?: PaymentStateName

  transactions: PaymentTransaction[1..*]
  attempts: PaymentAttempt[0..*]

  currency?: Currency
  authorizedAmount: Decimal
  capturedAmount: Decimal
  purchasedAmount: Decimal
  creditedAmount: Decimal
  refundedAmount: Decimal
  authorizationVoided: Boolean
}
```

| 字段 | 人可读含义 | 存在性 | 数据角色 | 精确来源面 |
| --- | --- | --- | --- | --- |
| `id` | Kill Bill 内 Payment 的稳定身份 | required | `identity` | `Entity`, `Payment` |
| `createdAt`, `updatedAt` | 记录创建及最后更新时间；持久化后必须存在 | construction may omit | `stored` audit metadata | `Entity`, payment DDL |
| `accountRef` | 拥有该 Payment 的 Account；这里只引用，不建模 Account 生命周期 | required | `stored` external reference | `Payment.accountId`, payment DDL |
| `paymentMethodRef` | 此 Payment 选择的支付方式记录 | required | `stored` reference | `Payment.paymentMethodId`, payment DDL |
| `paymentNumber` | Kill Bill 分配的 Payment 序号；不是业务身份，也不能替代 `PaymentId` | required in API projection | `stored/projection` implementation value | `Payment.paymentNumber`, `PaymentModelDao` |
| `externalKey` | 调用方用于关联 Payment 的键；输入缺失时 core 可用 Payment UUID 字符串补齐 | required after normalization | `stored` correlation | `Payment.externalKey`, `PaymentModelDao`, payment DDL |
| `currentState` | 当前状态机状态名；初始持久化阶段可以为空 | optional | `stored` orchestration state | `PaymentModelDao.stateName`, payment DDL |
| `lastSuccessState` | 最近一次成功状态名；与当前状态是两个不同事实 | optional | `stored` orchestration state | `PaymentModelDao.lastSuccessStateName`, payment DDL |
| `transactions` | 共同构成此 Payment 历史的交易记录；首笔创建完成后至少一条 | `1..*` after creation | owned entity collection / `projection` | `Payment.transactions`, core create path |
| `attempts` | payment-control 的过去或未来尝试，只作为邻接投影保留 | `0..*` | `adjacent projection` | `Payment.paymentAttempts` |
| `currency` | core 从符合条件的初始交易推导的 Payment 币种；没有可用交易或币种冲突时可为空 | optional | `derived projection` | `DefaultPayment` |
| `authorizedAmount` | 成功且未被 VOID 对应掉的 AUTHORIZE 金额汇总 | required projection value | `derived projection` | `Payment.authAmount`, `DefaultPayment` |
| `capturedAmount` | 成功 CAPTURE 的金额汇总；精确实现还会计入邻接的 chargeback 调整 | required projection value | `derived projection` | `Payment.capturedAmount`, `DefaultPayment` |
| `purchasedAmount` | 成功 PURCHASE 的金额汇总；精确实现还会计入邻接的 chargeback 调整 | required projection value | `derived projection` | `Payment.purchasedAmount`, `DefaultPayment` |
| `creditedAmount` | 成功 CREDIT 的金额汇总 | required projection value | `derived projection` | `Payment.creditedAmount`, `DefaultPayment` |
| `refundedAmount` | 成功 REFUND 的金额汇总 | required projection value | `derived projection` | `Payment.refundedAmount`, `DefaultPayment` |
| `authorizationVoided` | 是否存在被成功 VOID 对应掉的成功 AUTHORIZE | required projection value | `derived projection` | `Payment.isAuthVoided`, `DefaultPayment` |

精确版本的 `DefaultPayment` 在计算 captured 和 purchased 汇总时还会考虑 chargeback 历史。
Chargeback 属于当前 Module 的邻接域，因此 v0.2 只记录这一计算依赖，不复制或提升其业务语义。

### 3.5 `PaymentMethod`——承载路由信息的支付方式实体

**描述。** `PaymentMethod` 是 Kill Bill 用来把 Account 与支付 Plugin 注册名关联起来的记录，支付
操作据此找到实际 Plugin。在本边界内，Plugin 细节保持不透明；模型不解释银行卡、银行账户、
token 或 mandate 数据。

```text
PaymentMethod {
  id: PaymentMethodId
  createdAt: Instant?
  updatedAt: Instant?
  accountRef: AccountRef
  externalKey: PaymentMethodExternalKey
  active: Boolean
  pluginName: PluginName
  pluginDetail?: OpaquePaymentMethodDetail
}
```

| 字段 | 人可读含义 | 存在性 | 数据角色 | 精确来源面 |
| --- | --- | --- | --- | --- |
| `id` | Kill Bill 内 PaymentMethod 的稳定身份 | required | `identity` | `Entity`, `PaymentMethod` |
| `createdAt`, `updatedAt` | 记录创建及最后更新时间；持久化后必须存在 | construction may omit | `stored` audit metadata | `Entity`, payment-method DDL |
| `accountRef` | 拥有该支付方式的 Account 引用 | required | `stored` external reference | `PaymentMethod.accountId`, payment-method DDL |
| `externalKey` | 调用方对 PaymentMethod 的关联键 | required | `stored` correlation | `PaymentMethod.externalKey`, payment-method DDL |
| `active` | Kill Bill 是否把该记录视为可用；DDL 默认 `true` | required in domain projection | `stored` lifecycle flag | `PaymentMethod.active`, payment-method DDL |
| `pluginName` | 用来在运行时解析 `PaymentPluginPort` 的注册名 | required | `stored` service key | `PaymentMethod.pluginName`, payment-method DDL |
| `pluginDetail` | Plugin 提供的支付方式细节；只有请求该信息时才可能出现 | optional | `opaque boundary projection` | `PaymentMethod.pluginDetail`, `DefaultPaymentMethod` |

### 3.6 `PaymentTransaction`——一次有类型的支付编排操作

**描述。** `PaymentTransaction` 记录某个 Payment 下的一次 AUTHORIZE、CAPTURE、CREDIT、PURCHASE、
REFUND 或 VOID 操作。它把调用方请求的金额与 Plugin 报告的处理金额分开，并记录 Kill Bill 自己
的交易状态。数据库中存在这条记录，并不能证明 Provider 已收到或完成了该操作。

```text
PaymentTransaction {
  id: PaymentTransactionId
  createdAt: Instant?
  updatedAt: Instant?

  paymentRef: PaymentId
  attemptRef?: PaymentAttemptId
  externalKey: TransactionExternalKey
  type: TransactionType
  status: TransactionStatus
  effectiveAt: Instant

  requestedMoney?: RequestedMoney
  processedMoney?: ProcessedMoney
  gatewayFailure?: GatewayFailureDetail
  providerObservation?: ProviderTransactionObservation
}
```

| 字段 | 人可读含义 | 存在性 | 数据角色 | 精确来源面 |
| --- | --- | --- | --- | --- |
| `id` | 这一次交易操作在 Kill Bill 内的稳定身份 | required | `identity` | `Entity`, `PaymentTransaction` |
| `createdAt`, `updatedAt` | 交易记录的创建及最后更新时间；持久化后必须存在 | construction may omit | `stored` audit metadata | `Entity`, transaction DDL |
| `paymentRef` | 该交易所属的 Payment | required | `stored` aggregate reference | `PaymentTransaction.paymentId`, transaction DDL |
| `attemptRef` | 触发该交易的 payment-control attempt；直接支付路径允许没有 | optional | `stored adjacent reference` | `PaymentTransactionModelDao.attemptId`, transaction DDL |
| `externalKey` | 调用方对本次交易的关联/幂等键；输入缺失时可用交易 UUID 字符串补齐 | required after normalization | `stored` correlation | DAO constructor, transaction DDL |
| `type` | 本次操作类别；active subset 为六种直接支付操作 | required | `stored` classification | `TransactionType`, transaction DDL |
| `status` | Kill Bill 对本次交易结果的记录，不代表外部资金终局 | required | `stored` orchestration state | `TransactionStatus`, transaction DDL |
| `effectiveAt` | 本次交易在 Kill Bill 语义中的生效时间 | required | `stored` business time | `PaymentTransaction.effectiveDate`, transaction DDL |
| `requestedMoney` | 调用方请求的金额和币种；VOID 等无金额操作可以没有 | optional, operation-dependent | `stored` requested-value role | amount/currency columns |
| `processedMoney` | Plugin 报告并由 core 投影/保存的处理金额和币种 | optional | `stored` boundary-derived role | processed columns |
| `gatewayFailure` | core 记录的 gateway 错误码和消息 | optional | `stored boundary detail` | gateway error columns |
| `providerObservation` | 仅在请求 Plugin 详情时附加的边界观测 | optional | `boundary projection` | `PaymentTransaction.paymentInfoPlugin` |

精确 DDL 允许 requested/processed 的 amount 和 currency 列分别为空。只有金额和币种都已知时，
本领域模型才构造下面的 Money 值对象；不完整的原始字段对会保留为不完整来源数据，不会被静默
强制转换成 Money。

### 3.7 Money 与失败信息值对象

```text
Money {
  amount: Decimal
  currency: Currency
}

RequestedMoney = Money used in the caller-requested role
ProcessedMoney = Money used in the Plugin-reported processed role

GatewayFailureDetail {
  code?: String
  message?: String
}
```

**描述。** Money 是金额与币种组成的值对：只有金额而没有已知币种，不构成完整 Money。即使数值
相等，requested 和 processed 仍是两个不同角色。只有 code 或 message 至少一个存在时，模型才
构造 `GatewayFailureDetail`；两个原始列都允许为空。这些值对象都没有独立实体身份。

### 3.8 `ProviderTransactionObservation`——Plugin 报告的边界观测

**描述。** 这是 Payment Plugin 对一笔 Provider 侧交易所作的报告，可用于关联和恢复，但它仍然
只是 Plugin 观测，不是独立验证过的 Provider 真相、结算凭据或银行记录。Plugin 是外部实现，
所以模型允许保留缺失字段，而不假定所有实现都遵守 Java 接口隐含的非空意图。

```text
ProviderTransactionObservation {
  killBillPaymentRef?: PaymentId
  killBillTransactionRef?: PaymentTransactionId
  transactionType?: TransactionType
  processedMoney?: ProcessedMoney
  pluginStatus?: PaymentPluginStatus
  createdAt?: Instant
  effectiveAt?: Instant
  gatewayFailure?: GatewayFailureDetail
  firstProviderReference?: ProviderReference
  secondProviderReference?: ProviderReference
  properties: PluginProperty[0..*]
}
```

| 字段族 | 人可读含义 | 权威边界 |
| --- | --- | --- |
| Kill Bill references | Plugin 回传其认为对应的 Payment/Transaction UUID | Correlation candidate; core must match it to existing records |
| transaction type/status | Plugin 对操作类别和处理结果的报告 | Drives Kill Bill mapping only after core validation; not economic finality |
| processed money | Plugin 报告实际处理的金额/币种 | Boundary observation; not a reconciled financial amount |
| created/effective time | Plugin 记录的创建或生效时间 | Provider-observed time; not interchangeable with Kill Bill audit time |
| gateway failure | Plugin 回传的错误码/消息 | Diagnostic observation, not a universal taxonomy |
| provider references | 最多两个不透明 Provider 引用 | Do not become entity IDs without a later Mapping contract |
| properties | Plugin-specific key/value details | Opaque extension data |

### 3.9 `PaymentPluginPort`——当前 Module 使用的外部操作边界

**描述。** `PaymentPluginPort` 是当前 Module 从精确 `PaymentPluginApi` 中实际使用的子集，用于建立
PaymentMethod 路由、执行六类支付操作，并重新观测已有 Payment 信息。它是端口契约，不是某个
Provider 的实现，也不能证明每个 Provider 都支持所有方法。

| 当前端口操作 | 与本模型相关的输入 | 输出 |
| --- | --- | --- |
| `addPaymentMethod` | AccountRef, placeholder PaymentMethodId, opaque detail, default flag, properties, call context | no transaction observation |
| `deletePaymentMethod` | AccountRef, PaymentMethodId, properties, call context | no transaction observation |
| `authorizePayment` | AccountRef, PaymentId, PaymentTransactionId, PaymentMethodId, RequestedMoney, properties, call context | one ProviderTransactionObservation or exception |
| `capturePayment` | same identity/money shape as authorize | one observation or exception |
| `purchasePayment` | same identity/money shape as authorize | one observation or exception |
| `creditPayment` | same identity/money shape as authorize | one observation or exception |
| `refundPayment` | same identity/money shape as authorize | one observation or exception |
| `voidPayment` | the four Kill Bill identities, properties and call context; no requested Money parameter | one observation or exception |
| `getPaymentInfo` | AccountRef, PaymentId, properties and tenant context | zero or more ProviderTransactionObservations or exception |

精确 Plugin API 还包含支付方式搜索/重置/设为默认、托管表单、支付搜索和 gateway notification 等
操作。它们在来源层保持可见，但不进入当前 Module 的活动端口；引用整个 Java 接口不会静默扩大
领域范围。

### 3.10 `JanitorRecovery`——针对已有记录的恢复过程

**描述。** `JanitorRecovery` 是一个过程候选：它通过 `getPaymentInfo` 重新检查已有但不完整的
Payment/PaymentTransaction。当 Plugin 返回可匹配的新观测时，它可以修正 Kill Bill 的认知；当
结果缺失、不完整或冲突时，它必须保留不确定性。

```text
JanitorRecovery {
  targetPayment: PaymentId
  targetTransactions: PaymentTransactionId[1..*] where status in {PENDING, UNKNOWN}
  observationPort: PaymentPluginPort.getPaymentInfo
  outcome: RecoveryOutcome
}
```

它在本模型中没有独立持久化实体身份，不创建新的经济尝试，不会让 Provider 状态自动成为权威，
也不是 payment-control 的重试策略。

### 3.11 聚合与所有权边界

| 边界 | 内部/拥有 | 引用但在边界外 | 原因 |
| --- | --- | --- | --- |
| `Payment` aggregate candidate | Payment identity, internal state names and PaymentTransaction history | Account, PaymentMethod, PaymentAttempt, Plugin observation | Core mutations and projections are organized around Payment/Transaction identity, but external and adjacent lifecycles remain independent |
| `PaymentMethod` entity | Routing key, active flag and PluginName | Account and opaque Plugin detail | It has its own UUID/lifecycle and is referenced rather than contained by Payment |
| `PaymentPluginPort` boundary | No Kill Bill entity ownership | Provider implementation and Provider records | The port carries commands/observations across a system boundary |
| `JanitorRecovery` process | Correction of knowledge/state for existing PaymentTransactions | Provider truth and product retry policy | Recovery observes existing work; it does not own a second payment lifecycle |

`Payment` 仍然只是聚合**候选**。源码确实围绕 Payment 组织数据和修改路径，但 Kill Bill 没有正式
声明 DDD Aggregate Root。因此本模型记录这条边界及其证据，但不会把我们的建模选择伪装成来源
事实。

## 4. Core identity-bearing concepts

| Concept ID | Kind | Definition in this context | Canonical identity | Source status | Primary evidence |
| --- | --- | --- | --- | --- | --- |
| `AccountRef` | external reference | Reference to the Kill Bill account that owns payment methods and payments; the Account lifecycle is not modeled here | Account UUID | `source_fact` for references; boundary is `modeling_decision` | `KB-API-0.54.0:Payment`, `PaymentMethod` |
| `PaymentMethod` | entity | Kill Bill record that associates one Account with an external key, active flag, plugin name and opaque plugin detail | PaymentMethod UUID | `source_fact` | `KB-API-0.54.0:PaymentMethod`; `KB-CORE-0.24.21:PaymentMethodProcessor` |
| `Payment` | aggregate candidate | Identity-bearing orchestration record that references an Account and PaymentMethod and groups transaction history, aggregate amounts, attempts and internal state names | Payment UUID | Grouping is `source_fact`; aggregate classification is `modeling_decision` | `KB-DOC-9EF10C7:payment-states`; `KB-API-0.54.0:Payment`; `KB-CORE-0.24.21:PaymentModelDao` |
| `PaymentTransaction` | entity within Payment | One independently identified typed payment operation and its requested, processed, status and gateway-result fields | PaymentTransaction UUID | `source_fact` | `KB-API-0.54.0:PaymentTransaction`; `KB-CORE-0.24.21:PaymentTransactionModelDao` |

`Payment` is deliberately called an aggregate candidate rather than asserting that Kill Bill's source
architecture uses a formal DDD Aggregate Root. The API groups transactions and aggregate values under one
Payment identity; the Behavioral Model must later verify whether all relevant consistency rules truly
close at that boundary.

## 5. Value, classification and state concepts

| Concept ID | Kind | Definition | Identity/equality | Source status | Primary evidence |
| --- | --- | --- | --- | --- | --- |
| `PaymentExternalKey` | correlation value | Caller-provided Payment correlation key; if absent, core persistence may default it to the Payment UUID string | String value plus Payment-key role; not entity identity | `source_fact` | `KB-API-0.54.0:Payment`; `KB-CORE-0.24.21:PaymentModelDao` |
| `TransactionExternalKey` | correlation/idempotency value | Caller-provided transaction key whose collision behavior depends on existing outcome and operation | String value plus transaction-key role; not entity identity | `source_fact` | `KB-API-0.54.0:PaymentTransaction`; `KB-CORE-0.24.21:PaymentProcessor`, `PaymentTransactionModelDao` |
| `PaymentMethodExternalKey` | correlation value | External reference stored on a PaymentMethod | String value plus payment-method-key role | `source_fact` | `KB-API-0.54.0:PaymentMethod` |
| `TransactionType` | enum | Exact API vocabulary `AUTHORIZE`, `CAPTURE`, `CHARGEBACK`, `CREDIT`, `PURCHASE`, `REFUND`, `VOID` | Enum value | `source_fact` | `KB-API-0.54.0:TransactionType` |
| `ActiveDirectTransactionType` | scoped enum view | Accepted subset `AUTHORIZE`, `CAPTURE`, `CREDIT`, `PURCHASE`, `REFUND`, `VOID`; `CHARGEBACK` remains visible but adjacent with reversal | TransactionType value plus Scope applicability | `modeling_decision` | accepted Scope; `KB-API-0.54.0:TransactionType` |
| `TransactionStatus` | enum | Exact API vocabulary `SUCCESS`, `UNKNOWN`, `PENDING`, `PAYMENT_FAILURE`, `PLUGIN_FAILURE`, `PAYMENT_SYSTEM_OFF` | Enum value | `source_fact` | `KB-API-0.54.0:TransactionStatus` |
| `ActiveTransactionStatus` | scoped enum view | Accepted result surface `SUCCESS`, `UNKNOWN`, `PENDING`, `PAYMENT_FAILURE`, `PLUGIN_FAILURE`; `PAYMENT_SYSTEM_OFF` remains adjacent | TransactionStatus value plus Scope applicability | `modeling_decision` | accepted Scope; `KB-API-0.54.0:TransactionStatus` |
| `PaymentStateName` | internal state value | Current and last-success state names persisted by Kill Bill and derived from the configured operation state machines | State-name string within core release | `source_fact`; typed semantic vocabulary deferred to behavior stage | `KB-CORE-0.24.21:PaymentModelDao`, `PaymentStates.xml` |
| `PaymentPluginStatus` | boundary enum | Plugin-side result vocabulary `PROCESSED`, `PENDING`, `ERROR`, `UNDEFINED`, `CANCELED` | Enum value | `source_fact` | `KB-API-0.54.0:PaymentPluginStatus` |
| `RequestedMoney` | value object | Amount and currency requested by the merchant-facing Kill Bill operation | Exact decimal amount plus currency, with requested role | Fields are `source_fact`; value-object grouping is `modeling_decision` | `KB-API-0.54.0:PaymentTransaction`; `KB-PLUGIN-API-0.27.3:PaymentPluginApi` |
| `ProcessedMoney` | optional value object | Amount and currency reported by the plugin and persisted as processed values | Exact decimal amount plus currency, with processed role | Fields are `source_fact`; value-object grouping is `modeling_decision` | `KB-API-0.54.0:PaymentTransaction`, `PaymentTransactionInfoPlugin` |
| `GatewayFailureDetail` | optional value object | Gateway error code and message recorded on a PaymentTransaction | Code/message pair; no independent identity | `source_fact` | `KB-API-0.54.0:PaymentTransaction`, `PaymentTransactionInfoPlugin` |
| `PluginName` | service-key value | Registration name stored by PaymentMethod and used to resolve a PaymentPlugin service at runtime | Exact string in one runtime registry | `source_fact` | `KB-API-0.54.0:PaymentMethod`; `KB-CORE-0.24.21:DefaultPaymentProviderPluginRegistry` |

The three external-key concepts are not aliases. Equal strings do not merge their roles or the entities
that carry them.

## 6. Boundary concepts

| Concept ID | Kind | Definition | Must not mean | Source status | Primary evidence |
| --- | --- | --- | --- | --- | --- |
| `PaymentPluginPort` | external port | Versioned `PaymentPluginApi` operations used by Kill Bill to add payment methods, execute payment operations and retrieve later payment information | A provider implementation, universal payment behavior or provider authority | `source_fact` for interface; port classification is `modeling_decision` | `KB-PLUGIN-API-0.27.3:PaymentPluginApi` |
| `ProviderTransactionObservation` | boundary observation | `PaymentTransactionInfoPlugin` data returned by a plugin: Kill Bill IDs, type, processed money, dates, plugin status, gateway errors, provider references and properties | Independent proof of provider truth, settlement, payout or bank receipt | `source_fact` for fields; observation classification is `modeling_decision` | `KB-API-0.54.0:PaymentTransactionInfoPlugin` |
| `ProviderReference` | opaque boundary value | First or second provider reference string reported through the plugin result | Kill Bill entity identity or a proven cross-system Mapping | `source_fact` | `KB-API-0.54.0:PaymentTransactionInfoPlugin` |
| `OpaquePaymentMethodDetail` | opaque boundary value | Plugin-owned payment-method detail attached to the Kill Bill PaymentMethod API projection | A card/account model or permission to expose sensitive instrument data | `source_fact` for field; opacity is boundary policy | `KB-API-0.54.0:PaymentMethod` |
| `JanitorRecovery` | recovery-process candidate | Core process that re-observes existing payment information through the plugin and may reconcile incomplete Kill Bill state | A new payment attempt, economic retry, provider truth or settlement reconciliation | Mechanism is `source_fact`; domain-process classification is `modeling_decision` | `KB-DOC-9EF10C7:payment-states`; `KB-CORE-0.24.21:Janitor`, `TestJanitor` |

## 7. Adjacent types that remain visible

| Adjacent concept | Why visible | Why excluded from the active model |
| --- | --- | --- |
| `PaymentAttempt` | `Payment` exposes past/future attempts and core transactions may reference an attempt UUID | Attempt semantics belong to payment-control and retry policy, which the accepted Scope keeps adjacent |
| `CHARGEBACK` and reversal | Exact TransactionType and core code contain chargeback recording and reversal behavior | They require a coupled dispute/reversal lifecycle and special key semantics |
| `PAYMENT_SYSTEM_OFF` | Exact TransactionStatus API includes it | It is not a PaymentPlugin outcome mapping in the accepted direct-operation result surface |
| Invoice payment and overdue state | They can call the same payment subsystem | Invoice obligation, retry schedule and entitlement policy form another Model Context |

Visibility prevents source truncation; exclusion prevents adjacent implementation from silently widening
this Module.

## 8. Typed relations and cardinality candidates

| Relation ID | Subject | Predicate | Object | Cardinality | Status |
| --- | --- | --- | --- | --- | --- |
| `account-owns-payment-method` | AccountRef | `owns` | PaymentMethod | `1 → 0..*` | Source-backed reference; Account lifecycle external |
| `account-owns-payment` | AccountRef | `owns` | Payment | `1 → 0..*` | Source-backed reference; Account lifecycle external |
| `payment-uses-method` | Payment | `uses` | PaymentMethod | `1 → 1` in exact API/data model | `source_fact`, behavioral validity still to test |
| `payment-contains-transaction` | Payment | `contains` | PaymentTransaction | `1 → 1..*` after creation | Docs/API backed; aggregate ownership is candidate |
| `transaction-belongs-to-payment` | PaymentTransaction | `belongs_to` | Payment | `* → 1` | `source_fact` |
| `method-routes-via-name` | PaymentMethod | `routes_via` | PluginName | `1 → 1` | `source_fact` |
| `name-resolves-plugin` | PluginName | `resolves_at_runtime_to` | PaymentPluginPort | `1 → 0..1` at lookup time | Registry-backed; absence behavior belongs to Behavioral Model |
| `transaction-has-type` | PaymentTransaction | `has_type` | TransactionType | `1 → 1` | `source_fact` |
| `transaction-has-status` | PaymentTransaction | `has_status` | TransactionStatus | `1 → 1` | `source_fact` |
| `transaction-records-requested-money` | PaymentTransaction | `records` | RequestedMoney | `1 → 1` for included amount-bearing operations | `source_fact` plus scoped cardinality decision |
| `transaction-records-processed-money` | PaymentTransaction | `records` | ProcessedMoney | `1 → 0..1` | `source_fact` |
| `plugin-reports-observation` | PaymentPluginPort | `reports` | ProviderTransactionObservation | `0..1` result per operation call; list on `getPaymentInfo` | `source_fact` |
| `observation-refers-to-transaction` | ProviderTransactionObservation | `refers_to` | PaymentTransaction | Kill Bill transaction UUID when present | Correlation only; not independent authority |
| `janitor-reobserves-payment` | JanitorRecovery | `reobserves_via` | PaymentPluginPort | existing Payment → zero or more observations | Mechanism source-backed; process boundary candidate |
| `payment-has-state-name` | Payment | `has_current_state` | PaymentStateName | `1 → 0..1` during persistence lifecycle | Internal data model backed; transition semantics deferred |

Cardinalities are candidate semantic assertions, not database schema claims. The Behavioral Model must
exercise creation, deletion, missing-plugin and incomplete-state paths before they can be promoted.

## 9. Definitional invariants

These invariants protect concept identity and representation. They do not express provider or product
policy.

1. `Payment`, `PaymentMethod` and `PaymentTransaction` retain distinct UUID identities.
2. Every active PaymentTransaction refers to exactly one Payment; equal external keys do not merge
   transactions.
3. Payment-, transaction- and payment-method external keys remain role-qualified values even when a
   missing key defaults to an entity UUID string.
4. `TransactionType`, `TransactionStatus`, `PaymentStateName` and `PaymentPluginStatus` remain different
   semantic axes.
5. RequestedMoney and ProcessedMoney remain distinguishable; equal values do not make the roles identical.
6. A ProviderTransactionObservation is boundary data reported through a plugin, not an independently
   authoritative provider or financial record.
7. ProviderReference values do not establish cross-system identity without a Mapping and observation
   contract.
8. `PENDING` and `UNKNOWN` remain distinct incomplete orchestration statuses; neither may be collapsed into
   success or known failure.
9. JanitorRecovery updates knowledge/state about an existing orchestration record; it is not by definition
   a new external economic attempt.
10. Kill Bill orchestration success remains distinct from provider authorization, clearing, settlement,
    payout, bank receipt and accounting closure.
11. Adjacent enum values and API types remain visible even when excluded from the active scoped model.

The following are deliberately not definitional invariants here:

- cumulative capture does not exceed authorization;
- refund does not exceed purchase/capture;
- refund returns value to the original tender;
- retries have exactly one external economic effect;
- any Provider supports every TransactionType.

Those statements require later provider, product or financial Claims.

## 10. Source-to-model coverage

| Accepted source family | Semantic representation in this model |
| --- | --- |
| `F01 account-payment-method-routing` | AccountRef, PaymentMethod, PluginName, PaymentPluginPort and routing relations |
| `F02 payment-transaction-identity` | Payment, PaymentTransaction and UUID/external-key separation |
| `F03 initial-operations` | TransactionType and ActiveDirectTransactionType |
| `F04 capture` | CAPTURE type plus RequestedMoney/ProcessedMoney roles; no capture ceiling |
| `F05 void` | VOID type; lifecycle semantics deferred |
| `F06 refund` | REFUND type; provider eligibility and economic effect excluded |
| `F07 result-status-translation` | PaymentPluginStatus, TransactionStatus, ActiveTransactionStatus and separate state axes |
| `F08 explicit-pending-completion` | PENDING as incomplete state; completion behavior deferred |
| `F09 janitor-recovery` | JanitorRecovery, PaymentPluginPort and re-observation relation |
| `F10 external-keys` | Three role-qualified external-key concepts |
| `F11 amount-currency-propagation` | RequestedMoney and ProcessedMoney |
| `F12 exception-and-unknown` | UNKNOWN distinct from failure/success plus optional GatewayFailureDetail |

Every accepted family has a semantic home. This table is coverage of representation, not Claim truth.

## 11. Open semantic questions

| Question ID | Question | Current recommendation | What later evidence decides it |
| --- | --- | --- | --- |
| `SQ1 payment-aggregate` | Is Payment a stable aggregate boundary rather than only an API projection? | Keep `aggregate candidate` | Behavioral consistency and mutation paths |
| `SQ2 account-boundary` | Should Account be fully modeled here? | Keep `AccountRef` only | Any included rule that depends on Account lifecycle rather than UUID ownership |
| `SQ3 payment-method-boundary` | Is PaymentMethod essential or infrastructure-only? | Keep entity: routing cannot be expressed without it | Behavioral routing and deletion scenarios |
| `SQ4 payment-attempt` | Should PaymentAttempt enter the active model? | Keep adjacent | Only if direct-operation semantics cannot be described without payment-control/retry attempts |
| `SQ5 janitor-classification` | Is JanitorRecovery a domain process or implementation service? | Keep process candidate | Behavioral commands/events and independent consumer language |
| `SQ6 credit-meaning` | Does CREDIT share one coherent operation vocabulary without becoming ledger credit? | Keep active but Kill-Bill-specific | Exact behavior model and downstream consumer interpretation |
| `SQ7 provider-references` | Can first/second provider reference IDs become typed identifiers? | Keep opaque | Provider-specific Module and Mapping evidence |
| `SQ8 payment-system-off` | Should PAYMENT_SYSTEM_OFF enter this Module? | Keep adjacent | Evidence that it belongs to accepted direct-plugin outcome semantics |

No question is silently resolved by class name or field shape.

## 12. Semantic Model v0.2 acceptance gate

v0.1 的验收仍然证明术语与关系已经审阅过，但不代表本次结构补充已经验收。接受 v0.2 表示确认
下面各项不仅技术上充分，而且无需阅读实现代码也能理解：

1. 每个核心概念都有白话描述，明确它代表什么、不能证明什么；
2. `Payment`、`PaymentMethod` 和 `PaymentTransaction` 已明确列出字段、类型、存在性和数据角色；
3. 持久化事实、派生汇总、API 投影、不透明边界观测和邻接域投影被明确区分；
4. `Payment` 是聚合候选，而不是声称 Kill Bill 正式声明了 DDD Aggregate Root；
5. `PaymentTransaction` 归属于一个 Payment，而 Account、PaymentMethod 和 PaymentAttempt 保持独立
   或邻接生命周期；
6. Account 只作为外部身份引用，不在此处扩展成完整聚合；
7. PaymentAttempt 保持邻接，除非后续明确把 payment-control/retry 语义纳入范围；
8. UUID 身份、external key 和 Provider reference 是不同角色，不能互相替代；
9. requested 与 processed Money 都是完整的金额/币种值对，且语义角色不同；不完整原始列不会被
   强制包装成 Money；
10. `PaymentPluginPort` 只列当前 Module 实际使用的操作，精确 Java 接口的其他方法不进入活动范围；
11. ProviderTransactionObservation 和 GatewayFailureDetail 仍是 Plugin 报告的边界数据，不是独立
    验证的 Provider 或财务真相；
12. JanitorRecovery 重新观测并可能修正已有不完整记录，但不是一次经济重试；
13. CREDIT 保持 Kill Bill 特有的活动操作；CHARGEBACK 和 PAYMENT_SYSTEM_OFF 可见但仍在邻接域；
14. Behavioral Model 候选在本结构补充验收前保持 pending；接受 v0.2 仍不授权 Claim Ledger、Bench
    或不可变 Domain Release。

在接受 Behavioral Model 前，应先拒绝或修订任何不同意的项目。后续证据仍可能拆分或取代本候选；
这里的任何验收都不会自动提升 Provider、结算或会计 Claim。
