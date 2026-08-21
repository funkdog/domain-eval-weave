---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, phase-3b1, commerce, deterministic-grader]
doc_kind: implementation_spec
created: 2026-08-21
description: "DSH Eval Lab Phase 3B.1：新增电商订单取消与退款有界模板，同时保留 Reservation Ledger v1 replay。"
---

# DSH Eval Lab Phase 3B.1 — Commerce Order Cancellation

> **状态**：operator-selected implementation contract v1。
> 本合同只新增第二个编译期冻结模板 `commerce-order-cancellation-v1`；它不是开放式 registry，
> 不授权 Phase 3C Semantic Judge、任意 grader code generation 或生产数据接入。
>
> **前置真相源**：Phase 3 产品方案与 Phase 3B v1 实现合同。既有
> `reservation-ledger-v1` 的 artifact、Campaign、报告与 replay 必须继续兼容。

## 1. 用户旅程与终态

operator 选择一个人人能理解、又有真实领域语义的需求：

> 用户可以在订单未发货前自助取消。系统必须按支付、履约、库存、优惠券、所有权与审计规则处理后续状态。

完整验收链路：

```text
synthetic commerce sources with policy conflicts
→ owner-confirmed Product Domain Contract
→ owner-confirmed cancel-order Requirement
→ explicit commerce observation bindings
→ Claim IR
→ commerce Oracle Plan
→ Gold / red / five-mutant admission
→ paired real Agent Campaign
→ five-axis Delivery Evaluation Report
→ artifact-only replay
```

验收界面必须让普通用户能回答：

- 实付 80 元、原价 100 元的未发货订单取消后退多少钱？
- “订单已取消”是否等于“退款已成功”？
- 库存和优惠券各在什么条件下恢复？
- 已发货订单、他人订单或重复取消会怎样？

## 2. 有界模板选择，不建开放 registry

生产包只认识两个编译期常量描述符：

```text
reservation-ledger-v1
commerce-order-cancellation-v1
```

CLI 保持既有 Reservation 默认兼容，并新增显式选择：

```text
delivery run <pack> <manifest> <requirement-id>
delivery run <pack> <manifest> <requirement-id> --template commerce-order-cancellation-v1
```

调用方只能传上述 id，不能传 Task Pack path、Oracle path、Gold/mutant path、behavior list、校准 expectation
或 verifier。production facade 将 id 映射到包内固定 descriptor；Domain Pack observation catalog 的
`template_id/task_id/oracle_version` 必须与 descriptor 完全一致。

## 3. Commerce Domain Truth

### 3.1 Requirement Delta Claims

1. `order-cancellation-eligibility`
   - 未支付订单可直接取消且不产生退款；
   - 已支付且未发货订单可取消并创建 `refund_pending`；
   - 已发货订单不得走自助取消，必须进入售后流程。
2. `refund-settlement-contract`
   - 退款金额等于实付金额，不等于商品标价；
   - `cancelled` 与 `refund_pending/refunded` 是独立状态，不得把请求退款伪装成退款成功。

### 3.2 Domain Preservation Claims

3. `inventory-release-once`
   - 取消成功后库存预占只能释放一次；重复、并发或重启重放不得重复释放。
4. `coupon-restoration-policy`
   - 只有整单取消且优惠券在取消时仍有效才恢复；过期券不得恢复。
5. `customer-order-ownership`
   - 只有订单所属 customer 可以发起取消；拒绝不得产生状态或财务副作用。
6. `cancellation-durability-audit`
   - request id 幂等；订单、退款、库存副作用与审计事件必须持久化并可在重启后恢复。

Domain Pack 必须包含来源冲突：客服“发货前均可取消”、仓储“打包锁定”、支付“退款异步”、营销“过期券不返还”。
最终 Grader 只消费 owner-confirmed resolution，不从自然语言关键词猜政策。

## 4. Commerce Behavior Vector

`COMMERCE_BEHAVIORS` 固定顺序：

1. `unpaid_cancel_has_no_refund`
2. `paid_unshipped_creates_paid_amount_refund`
3. `shipped_order_requires_after_sales`
4. `cancellation_and_refund_states_are_separate`
5. `inventory_release_is_exactly_once`
6. `coupon_restore_requires_current_eligibility`
7. `customer_ownership_is_enforced`
8. `restart_recovery_preserves_idempotency_and_audit`

每维只能为 `pass | fail | error`；数组顺序、对象 keys、statement、risk weight 与 Claim mapping 全部由
`commerce-order-observation-catalog.json` 冻结。报告保留行为向量，不计算总体分数。

Claim mapping：

- behaviors 1–4 → Requirement Delta；
- behaviors 5–8 → Domain Preservation。

## 5. Candidate Task Pack

固定 Task Pack：`open-coding-ts-commerce-order-v1`，Oracle：`commerce-order-oracle-v1`。

公开 Candidate API 位于 `src/order-service.ts`：

```typescript
type OrderStatus = "pending_payment" | "paid" | "shipped" | "cancelled"
type RefundStatus = "none" | "pending" | "refunded"

interface Order {
  id: string
  customerId: string
  status: OrderStatus
  listAmount: number
  paidAmount: number
  inventoryReserved: boolean
  coupon?: { id: string; expiresAt: string }
  refundStatus: RefundStatus
}

class OrderService {
  static open(storePath: string): Promise<OrderService>
  createOrder(order: Order): Promise<void>
  cancelOrder(input: {
    orderId: string
    customerId: string
    requestId: string
    now: string
  }): Promise<CancellationResult>
  markRefunded(orderId: string): Promise<void>
  getOrder(orderId: string): Promise<Order | null>
  getAuditEvents(orderId: string): Promise<readonly AuditEvent[]>
}
```

金额为非负安全整数（synthetic currency minor units）。store 必须是 Candidate workspace 内 physical file；
Oracle 使用独立临时目录、并发进程与重启实例验证，不连接真实支付、库存或营销系统。

## 6. Admission corpus

保持九向量 admission 形状：

```text
red
gold
mutant-shipped-cancel
mutant-overrefund
mutant-double-effects
mutant-coupon-always-restored
mutant-no-ownership-or-persistence
gold-repeat
gold-next-seed
```

Exact expectations：

| Candidate | Expected failures |
| --- | --- |
| red | 全八维 |
| mutant-shipped-cancel | shipped_order_requires_after_sales |
| mutant-overrefund | paid_unshipped_creates_paid_amount_refund |
| mutant-double-effects | inventory_release_is_exactly_once, restart_recovery_preserves_idempotency_and_audit |
| mutant-coupon-always-restored | coupon_restore_requires_current_eligibility |
| mutant-no-ownership-or-persistence | customer_ownership_is_enforced, restart_recovery_preserves_idempotency_and_audit |

Gold 必须全 pass；repeat 与 next-seed 必须 byte-identical。任何 extra/missing failure 或 error 都拒绝 admission。

五个 mutant 可由 digest-bound `mutations.json` 从 canonical Gold 确定性物化；每个 operation 必须命中唯一的
显式代码点，否则 calibration 在 Oracle 前 fail closed。mutation manifest 只定义缺陷，不定义 expected vector；expected
failures 仍由独立 observation catalog 冻结，避免同一来源同时出题和写答案。

## 7. Artifact versioning and replay

既有 Reservation artifacts 保持 `schema_version: 1` 与原始八维行为对象，可永久 replay。

Commerce 与新的通用 production path 使用 `schema_version: 2`，并在以下对象显式保存
`template_id: "commerce-order-cancellation-v1"`：

- Task Pack identity / Experiment / Variant / Episode evaluation；
- Claim IR / Oracle Plan / Grader Admission；
- Delivery Evaluation Report。

v2 parser 是严格 discriminated union：template id 决定唯一完整 behavior schema、counterexample ids 与
Oracle version。不得接受 16 维稀疏对象、另一模板 behavior、unknown template 或 caller-provided schema。

Phase 2 Registry/Suite 继续只运行 Reservation v1，不因 Commerce 模板改变 bucket、holdout 或历史 Campaign 语义。

## 8. Production authority boundary

- `delivery run --template ...` 只能选择 production-owned frozen descriptor；
- Task Pack / catalog / Oracle / calibration paths 全部由 descriptor 提供；
- production bundle 继续物理移除 compiler/admission/report/artifact builders；
- persist/replay 必须消费完整 Campaign replay，比较 template、Task Pack、catalog、Oracle、eval-package；
- Candidate workspace、prompt、Session 不得包含 Domain Pack、owner answer、catalog、Oracle、Gold 或 mutants；
- runtime artifacts 只写 `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`，默认永久保存。

三套 profile 的唯一允许 predecessor 是已经完成 Reservation production acceptance 的 exact
`f274e7f0f9556b74c5ce7872b0ec2ee78f8f86d5` package：tar SHA-256
`7a240adde5c14596184c2a9a425e40636c51809771b46dbc320860b28b5e8bcd`，size `362247`，
package-content SHA-256 `cb3f1e27688e5795e2aece8e239390e5be4c2b6c4e6276064d6976a194d156c4`。
successor init 必须原子升级 runner/author profile，并继续拒绝 missing peer、hybrid、split spec、tampered
bytes 与 staging race。

## 9. Metric birth certificate

```yaml
metric_birth_certificate:
  utility_claim: >
    Commerce behavior vector 全 pass，代表交付 Agent 在固定 synthetic 订单取消场景中完成了自助取消需求，
    且没有破坏退款金额、履约边界、库存、优惠券、所有权、幂等与审计真相。
  estimator: >
    一个冻结 Campaign arm 的八维 deterministic Oracle vector；每维由 hidden external process tests裁决，
    error 与 fail 分离；不计算 accuracy、均值或跨维总分。
  validity_bounds: >
    只适用于 open-coding-ts-commerce-order-v1、固定 API、整数金额、synthetic local persistence；
    不外推真实支付到账、部分发货、部分退款、组合促销、税费、跨境或人工售后质量。
  consumer: >
    commerce-order-cancellation-v1 release gate、Delivery accept/reject/inconclusive 与 operator 体验验收；
    任一 hard behavior fail 阻止 accept。
  calibration_plan: >
    frozen Gold、red、五个风险 mutant、Gold repeat、next-seed；exact failure expectations；
    后续政策/API/template 变化必须发布新版本并重新校准。
  repeatability_contract: >
    admission 环节冻结 Task Pack/Oracle/eval package，repeat 与 seed stability 必须逐维一致；
    release acceptance 使用全新隔离 root 跑 paired Campaign 并 artifact-only replay。
```

六公理结论：

- E1：单位是完整 Agent Episode，失败和沉默不从分母消失；
- E2：八维向量保留非对称代价，无总分；
- E3：Domain Owner、Candidate、Gold/mutants 与 Oracle 分权；
- E4：template/catalog/oracle 版本化，政策变化发布 successor；
- E5：verdict、Gold、mutants 不进入 Candidate context；
- E6：固定 calibration corpus 用于 admission，真实 paired Campaign 用于验收，不把单次结果当训练梯度。

## 10. Milestones

### M0 — v2 discriminated contracts

- Reservation v1 replay 不变；
- Commerce v2 schemas/Zod parity；
- cross-template behavior、unknown template、score field、sparse vector fail closed。

### M1 — Commerce Task Pack and Oracle

- base/public API/public tests；
- hidden eight-behavior Oracle；
- Gold/red/five mutants；
- repeatability、seed stability、secret/path isolation。

### M2 — Two-family compiler and admission

- production-owned exact descriptor tuple；
- commerce Domain Pack pointer digest → commerce Claim IR/Plan；
- exact counterexample admission；
- Reservation compiler/admission regression green。

### M3 — Paired Campaign and report

- template-bound Experiment/Episodes/evaluation/report；
- full artifact replay；
- Requirement Delta/Domain Preservation/Validity/Harness Impact；
- no score, no semantic compensation。

### M4 — Synthetic vertical and operator experience

- fresh synthetic commerce Domain Pack；
- Gold-equivalent Agent accept；
- at least shipped/overrefund/double-effect mutants reject；
- real production CLI paired Campaign；
- Workspace-openable guide with concrete customer/order examples；
- Candidate surface absence checks。

## 11. Completion gate

- M0–M4 green；
- full repository check/lint/test/build；
- Skill validator、pack dry-run、diff check；
- source tree无 runtime artifacts；
- stable exact candidate 只做一次 independent cross-cat review；
- merged package 在 fresh acceptance root 完成 real Campaign + artifact-only replay。

本合同只证明第二个有界模板，仍不声称开放领域自动生成 Grader。
