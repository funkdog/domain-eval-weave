---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, commerce, requirement, cancellation]
doc_kind: requirement
created: 2026-08-22
status: confirmed
---

# 订单发货前自助取消

## 1. 基础合同

- Product：`synthetic-commerce-operator-20260822`
- Domain Contract：`commerce-order-contract` v1
- Primary user：已登录的订单所有者

领域合同已经确认：`carrier_handoff_committed` 是关闭自助取消资格的权威事实；履约已受理但尚未交接承运商的订单，通过履约撤回流程完成取消。

## 2. 目标

为订单所有者提供发货前自助取消能力。系统根据 Payment 与 Fulfilment 的权威事实作出订单取消决定，分别推进退款、履约撤回、库存补偿与优惠券恢复，并向客户准确表达仍在进行中的下游结果。

## 3. 范围

本需求覆盖整单取消，适用于以下阶段：

- 未扣款且履约未受理；
- 已扣款且履约未受理；
- 履约已受理或进行中且尚未交接承运商；
- 已完成承运商交接。

调用方提供当前 actor、目标订单、幂等 key、规范化输入与预期订单版本。系统依据对象级授权、当前权威事实和并发条件处理命令。

## 4. 行为矩阵

| 阶段 | 订单决定 | 资金路径 | 履约路径 | 客户可见结果 |
| --- | --- | --- | --- | --- |
| 未扣款、履约未受理 | 接受取消 | 不创建 Refund | 无撤回请求 | `cancelled` |
| 已扣款、履约未受理 | 接受取消 | 按实付余额创建 Refund，允许保持 `pending` | 无撤回请求 | `cancelled`，退款状态独立展示 |
| 履约已受理或进行中、尚未交接承运商 | 接受取消请求 | 在最终取消后按实付余额创建 Refund | 创建履约撤回请求 | `cancellation_pending_fulfilment`；撤回完成后为 `cancelled` |
| 已交接承运商 | 拒绝自助取消 | 不创建新退款 | 不创建撤回请求 | `cancellation_rejected`，原因 `carrier_handoff_committed` |

履约撤回返回 `refused` 或 `failed` 时，订单不得显示为 `cancelled`，并分别展示可解释的拒绝或失败结果。

## 5. 下游效果

- 取消决定、退款请求、退款结算和履约撤回分别记录。
- 未消耗的库存预占在取消后释放。
- 已消耗库存仅在履约撤回成功后执行一次幂等补偿。
- 完整取消恢复优惠券消费记录；再次使用时重新判断当前资格。
- 退款未结算时，订单取消与 `refund_pending` 可以同时成立。
- 每个下游请求拥有独立 request/event identity，并分别表达 `requested`、`pending`、`completed` 或 `failed`。

## 6. 必须保持的领域约束

- 仅订单所有者可以发起本需求中的自助取消。
- 退款绑定实际 Payment、币种与剩余可退余额；退款金额使用实付金额，不使用商品标价。
- 相同幂等身份与相同输入恢复同一决定，不重复产生退款、库存、优惠券或生命周期效果。
- 相同幂等身份携带不同规范化输入时返回冲突。
- 订单状态、命令决定、outbox 与审计引用在 Order 本地事务中原子提交。
- Payment、Fulfilment、Inventory 与 Promotion 分别维护自身权威事实并最终收敛。
- 授权拒绝、版本冲突、非法状态和下游失败均不产生未经授权的副作用，并保存规定的审计证据。

## 7. 验收用例

1. 标价 100、实付 80 的已扣款未发货订单取消后，订单为 `cancelled`，Refund 金额为 80，退款可以保持 `pending`。
2. 履约已受理但尚未交接承运商时，取消请求先进入 `cancellation_pending_fulfilment`；撤回完成后订单才变为 `cancelled`。
3. 履约撤回被拒绝时，订单不进入 `cancelled`，且不创建库存补偿或优惠券恢复效果。
4. 承运商交接后请求自助取消，返回 `cancellation_rejected`，不创建退款、撤回、库存或优惠券效果。
5. 非订单所有者请求取消，授权拒绝且无领域副作用。
6. 相同请求在超时、重启或重复投递后重放，不重复产生任何业务效果。
7. 相同幂等 key 携带不同输入时返回幂等冲突。
8. Order 决定已经提交但下游仍为 `pending` 时，重启后能够依据 outbox、provider 与因果引用继续收敛。

## 8. 非目标

- 部分取消、部分发货与拆单；
- 退货物流与承运商交接后的售后实现；
- 退款时效承诺；
- 税费、跨境、欺诈裁决、平台分账与会计总账；
- Guest order 取消。

## 9. 交付证据

交付结果需要证明行为矩阵中的成功与拒绝路径，并提供授权、幂等冲突、重复投递、并发版本冲突、重启恢复和下游 `pending` 的可重放证据。
