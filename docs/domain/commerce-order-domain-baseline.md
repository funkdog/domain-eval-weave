---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, commerce, domain-baseline]
doc_kind: domain_baseline
created: 2026-08-22
status: confirmed
---

# Commerce 订单领域基线

本文件描述订单领域当前生效的领域规则与产品政策。

## 1. 范围

领域范围包括订单创建、支付、履约、发货、取消、退款、完成，以及相关的库存、促销、对象级权限、幂等、恢复和审计要求。

本轮范围不包括退货物流、部分发货、部分取消、税费、跨境、欺诈裁决、平台分账与会计总账。

## 2. 领域与权威

### Order

拥有订单身份、客户关联、商品与金额快照、商业取消决定、命令身份及客户可见状态投影。

### Payment

拥有支付授权与扣款引用、实付金额、币种、剩余可退金额、退款请求和退款结算结果。

### Fulfilment

拥有履约工作单、服务方受理、履约进度、承运商交接、履约撤回能力与撤回结果。

### Inventory

拥有库存预占、可售量、来源库存、消耗、释放、补偿与回库效果。

### Promotion

拥有折扣快照、优惠券使用记录、当前资格、复用次数与恢复决策。

### Authorization

拥有认证 actor 与授权策略。订单查询与变更均依据当前 actor、目标订单和操作类型执行对象级授权。

### 横切能力

Audit、integration messaging 与 observability 保存决策和跨领域交接证据。

## 3. 核心概念

- **Order**：订单内部身份、客户可见编号、所有者、商品快照、币种、金额快照、版本及领域事实引用。
- **Line Item**：SKU/商品快照、数量、价格与折扣分摊。
- **Payment/Charge**：支付方引用、授权与扣款事实、实付金额、币种。
- **Refund**：关联支付、申请金额、剩余可退余额、原因及结算事实。
- **Fulfilment Order/Shipment**：履约方、地点、工作状态、撤回能力、承运商交接与追踪事实。
- **Inventory Effect**：库存对象、数量、效果类型、业务原因与幂等身份。
- **Promotion Application**：下单时采用的折扣或优惠券及其分摊快照。
- **Command Decision**：actor、目标对象、请求身份、规范化输入指纹、预期版本、决定与结果。
- **Domain Event**：领域中已经发生的事实。
- **Integration Event**：跨领域传递的事实，包含事件身份、subject、权威发生时间、因果身份、关联身份与 schema version。

## 4. 领域规则

### R-01：领域事实相互独立

Order、Payment、Refund、Fulfilment、Inventory 与 Promotion 分别维护自身权威事实。面向客户的订单状态由这些事实投影生成。

### R-02：取消与退款结算分离

订单取消、支付授权撤销、退款申请和退款结算分别记录。订单取消决定不改变 Payment 的结算事实。

### R-03：退款绑定支付余额

退款关联实际支付身份、币种和退款金额。退款金额不超过该支付的剩余可退余额。商品标价、折后金额、实付金额、已退金额与待退金额分别保存。

### R-04：金额包含币种和表示法

每个金额包含币种和明确的单位表示。支付提供商交互遵循对应提供商的金额协议。

### R-05：订单操作执行对象级授权

订单查询、取消、退款及其他变更在执行前校验 actor 对目标订单及操作的权限。授权拒绝不产生资金、库存、促销或生命周期效果。

### R-06：重放保持业务效果幂等

相同请求或重复消息不重复产生扣款、退款、库存、促销或生命周期效果。相同幂等身份携带不同规范化输入时返回冲突。

### R-07：跨领域请求、受理和完成分离

Order 发出的退款、履约撤回、库存效果和促销资格请求分别由目标领域受理并记录结果。每次交接独立表达 `requested`、`accepted`、`pending`、`completed` 或 `failed`。

### R-08：权威决定具有持久证据

本地业务决定在权威状态及对应证据提交后记为 `decision_committed`。跨领域效果沿自身生命周期继续推进。消息重复、乱序、进程崩溃与双写失败具有可追踪的恢复路径。

## 5. 领域事实模型

### 商业订单事实

保存订单是否开放、是否作出取消决定、是否满足关闭条件。客户可见状态由商业、财务和履约事实共同生成。

### 支付与退款事实

保存支付授权、扣款、扣款金额、币种、剩余可退余额、退款请求、提供商处理状态与结算结果。

### 履约事实

保存履约提交、服务方受理、工作进度、承运商交接、撤回能力、撤回请求与撤回结果。

### 库存事实

保存库存预占、消耗、释放、补偿和回库效果，以及效果身份、数量与业务原因。

### 促销事实

保存下单时采用的折扣分摊快照、优惠券使用记录、规则版本、当前资格与复用决定。

## 6. 核心关系

| Subject | Relationship | Object | 约束 |
| --- | --- | --- | --- |
| Order | contains | one or more Line Items | 保存下单时商品、数量与金额快照 |
| Order | references | zero or more Payment attempts | Payment 事实证明授权与扣款结果 |
| Captured Payment | funds | zero or more Refunds | Refund 总额不超过剩余可退余额 |
| Order | references | zero or more Fulfilment work records | 每个工作记录保存履约方和工作身份 |
| Order / Line Item | causes | Inventory Effects | 每个效果拥有独立业务与幂等身份 |
| Order | retains | zero or more Promotion Applications | 保留历史折扣分摊与规则版本 |
| Command | produces | one Command Decision | scope 与幂等身份绑定规范化输入和权威结果 |
| Domain Fact | produces | zero or more Integration Events | 事件关联来源事实与目标领域交接 |

## 7. 命令规则

| Command | Authority | 前置条件 | 成功或受理事实 | 拒绝条件 | 交接与证据 |
| --- | --- | --- | --- | --- | --- |
| `CreateOrder` | Order | actor、输入与幂等身份有效 | `OrderCreated` 与商品/金额快照提交 | 无权限、输入非法、幂等冲突 | 后续请求使用独立 request/event identity |
| `RecordPaymentFact` | Payment | provider 引用、schema 与重复检查有效 | 授权、扣款或失败事实提交 | 来源无效、状态倒退、金额或币种不一致 | 事件关联 Payment 与 Order |
| `SubmitFulfilment` | Fulfilment | Order 提供可履约意图 | 履约请求及服务方受理状态提交 | 请求冲突、对象或数量无效、政策拒绝 | 返回 fulfilment work identity |
| `RequestOrderCancellation` | Order | 对象级授权、幂等与并发条件有效 | 取消 accepted/rejected decision 提交 | 权限、终态、政策或幂等冲突 | 退款、履约撤回、库存与促销分别请求 |
| `RequestFulfilmentCancellation` | Fulfilment | fulfilment work 存在且可识别 | 撤回请求及处理状态提交 | 服务方拒绝、工作不可撤回、请求冲突 | Order 消费履约结果事件 |
| `RequestRefund` | Payment | 支付存在、币种一致、金额在剩余可退范围内 | Refund requested/pending 提交 | 支付无效、超额、币种或输入冲突 | 保存 payment/refund/provider/request 关联 |
| `ApplyInventoryEffect` | Inventory | 效果身份、库存对象、数量和原因有效 | applied/pending/failed 事实提交 | 重复冲突、库存无效、路径不允许 | Order 消费库存结果事件 |
| `EvaluatePromotionReuse` | Promotion | Application、规则版本与使用记录可用 | eligible/ineligible decision 提交 | 资料不足、规则版本未知、输入冲突 | 历史折扣快照保持不变 |
| `CloseOrder` | Order | 关闭所需商业、财务与履约事实完备 | `OrderClosed` 提交 | 必要事实 pending、failed 或 unknown | 保存关闭依据的事实引用 |

## 8. Representative Domain Stories

| ID | 场景 | 领域结论 | 规则状态 |
| --- | --- | --- | --- |
| S-01 | 新订单完成有效支付并进入履约 | Order、Payment 与 Fulfilment 分别保存权威事实 | R-01 |
| S-02 | 支付授权或扣款失败/超时 | Payment 保存失败或未知结果，Order 不记录已扣款 | R-01、R-07 |
| S-03 | 未发生扣款且履约未受理的订单请求取消 | 允许自助取消；取消成功后不存在 Refund | R-02、D-01 |
| S-04 | 已扣款且履约未受理的订单请求取消 | 允许自助取消；退款绑定实付余额并独立结算 | R-02、R-03、D-01 |
| S-05 | 履约已受理或进行中且尚未交接承运商时请求取消 | 进入 `cancellation_pending_fulfilment`；履约撤回完成后订单最终取消 | R-07、D-01、D-02 |
| S-06 | 承运商交接后请求取消 | 关闭自助取消并转入售后路径；不自动增加可售库存 | R-01、D-01、D-03 |
| S-07 | 未授权 actor 发起查询或取消 | 对象级授权拒绝且无领域副作用 | R-05 |
| S-08 | 相同请求与幂等身份重放 | 恢复同一权威决定，不重复业务效果 | R-06 |
| S-09 | 相同幂等身份携带不同输入 | 返回幂等冲突并保存拒绝证据 | R-06 |
| S-10 | Refund 事件重复或乱序到达 | 消费方去重并依据 Payment 权威事实收敛 | R-06、R-07 |
| S-11 | Inventory 效果在超时、崩溃或重启边界重试 | 保持当前处理事实，重试不重复效果 | R-06、R-08 |
| S-12 | 完整取消后再次使用优惠券 | 恢复优惠券消耗记录；按再次使用时的规则、有效期和次数重新判断资格，历史折扣快照保持不变 | D-04 |

## 9. Operational Invariants

1. 拒绝的命令不产生跨领域副作用。
2. 重试、重复消息与重启不重复产生业务效果。
3. 冲突的幂等身份复用返回拒绝。
4. 下游 `pending` 或 `unknown` 保持原状态表达。
5. 权威状态损坏进入 fail-closed 恢复流程。
6. 跨领域进度通过业务对象、因果身份和提供商引用追踪。
7. 并发决策采用版本条件、业务锁或等价的不变量保护机制。

## 10. 产品政策

### D-01：自助取消

未扣款的订单允许自助取消。已扣款且履约尚未受理的订单允许自助取消，并独立发起退款。履约已受理或进行中且尚未交接承运商时，订单进入 `cancellation_pending_fulfilment` 并请求履约撤回。`carrier_handoff_committed` 关闭自助取消资格，后续进入售后路径。

### D-02：履约撤回

承运商交接前，Fulfilment 仅在权威工作状态为 `withdrawable` 时受理撤回。撤回分别表达 `requested`、`pending`、`completed`、`refused` 与 `failed`。订单仅在撤回完成后最终取消。

### D-03：库存效果

库存预占尚未消耗时，取消释放预占。库存已消耗且履约成功撤回时，执行一次幂等补偿。承运商交接和仅退款未取消均不自动增加可售库存。

### D-04：优惠券复用

完整取消恢复优惠券消费记录，但不保证可以复用。再次使用时，Promotion 按当时规则、有效期和次数限制重新判断资格。原订单的折扣快照保持不变。仅退款未取消不恢复优惠券消费记录。

### D-05：Actor 权限

客户仅操作自己的订单。客服可以代客户提交操作，但不能绕过领域资格。商家仅操作所属商家的订单与履约。运营覆盖操作需要显式提升权限、原因与工单。系统身份仅执行声明的命令。特权操作与拒绝尝试均保存审计证据。

### D-06：Guest order 访问

Guest 使用经已验证联系方式发送的高熵签名令牌访问订单。令牌绑定租户、订单与允许操作。读取令牌有效 30 分钟；变更操作需要 10 分钟内有效的一次性 OTP。订单被账号认领、订单关闭、令牌撤销或失败次数达到限制时，令牌失效。

### D-07：幂等作用域与保留

命令幂等作用域由租户、actor 或 client、命令类型、目标订单和幂等 key 组成，并绑定规范化输入指纹。消息按 consumer 与 event id 去重。幂等记录保留至订单关闭后 90 天。保留期后的重试先与权威事实或 provider 引用对账；无法证明安全时 fail closed，不按新请求执行。

### D-08：一致性边界

每个权威领域在本地事务中原子提交领域状态、命令决定或 inbox 记录、outbox 记录与审计引用。跨领域效果保持 `requested` 或 `pending`，通过幂等事件与 Saga 恢复最终收敛。外部调用先持久化意图，崩溃后依据 provider 引用对账。

### D-09：审计与保留

审计证据保存 actor 与 scope、业务对象引用、操作、输入指纹、幂等身份摘要、前后版本、政策版本、结果与原因、时间、关联与因果身份、provider 引用和恢复引用。授权、幂等、并发、状态、金额与币种拒绝均保存记录。财务与订单决定保留 7 年，安全拒绝与冲突保留 1 年，投递诊断保留 90 天。审计记录不保存令牌、支付秘密与非必要原始 PII。

## 11. 参考资料

- [Shopify Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order)
- [Shopify orderCancel](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCancel)
- [Shopify Fulfilment Solutions](https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/build-fulfillment-solutions)
- [Adobe Order Workflow](https://experienceleague.adobe.com/en/docs/commerce-admin/stores-sales/order-management/orders/order-processing)
- [Adobe Reservations](https://experienceleague.adobe.com/en/docs/commerce-admin/inventory/basics/order-status)
- [Adobe Coupon Codes](https://experienceleague.adobe.com/en/docs/commerce-admin/marketing/promotions/cart-rules/price-rules-cart-coupon)
- [Stripe Refund](https://docs.stripe.com/api/refunds/create)
- [Stripe Currencies](https://docs.stripe.com/currencies)
- [Stripe Idempotency](https://docs.stripe.com/api/idempotent_requests)
- [Stripe Webhooks](https://docs.stripe.com/webhooks)
- [OWASP API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
- [AWS Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [AWS Saga Orchestration](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html)
