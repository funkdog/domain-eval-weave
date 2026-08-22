---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, commerce, domain-baseline]
doc_kind: domain_baseline_candidate
created: 2026-08-22
status: candidate
---

# Commerce 订单领域基线

> 当前唯一维护版本。状态为 `candidate`：它是 Domain Author 的输入，不是已确认的 Product Domain Contract。
> 只有经过领域负责人确认并写入 authority ledger 的 Claims，才具有产品真相效力。

## 1. 范围

本基线描述通用互联网电商中的订单生命周期：订单创建、支付、履约、发货、取消/退款、完成，以及相关的库存、促销、对象级权限、幂等、恢复和审计要求。

本轮明确排除：退货物流、部分发货、部分取消、税费、跨境、欺诈裁决、平台分账与会计总账。后续需求若引入这些能力，应扩展领域基线，而不是把规则偷偷塞进单个 PRD。

后续需求文档只表达相对本基线的变化，不能同时为自己定义领域真相和验收标准。

## 2. 证据等级

文中的判断分为三层：

1. **调研支持的候选领域事实**：多个被调研平台或标准共同支持，但仍需 owner 确认是否适用于本产品。
2. **Owner Policy**：行业不存在统一答案，必须由领域负责人选择。
3. **Implementation Pattern**：实现候选，不得晋升为产品真相。

Shopify、Adobe、Stripe 等厂商文档只证明各自平台及被交叉印证的部分；本文不把任一厂商的数据模型声明为行业标准。

## 3. 产品领域与权威边界

### Order

拥有订单身份、客户关联、商品与金额快照、商业取消决定、命令身份，以及面向用户的聚合状态投影。Order 只能记录对其他领域发出的请求，不能自行声称支付退款或履约撤回已经完成。

### Payment

拥有支付授权/扣款引用、实付金额与币种、剩余可退金额、退款请求和退款结算结果。

### Fulfilment

拥有履约工作单、服务方受理、拣货/打包或等价进度、承运商交接、履约撤回能力及撤回结果。

### Inventory

拥有库存预占、可售量、来源库存、消耗、释放、回库和补偿效果。

### Promotion

拥有订单使用的折扣快照、优惠券使用记录、当前资格、复用次数与是否恢复的决策。

### Authorization

拥有认证 actor 与授权策略。任何订单读写都必须根据目标订单重新执行对象级授权，不能因调用方能访问接口便默认其能操作任意订单。[OWASP API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)

### 横切能力

Audit、integration messaging、observability 是横切能力，不作为业务 bounded context。它们保存决策和跨域交接证据，但无权创造订单、退款、库存或促销政策。

## 4. 核心概念

- **Order**：订单内部身份、客户可见编号、所有者、商品快照、币种、金额快照、版本及各领域事实的引用。
- **Line Item**：SKU/商品快照、数量、价格与折扣分摊；本轮不定义部分取消或部分发货转换。
- **Payment/Charge**：支付方引用、授权/扣款事实、实付金额、币种。
- **Refund**：关联支付、申请金额、剩余可退余额、原因及结算事实。
- **Fulfilment Order/Shipment**：履约方、地点、工作状态、撤回能力、承运商交接与追踪事实。
- **Inventory Effect**：库存对象、数量、效果类型、业务原因与幂等身份。
- **Promotion Application**：下单时采用的折扣/优惠券及分摊快照；后续复用资格是另一项事实。
- **Command Decision**：actor、目标对象、请求/幂等身份、规范化输入指纹、预期版本、决策与结果。
- **Domain/Integration Event**：事件身份、subject、事实类型、权威发生时间、因果/关联身份、schema version 与 payload digest。

具体 ID 格式与保留时长属于系统或 owner policy，不从厂商 API 直接复制。

## 5. 调研支持的候选 Claims

### C-01：订单、支付/退款、履约、库存与促销是正交事实

面向用户的“订单状态”是这些事实的派生投影，不是唯一真相源。Shopify 同时暴露取消、财务、履约和关闭事实；Adobe 将订单、发票、发货、Credit Memo 与库存 reservations 分开。[Shopify Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order) · [Adobe Order Workflow](https://experienceleague.adobe.com/en/docs/commerce-admin/stores-sales/order-management/orders/order-processing)

本文不确认任何统一 enum；各领域只需要保存能判定自身规则的事实。

### C-02：取消决定不证明退款已经结算

取消、支付授权撤销、退款申请和退款到账是不同事实。Shopify 支持取消但不退款，并以异步 Job 表达取消执行；Adobe 区分 Open Credit Memo（应退款但未完成）与 Refunded；Stripe 将 Refund 建模为关联 Charge/PaymentIntent 的独立对象。[Shopify orderCancel](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCancel) · [Adobe Reservations](https://experienceleague.adobe.com/en/docs/commerce-admin/inventory/basics/order-status) · [Stripe Refund](https://docs.stripe.com/api/refunds/create)

### C-03：退款必须绑定真实支付和剩余可退余额

退款引用实际支付身份、币种和退款金额，不能默认按商品标价退款，也不能超过剩余可退金额。List amount、折后订单金额、实付金额、已退金额和待退金额必须保持区分。[Stripe Refund](https://docs.stripe.com/api/refunds/create)

### C-04：金额必须带币种和明确表示法

金额不能是缺少币种和单位的裸数。对接支付提供商时遵循其金额协议；例如 Stripe 使用 currency minor unit，并单独处理零小数币种和特殊币种。[Stripe Currencies](https://docs.stripe.com/currencies)

Minor-unit 编码是当前集成约定，不是所有内部领域模型唯一合法的表示方式。

### C-05：订单操作必须执行对象级授权

认证成功不等于拥有某个订单。调用方对订单发起查询、取消、退款或其他变更时，必须根据当前 actor、目标订单和操作类型重新判断权限。拒绝不得产生资金、库存、促销或生命周期副作用。[OWASP API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)

### C-06：请求和消息重放不能重复产生业务效果

相同请求或重复消息不能重复扣款、退款、释放库存、恢复优惠券或改变生命周期；相同幂等身份配合不同规范化输入必须拒绝。Stripe 的幂等请求与 webhook 文档分别说明安全重试、重复事件和乱序事件处理。[Stripe Idempotency](https://docs.stripe.com/api/idempotent_requests) · [Stripe Webhooks](https://docs.stripe.com/webhooks)

幂等身份的 scope、保留时间和响应重放策略仍是 Owner/System Policy。

### C-07：跨领域请求、受理和完成必须分离

Order 可以请求退款、履约撤回、库存效果或促销复用判断；目标领域分别拥有受理、进行中、成功和失败事实。下游超时只能产生 pending/unknown 结果，不能伪造完成。

Shopify fulfilment API 允许在部分履约状态下提交取消请求，结果由 fulfilment service 决定，说明“请求撤回”与“撤回完成”必须分开。[Shopify Fulfilment Solutions](https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/build-fulfillment-solutions)

### C-08：权威状态变化与跨域证据必须具有恢复路径

本地业务决定只有在权威状态和该决定的持久证据提交后，才能报告为 `decision_committed`。跨领域效果必须继续使用 `requested / accepted / pending / completed / failed` 等独立事实表达，不能将本地提交升级为下游完成。

消息重复、乱序、进程崩溃与双写失败需要显式恢复设计。[AWS Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) · [AWS Saga Orchestration](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html)

## 6. 订单领域事实模型

### 商业订单事实

至少保存：订单是否仍开放、是否作出取消决定、是否满足关闭条件。具体枚举、显示文案和“取消是否可逆”由本产品确认；不得直接复制 Shopify 或 Adobe 的状态表。

### 支付与退款事实

至少保存：是否授权、是否扣款、扣款金额与币种、剩余可退余额、退款是否已请求、提供商处理状态和最终结算结果。

### 履约事实

至少保存：是否提交履约、服务方是否受理、当前工作进度、是否完成承运商交接、是否支持撤回、撤回请求和撤回结果。

“尚未发货”不证明尚未开始物理工作；“履约已受理”也不构成跨平台统一的不可撤回边界。自助取消截止点必须由 owner 确认。

### 库存事实

至少保存：库存是否预占、是否消耗、是否执行释放/补偿/回库，以及效果身份和业务原因。

Adobe 通过 reservation compensation 管理取消和退款；Shopify 将 restock 作为显式取消输入并记录 location 例外。因此稳定事实是“库存效果必须显式、可归因且不可重复”，而非“所有取消都自动回库”。[Adobe Reservations](https://experienceleague.adobe.com/en/docs/commerce-admin/inventory/basics/order-status) · [Shopify orderCancel](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCancel)

### 促销事实

订单永久保留下单时采用的折扣分摊快照。优惠券在失败、取消或退款后是否可再次使用，要根据 Promotion 当前规则和历史使用记录重新判断，不能从订单取消自动推断。

本次调研未建立跨平台统一的优惠券恢复规则；Adobe 对失败订单后的单次券复用存在专门补丁，进一步说明该行为与产品版本和促销策略相关。[Adobe Coupon Codes](https://experienceleague.adobe.com/en/docs/commerce-admin/marketing/promotions/cart-rules/price-rules-cart-coupon) · [Adobe ACSD-54966](https://experienceleague.adobe.com/en/docs/commerce-operations/tools/quality-patches-tool/patches-available-in-qpt/v1-1-42/acsd-54966-fix-for-limited-use-coupon-code-after-failed-orders)

## 7. 命令、事件与时间权威

候选命令包括创建订单、记录支付授权/扣款、提交履约、记录履约进度、请求订单取消、请求履约撤回、请求退款、记录退款结果、应用库存效果、评估促销复用和关闭订单。

每个 mutating command 至少携带 actor、subject、请求/幂等身份、规范化输入和并发条件。调用方提供的时间只能作为 `requested_at` 或业务输入；权威 `decided_at / recorded_at` 由拥有该状态的 runtime 记录。

事件名称表达已经发生的事实，例如 `RefundRequested` 与 `RefundSucceeded` 必须是不同事件。事件保存 runtime-owned 时间、因果/关联身份和 schema version。

## 8. Operational Invariants

这些约束描述产品必须得到的性质，但不预选具体技术：

1. 拒绝的命令不产生跨领域副作用。
2. 重试、重复消息和重启不能重复产生业务效果。
3. 冲突的幂等身份复用必须拒绝。
4. 下游 pending/unknown 不得包装为 completed。
5. 权威状态损坏必须 fail-closed，不能静默重置领域历史。
6. 跨领域进度能够通过业务对象、因果身份和提供商引用追踪。
7. 并发决策必须采用版本条件、业务锁或其他能保护领域不变量的机制。

## 9. Owner Policy Slots

以下问题没有统一行业答案，Domain Author 必须提问，不能推断：

1. 自助取消的准确截止事实是什么？
2. 已受理/进行中的履约是否允许异步撤回，用户看到什么状态？
3. 各取消、退款和退货路径如何决定库存释放、补偿或回库？
4. 优惠券是否恢复、重新评估资格或永久消耗？资格在哪个时间点判断？
5. 除订单所有者外，客服、运营、商家或系统 actor 分别能执行什么操作？
6. Guest order 如何证明访问权？
7. 幂等身份的作用域与保留时间是什么？
8. 哪些跨领域步骤要求原子一致，哪些接受最终一致？
9. 业务审计需要记录什么、保留多久？被拒请求是否进入业务审计？
10. 若未来加入部分订单/发货/退款，数量和金额如何分摊？

## 10. Implementation Patterns（非领域真相）

以下只作为工程候选，不能被 Domain Author 抽取成 Product Claims：

- transactional outbox / CDC；
- saga orchestration 或 choreography；
- domain events / integration events；
- semantic lock、optimistic concurrency；
- message broker、队列和重试调度；
- event sourcing 或普通状态存储；
- 面向用户的聚合状态投影。

是否采用这些模式取决于一致性、吞吐、运维和恢复要求。[Microsoft Domain Events](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/domain-events-design-implementation) · [Azure Data Considerations](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations)

IETF Idempotency-Key revision 07 已于 2026-04-18 过期，仍是 Internet-Draft；本文只将其作为术语和方向旁证，不作为正式标准依据。[IETF Draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/07/)

## 11. Requirement Delta 规则

后续 PRD 必须逐项声明它对已确认 Claims 的影响：

- `uses`
- `preserves`
- `modifies`
- `deprecates`
- `conflicts_with`
- `leaves_unobserved`

未提及的 Claims 保持不变；任何修改都形成新的 Contract version 和显式 transition，不能静默覆写。

若确定性 Grader 无法观察一个受影响 Claim，该 Claim 必须进入 semantic residual，不能靠相邻行为或综合分补偿。

## 12. 来源与适用性

| 来源 | 用途 | 适用性与限制 |
| --- | --- | --- |
| [Shopify Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order) | 财务、履约、取消、关闭事实分离 | Shopify 2026-07 Admin GraphQL 模型 |
| [Shopify orderCancel](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCancel) | 异步取消、退款/restock 选项、资格条件 | Shopify 全单取消，不代表统一政策 |
| [Shopify Fulfilment Solutions](https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/build-fulfillment-solutions) | 履约撤回请求与结果分离 | Shopify fulfilment-service 集成 |
| [Adobe Order Workflow](https://experienceleague.adobe.com/en/docs/commerce-admin/stores-sales/order-management/orders/order-processing) | 订单、支付/开票、发货、Credit Memo 分离 | Adobe Commerce 管理流程 |
| [Adobe Reservations](https://experienceleague.adobe.com/en/docs/commerce-admin/inventory/basics/order-status) | reservation compensation、Credit Memo 状态 | Adobe Inventory Management |
| [Stripe Refund](https://docs.stripe.com/api/refunds/create) | 支付绑定、剩余可退金额 | Stripe API，不覆盖税费和平台分账 |
| [Stripe Idempotency](https://docs.stripe.com/api/idempotent_requests) | 安全重试与冲突参数 | Stripe 的 retention/响应语义是 vendor-specific |
| [Stripe Webhooks](https://docs.stripe.com/webhooks) | 重复、乱序事件 | Stripe webhook 交付模型 |
| [OWASP API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) | 对象级授权 | 安全要求，不定义订单状态 |
| [AWS Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) | 双写恢复、重复消息 | 实现模式，不是产品政策 |

检索日期为 2026-08-22。所有厂商来源均带自身产品立场；只有被交叉印证或明确降级为 vendor-specific/policy/pattern 的内容进入本文。
