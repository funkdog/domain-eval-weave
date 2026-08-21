---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, phase-3b1, commerce, experience-acceptance]
doc_kind: guide
created: 2026-08-21
description: "从电商领域真相到真实 Agent 交付评测的完整体验验收指南。"
---

# Commerce 订单取消完整体验验收

这份指南面向普通软件与互联网产品场景。你要验收的不是“一个测试脚本能不能跑”，而是下面这条链
是否真的连通：

```text
冲突的订单政策来源
→ 领域负责人确认的 6 条 Claims
→ 自助取消 Requirement
→ 确定性 Oracle Plan 与 Grader admission
→ control / treatment 两个真实 Agent Episodes
→ 五轴 Delivery Report
→ 不调用模型的 artifact-only replay
```

所有订单、支付、库存与优惠券均为 synthetic 数据；流程不会连接真实商城或用户数据。

## 1. 先用四个问题理解判题标准

| 例子 | 正确领域判断 | 为什么重要 |
| --- | --- | --- |
| 原价 100 元、实付 80 元，已支付但未发货 | 取消订单并发起 80 元退款 | 退款按实付金额，不按商品原价 |
| 订单已取消，支付渠道仍在处理 | `order=cancelled`，`refund=pending` | “订单已取消”不等于“退款已成功” |
| 已取消订单被重复请求或服务重启后重放 | 库存只释放一次；仍有效的券只恢复一次 | 幂等不能靠请求方自觉 |
| 已发货订单或他人订单 | 已发货转售后；他人订单拒绝且零副作用 | 履约边界与所有权不能被需求覆盖 |

优惠券还有一条独立规则：整单取消时，只有当前仍有效的券才能恢复；过期券不得恢复。

如果这些判断与你对该案例的理解一致，再继续看机器证据。

## 2. 在工作区打开领域真相

本次验收回执会提供一个绝对路径 `<ACCEPTANCE_ROOT>`。在编辑器或 Finder 中打开它，查看：

- `domain-eval/sources/commerce-policy-sources.md`：客服、仓储、支付与营销政策的原始冲突；
- `domain-eval/interviews/commerce-order-onboard-v1/r1.json`：领域负责人如何逐项消解冲突；
- `domain-eval/contracts/commerce-order-contract/v1.json`：6 条已确认领域 Claims；
- `domain-eval/requirements/self-service-order-cancellation/v1.json`：本次需求改变与保留什么；
- `domain-eval/manifests/commerce-order-domain-v1.json`：不可变快照入口。

重点检查 Claims 是否分别覆盖：取消资格、退款结算、库存一次性释放、优惠券恢复、订单所有权、重启与审计。

## 3. 重放 Domain Pack

在 `<ACCEPTANCE_ROOT>` 执行：

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  <DSH_BIN> --profile eval-clowder \
  domain validate domain-eval manifests/commerce-order-domain-v1.json
```

预期：`overall=green`、`claim_strength=domain_truth_ready`，所有 readiness 维度均为 `pass`。

## 4. 重放已经完成的 Commerce Campaign

验收回执还会提供 `<CAMPAIGN_ID>` 与 `<DSH_BIN>`：

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  <DSH_BIN> --profile eval-clowder \
  delivery report <CAMPAIGN_ID> \
  --template commerce-order-cancellation-v1
```

这个命令不得调用模型。它必须从冻结 artifacts 重建同一份报告，并分别展示：

- Requirement Delta：取消与退款需求是否正确实现；
- Domain Preservation：库存、券、所有权、幂等与审计是否保持；
- Semantic Residual：是否还有确定性 Grader 无法判断的 Claim；
- Measurement Validity：Session、Candidate、Oracle 与 deployment 证据是否可信；
- Harness Impact：control/treatment 哪些行为不同以及成本差异。

报告不能用一个“总分”抵消任何领域失败。

## 5. 沿 Claim 追到行为证据

打开：

`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/instances/clowder-ai/campaigns/<CAMPAIGN_ID>/delivery/`

依次查看：

- `claim-ir.json`：Requirement 实际影响的 Claims；
- `oracle-plan.json`：每条 Claim 映射到哪些 Commerce behaviors；
- `grader-admission.json`：Gold、红基线和 5 个风险 mutant 的精确向量；
- `report.json`：机器可重放的五轴结论；
- `report.md`：人类可读摘要。

8 个固定行为必须完整出现且不能跨模板混入 Reservation 字段。其中最直观的四项是：实付金额退款、取消与
退款状态分离、库存 exactly-once、已发货与他人订单拒绝。

## 6. 可选：亲自启动一组新的真实 Agent Episodes

这一步会调用模型两次，并创建永久保存的新 Campaign。仍在 `<ACCEPTANCE_ROOT>` 执行：

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  <DSH_BIN> --profile eval-clowder \
  delivery run domain-eval manifests/commerce-order-domain-v1.json \
  self-service-order-cancellation \
  --template commerce-order-cancellation-v1 \
  --timeout-ms 900000
```

看到确认摘要后，核对 Requirement 和 template id，再输入 `RUN`。执行结束后，用输出中的新 Campaign id
重复第 4、5 步。

## 验收清单

- [ ] 我能解释实付 80 / 原价 100 应退款 80；
- [ ] 我能解释“订单已取消”为什么不等于“退款已成功”；
- [ ] 我能说清库存与优惠券各自何时、最多恢复几次；
- [ ] 我确认已发货订单和他人订单被正确拒绝且没有副作用；
- [ ] 我能从 Domain Claim 追到 behavior 与冻结 evidence；
- [ ] 我能区分 `accept / reject / inconclusive`；
- [ ] 我确认 replay 不调用模型且得到同一 report digest；
- [ ] 我确认报告没有跨轴综合分。

本指南只验收 `commerce-order-cancellation-v1` 这一有界模板，不声称已支持任意领域自动生成 Grader。
