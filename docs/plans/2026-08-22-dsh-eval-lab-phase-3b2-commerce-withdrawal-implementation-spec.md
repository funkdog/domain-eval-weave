---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, phase-3b2, commerce, fulfillment-withdrawal, deterministic-grader]
doc_kind: implementation_spec
created: 2026-08-22
description: "DSH Eval Lab Phase 3B.2：为履约中订单取消发布正交状态轴的 Commerce successor Grader，同时永久保留 v1 replay。"
---

# DSH Eval Lab Phase 3B.2 — Commerce Fulfillment Withdrawal

> **状态**：operator-authorized successor implementation contract。
> 本合同新增第三个编译期冻结模板 `commerce-order-cancellation-v2`。它不修改或覆盖
> `reservation-ledger-v1` 与 `commerce-order-cancellation-v1`，也不引入开放 registry、LLM Judge、生产数据或任意 Grader 代码生成。

## 1. 问题与终态

已确认的 `self-service-order-cancellation` Requirement 要求：履约已受理或进行中且尚未交接承运商时，客户取消请求进入
`cancellation_pending_fulfilment`；只有履约撤回完成后订单才最终取消，撤回拒绝或失败均不得提前产生退款、库存补偿或优惠券恢复。

Commerce v1 只有 `pending_payment | paid | shipped | cancelled` 单轴状态，无法表达上述流程。Phase 3B.2 采用业界常见的正交状态轴：

```text
Order lifecycle
+ Fulfillment lifecycle
+ Fulfillment withdrawal lifecycle
+ Refund lifecycle
→ customer-visible projection
```

完整终态：

```text
owner-confirmed Contract + Requirement successor
→ explicit v2 observation bindings
→ v2 Claim IR / Oracle Plan
→ Gold / red / eleven-mutant admission
→ real paired Agent Campaign
→ five-axis Delivery report
→ artifact-only replay
```

## 2. 固定模板身份与兼容性

```text
template_id: commerce-order-cancellation-v2
task_id:     open-coding-ts-commerce-order-v2
oracle:      commerce-order-oracle-v2
catalog:     commerce-order-cancellation-v2@1
```

生产 selector 只接受三个常量：

```text
reservation-ledger-v1
commerce-order-cancellation-v1
commerce-order-cancellation-v2
```

v1 的 Task Pack、schemas、Campaign、报告、render 与 replay bytes 永久不变；v2 artifact 继续使用严格 discriminated schema，
template id 决定唯一行为向量、counterexample 集、Oracle version 与 Task Pack identity。

## 3. Requirement closure

v2 Requirement successor 的 requested closure 固定为 15 个 confirmed Claims。

### Uses

```text
CLM-COMMERCE-R01
CLM-COMMERCE-R02
CLM-COMMERCE-R07
CLM-COMMERCE-D01
CLM-COMMERCE-D02
```

### Preserves

```text
CLM-COMMERCE-R03
CLM-COMMERCE-R04
CLM-COMMERCE-R05
CLM-COMMERCE-R06
CLM-COMMERCE-R08
CLM-COMMERCE-D03
CLM-COMMERCE-D04
CLM-COMMERCE-D07
CLM-COMMERCE-D08
CLM-COMMERCE-D09
```

`D05` 的客服/运营/商家特权路径与 `D06` Guest order 均为本需求明确非目标；v2 Requirement 不声称评测它们。

## 4. Candidate API

不把长流程压进单一 `OrderStatus`：

```typescript
type OrderStatus = "pending_payment" | "paid" | "cancelled" | "closed"
type FulfillmentState = "not_started" | "active" | "handed_off"
type WithdrawalState = "none" | "pending" | "completed" | "rejected" | "failed"
type RefundStatus = "none" | "pending" | "refunded" | "failed"

interface Order {
  id: string
  customerId: string
  status: OrderStatus
  fulfillmentState: FulfillmentState
  withdrawalState: WithdrawalState
  listAmount: number
  paidAmount: number
  refundAmount: number
  currency: string
  inventoryReserved: boolean
  coupon?: { id: string; expiresAt: string; restored: boolean }
  refundStatus: RefundStatus
  version: number
}

interface WithdrawalResolutionInput {
  orderId: string
  requestId: string
  providerRef: string
  outcome: "completed" | "rejected" | "failed"
  now: string
}

interface RetentionPolicy {
  idempotencyDays: 90
  financialAndOrderDays: 2555
  securityConflictDays: 365
  deliveryDiagnosticDays: 90
}

class OrderService {
  static open(storePath: string): Promise<OrderService>
  createOrder(order: Order): Promise<void>
  cancelOrder(input: CancellationInput): Promise<CancellationResult>
  resolveWithdrawal(input: WithdrawalResolutionInput): Promise<CancellationResult>
  markRefunded(orderId: string): Promise<Order>
  getOrder(orderId: string): Promise<Order | null>
  getAuditEvents(orderId: string): Promise<readonly AuditEvent[]>
  getRetentionPolicy(): Promise<RetentionPolicy>
}
```

金额为非负安全整数的 minor units；`currency` 为订单与退款共享的 uppercase ISO-like synthetic code。store 只能是 Candidate workspace
内 single-link physical file。Oracle 使用隔离临时目录、独立进程、模拟时间与重启实例，不连接真实支付、库存、履约或营销系统。

## 5. 固定 16 维 Behavior Vector

顺序不可修改：

1. `unpaid_cancel_has_no_refund`
2. `paid_unstarted_creates_paid_amount_refund`
3. `handed_off_order_requires_after_sales`
4. `cancellation_and_refund_states_are_separate`
5. `active_fulfillment_enters_pending_withdrawal`
6. `withdrawal_completion_precedes_cancellation`
7. `withdrawal_rejection_preserves_order_and_effects`
8. `withdrawal_failure_is_recoverable_without_effects`
9. `inventory_compensation_is_exactly_once`
10. `coupon_restore_requires_current_eligibility`
11. `customer_ownership_is_enforced`
12. `request_replay_and_conflict_are_idempotent`
13. `restart_recovery_preserves_handoffs_and_audit`
14. `refund_preserves_paid_amount_currency_and_units`
15. `expired_replay_reconciles_or_fails_closed`
16. `audit_and_retention_policy_are_complete`

每维只能是 `pass | fail | error`，不计算总分。Claim 必须绑定一个或多个完整覆盖其当前 statement/applicability 的 behavior；无完整观察面时保留
semantic residual 并令 Delivery verdict `inconclusive`，禁止把部分测试伪装为完整 Claim pass。

## 6. Claim observation mapping

| Claim | Behaviors |
| --- | --- |
| R01 | 4, 5, 9, 10, 13, 14 |
| R02 | 4 |
| R03 | 2, 14 |
| R04 | 14 |
| R05 | 11 |
| R06 | 9, 12, 13, 15 |
| R07 | 4, 5, 6, 7, 8, 9, 10, 13 |
| R08 | 12, 13, 15, 16 |
| D01 | 1, 2, 3, 5 |
| D02 | 5, 6, 7, 8 |
| D03 | 7, 8, 9 |
| D04 | 10 |
| D07 | 12, 15 |
| D08 | 5, 6, 7, 8, 13 |
| D09 | 13, 16 |

catalog entry statement、risk、order 与 JSON-pointer digest 均冻结；Domain Pack 只消费 catalog snapshot，不从 Claim 文本关键词猜 mapping。

## 7. Admission corpus

固定候选顺序：

```text
red
gold
mutant-handed-off-cancel
mutant-overrefund-or-currency
mutant-premature-cancel
mutant-withdrawal-rejection-effects
mutant-withdrawal-failure-effects
mutant-double-effects
mutant-coupon-always-restored
mutant-no-ownership
mutant-no-persistence
mutant-expired-replay-fresh
mutant-sparse-audit
gold-repeat
gold-next-seed
```

Exact failures：

| Candidate | Expected failures |
| --- | --- |
| red | 全 16 维 |
| mutant-handed-off-cancel | 3 |
| mutant-overrefund-or-currency | 2, 6, 13, 14, 15 |
| mutant-premature-cancel | 5, 6, 7, 8, 9, 13, 16 |
| mutant-withdrawal-rejection-effects | 7 |
| mutant-withdrawal-failure-effects | 8 |
| mutant-double-effects | 9, 12, 15 |
| mutant-coupon-always-restored | 10 |
| mutant-no-ownership | 11 |
| mutant-no-persistence | 8, 13, 15 |
| mutant-expired-replay-fresh | 15 |
| mutant-sparse-audit | 8, 13, 15, 16 |

Gold 全 pass；repeat 与 next-seed 必须逐维 byte-identical。mutations manifest 只定义唯一代码变异点；expected vector 由独立 catalog 冻结。

## 8. Metric birth certificate

```yaml
metric_birth_certificate:
  utility_claim: >
    16 维 Commerce v2 behavior vector 全 pass，代表交付 Agent 在固定 synthetic 整单取消场景中正确处理
    未履约、履约中撤回与承运商交接三条路径，并保持退款、库存、优惠券、所有权、幂等、恢复与审计约束。
  estimator: >
    每个冻结 Campaign arm 的 16 维 deterministic external-process Oracle vector；每维保留 pass/fail/error，
    沉默与进程失败记 error，不计算 accuracy、均值或跨维总分。
  validity_bounds: >
    只适用于 open-coding-ts-commerce-order-v2、固定 API、整单取消、单履约工作、整数 minor-unit 金额、
    单订单币种与 synthetic local persistence；不外推部分发货/取消/退款、多仓拆单、真实支付到账、税费、跨境、
    欺诈、客服/运营/商家特权操作、Guest order 或人工售后质量。
  consumer: >
    commerce-order-cancellation-v2 release gate、Delivery accept/reject/inconclusive 与本次 operator 体验验收；
    任一 hard behavior fail 阻止 accept，任一 semantic residual 或 measurement invalid 产生 inconclusive。
  calibration_plan: >
    frozen Gold、red、十一个定向风险 mutant、Gold repeat 与 next-seed；每个 mutant 的 exact failure set 必须匹配，
    API、状态轴、catalog、Oracle 或政策改变时发布 successor 并重新校准。
  repeatability_contract: >
    admission 环节冻结 Task Pack/Oracle/catalog/eval package；Gold repeat 与 seed stability 逐维一致；
    release acceptance 在全新隔离 root 运行 paired Campaign，并由 artifact-only replay 重建相同报告。
```

六公理：episode 是单位；保留多维非对称风险；Domain Owner/Candidate/Gold-mutants/Oracle 分权；所有身份版本化；
Gold、mutants、verdict 不进入 Candidate context；calibration 与真实 Campaign 分离。

## 9. 生产与安全边界

- production facade 独占 descriptor、compiler、admission、persist/replay builders；发布包物理移除 trusted sibling imports；
- Candidate 只看到 public task、base workspace 与 public tests，不看到 Domain Pack、catalog、Oracle、Gold、mutants、Claim IR 或 verdict；
- v2 Experiment、Variant、Episode evaluation、Claim IR、Plan、Admission 与 Delivery Report 全部 template-discriminated；
- persist/replay 必须比较 Domain Manifest、Requirement、Task Pack、catalog、Oracle、eval package、Campaign deployment 与 evidence pointers；
- runtime artifact 永久写在 dedicated runtime root，无 TTL；源码树不写 runtime artifacts；
- profile upgrade 只接受已通过 Phase 3B.1 production acceptance 的 exact predecessor，并保持 cohort 原子性。

## 10. Milestones

### M0 — Successor contracts

- v2 template schemas/catalog/candidate ids；
- v1 replay byte-compatible；unknown/cross-template/sparse vectors fail closed。

### M1 — Task Pack and Oracle

- orthogonal state API、public tests、Gold、red、eleven mutants；
- 16 hidden behaviors、restart/concurrency/simulated-time/path isolation；
- repeat/seed stability。

### M2 — Compiler and admission

- 15-Claim observation closure → Claim IR/Plan；
- semantic replay；exact mutant expectations；
- v1 compiler/admission regression。

### M3 — Campaign and report

- v2 Experiment/Variant/Episodes/report/persist/replay；
- five axes、no score、residual cannot compensate；
- Candidate surface absence。

### M4 — Acceptance

- full unit/contract/integration/build/pack gates；
- source tree clean；
- stable exact candidate 一次 independent cross-cat review；
- reviewed tar 原子升级 isolated profiles；
- fresh production CLI Campaign、artifact-only replay、Gold-equivalent accept 与定向 mutant reject。

## 11. Completion gate

- M0–M4 全绿；
- metric birth certificate 六公理无否决项；
- existing Reservation v1、Commerce v1 历史 replay 与 package API 全绿；
- operator 当前 Domain Pack 以 Requirement successor 排除 D05/D06，15 个 Claim 全部具有完整 v2 observation binding；
- 正式 package 不暴露 trusted builders；
- 最终 runtime 清理所有失败/无引用文件，仅保留可重放证据。

本合同证明一个新的有界 successor template，不声称开放领域自动生成 Grader。
