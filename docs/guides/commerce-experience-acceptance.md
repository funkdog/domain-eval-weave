---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, commerce, fulfillment-withdrawal, experience-acceptance]
doc_kind: guide
created: 2026-08-22
description: "从 Commerce 领域真相到真实双臂 Agent Campaign 的当前完整体验验收指南。"
---

# Commerce 订单取消完整体验验收

这份指南面向普通软件与互联网产品场景。验收对象不是一个孤立测试脚本，而是一条可追溯的交付链：

```text
业界资料与项目政策
→ 领域负责人确认的 17 条 Claim
→ self-service-order-cancellation Requirement 的 15-Claim 闭包
→ 确定性的 Claim IR / Oracle Plan
→ Gold、red、11 个风险 mutant 的 Grader admission
→ control / treatment 两个真实 Agent Episode
→ 五轴 Delivery Report
→ 不调用模型的 artifact-only replay
```

所有订单、支付、库存、履约与优惠券均为 synthetic 数据。流程不连接真实商城、支付渠道或用户数据。

## 1. 先理解领域判断

| 场景 | 正确判断 | 关键约束 |
| --- | --- | --- |
| 原价 100 元、实付 80 元，已支付且未开始履约 | 取消并按实付 80 元发起退款 | 金额使用整数 minor units，退款币种与订单一致 |
| 订单已取消，支付渠道仍在处理 | `order=cancelled`、`refund=pending` | 订单已取消不等于退款已成功 |
| 履约进行中但尚未交接承运商 | `withdrawal=pending`，订单暂不取消 | 履约撤回完成后才能取消并执行补偿 |
| 履约撤回被拒绝或失败 | 保持订单与库存、券、退款效果不变 | 失败可重试，拒绝不得伪装成功 |
| 重复请求或服务重启后重放 | 库存最多释放一次；仍有效的券最多恢复一次 | 相同请求重放一致，冲突请求明确拒绝 |
| 已发货订单或他人订单 | 已发货转售后；他人订单拒绝且零副作用 | 履约边界和所有权都必须保持 |

订单、履约、履约撤回、退款是四条正交状态轴。用户界面可以把它们投影为一句状态文案，领域模型和判题证据仍分别保存。

## 2. 领域真相阶段

打开验收回执中的 `<ACCEPTANCE_ROOT>/domain-eval/`，从当前 manifest 进入不可变快照。核心产物是：

- `sources/`：业界资料和项目政策的来源快照；
- `evidence-cards/`：每条主张及其 provenance、适用范围和 observation binding；
- `interviews/`：领域负责人逐项确认后的访谈证据；
- `contracts/commerce-order-contract/`：17 条已确认 Claim；
- `requirements/self-service-order-cancellation/`：本次需求使用、保留及明确不覆盖的 Claim；
- `graphs/` 与 `manifests/`：把上述引用闭合为可重放快照。

在 `<ACCEPTANCE_ROOT>` 重放当前 Domain Pack：

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  <DSH_BIN> --profile eval-clowder \
  domain validate domain-eval manifests/<CURRENT_MANIFEST>.json
```

预期结果为 `overall=green`、`claim_strength=domain_truth_ready`，全部 readiness 维度为 `pass`。

## 3. Grader 编译阶段

`delivery run` 在任何 Candidate 调用前完成三件事：

1. 将 Requirement 的 15 条 Claim 编译成 `claim-ir.json`；
2. 通过冻结 catalog 把 Claim 映射到 16 个固定 behavior，生成 `oracle-plan.json`；
3. 用 Gold、red、11 个定向 mutant、Gold repeat 和 next-seed 生成 `grader-admission.json`。

16 个固定 behavior 分别检查：未支付取消、实付金额退款、已交接转售后、取消/退款分离、履约中进入撤回、撤回完成、撤回拒绝、撤回失败、库存一次性、优惠券有效期、所有权、幂等冲突、重启恢复、金额币种、过期重放、审计与留存。

它们只有 `pass | fail | error`，没有可互相抵消的总分。Gold、red 或任一个 mutant 的精确向量不匹配，Grader 就不得进入真实 Campaign。

## 4. Operator RUN gate

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  <DSH_BIN> --profile eval-clowder \
  delivery run domain-eval manifests/<CURRENT_MANIFEST>.json \
  self-service-order-cancellation \
  --template commerce-order-cancellation-v2 \
  --timeout-ms 900000
```

确认摘要必须显示当前 Requirement、`commerce-order-cancellation-v2` 和已 admitted 的 Plan。只有输入 `RUN` 才会启动两个真实 Agent Episode；拒绝或中断不会创建伪 Campaign。

## 5. Paired Campaign 阶段

同一个 Task、模型、超时和 Oracle 分别运行：

- `control`：不加载待测 Harness；
- `treatment`：加载待测 Harness。

Candidate 只看到 public task、base workspace 与 public tests。它看不到 Domain Pack、Claim IR、Oracle、Gold、mutants、expected vector 或 verdict。每个 Episode 保存输入、输出、workspace、资源成本、Oracle vector 和 deployment fingerprint。

## 6. Report 与重放阶段

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  <DSH_BIN> --profile eval-clowder \
  delivery report <CAMPAIGN_ID> \
  --template commerce-order-cancellation-v2
```

`delivery report` 不调用模型。它只从冻结 artifacts 重新校验 deployment、Requirement、Claim IR、Plan、admission、两个 Episode 和 Oracle evidence，并重建同一 report digest。

报告保留五个独立判断面：

- Requirement Delta：本次需求要求的行为是否实现；
- Domain Preservation：被要求保持的领域真相是否仍成立；
- Semantic Residual：是否仍有确定性 Grader 无法完整观察的 Claim；
- Measurement Validity：Session、Candidate、Oracle 与 deployment 证据是否可信；
- Harness Impact：control 与 treatment 的行为和成本差异。

任一 hard behavior 失败时不能 `accept`；存在 residual 或测量无效时必须 `inconclusive`。

## 7. 查看最终证据

打开：

`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/instances/clowder-ai/campaigns/<CAMPAIGN_ID>/delivery/`

当前交付证据只保留：

- `claim-ir.json`
- `oracle-plan.json`
- `grader-admission.json`
- `observation-catalog.json`
- `report.json`
- `report.md`

Campaign 目录还保存两个 Episode 及其冻结引用。所有引用都带 digest；文件缺失、跨模板、被篡改或 deployment 不一致时 replay 必须 fail closed。

## 验收清单

- [ ] 我能从 17 条领域 Claim 解释 Requirement 为什么只闭合其中 15 条；
- [ ] 我能解释实付 80 / 原价 100 为什么退款 80；
- [ ] 我能解释订单取消、履约撤回和退款为什么是不同状态；
- [ ] 我能解释撤回拒绝或失败为何不得提前产生补偿；
- [ ] 我能说明库存、优惠券、所有权、幂等和重启恢复的约束；
- [ ] 我能从 Claim 追到 behavior、Episode 和冻结 evidence；
- [ ] 我能区分 `accept | reject | inconclusive`；
- [ ] 我确认 replay 不调用模型且得到同一 report digest；
- [ ] 我确认没有总分，也没有跨轴抵消。

本指南验收固定模板 `commerce-order-cancellation-v2`，不代表支持任意领域的开放式 Grader 生成。
