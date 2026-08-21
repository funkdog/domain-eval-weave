---
feature_ids: [F192, F266, F267]
topics: [dsh, eval-lab, phase-3b, experience-acceptance]
doc_kind: guide
created: 2026-08-21
description: "DSH Eval Lab Phase 3B 完整体验验收指南；不保存具体 Campaign runtime 数据。"
---

# Phase 3B 完整体验验收

本指南帮助 operator 体验下面这条完整链路：

```text
Owner-confirmed Domain Pack
→ Requirement ChangeSet
→ Claim IR
→ deterministic Oracle Plan
→ calibration admission
→ control / treatment Agent Campaign
→ five-axis Delivery Evaluation Report
→ artifact-only replay
```

验收只使用 synthetic 数据，不连接生产数据。具体的 `<ACCEPTANCE_ROOT>`、`<CAMPAIGN_ID>` 和
报告摘要由当次验收回执提供，不写入源码仓库。

## 1. 理解领域真相

在 `<ACCEPTANCE_ROOT>` 中依次查看：

- `domain-eval/sources/implement-reservation-ledger.md`
- `domain-eval/contracts/reservation-ledger-contract/v1.json`
- `domain-eval/requirements/implement-reservation-ledger/v1.json`
- `domain-eval/manifests/reservation-ledger-domain-v1.json`

判断：能否区分“本次 Requirement 要改变什么”与“既有领域约束必须保留什么”。

## 2. 重放 Domain Pack 验证

在 `<ACCEPTANCE_ROOT>` 执行：

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  /Users/slipshod/AIBuild/dsh-eval-lab-runtime/npm-cache/_npx/6c7f445d1bf61956/node_modules/.bin/dsh \
  --profile eval-clowder \
  domain validate domain-eval manifests/reservation-ledger-domain-v1.json
```

预期：`claim_strength=domain_truth_ready`、`overall=green`，所有 readiness 维度为 `pass`。

## 3. 重放已完成的 Delivery 报告

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  /Users/slipshod/AIBuild/dsh-eval-lab-runtime/npm-cache/_npx/6c7f445d1bf61956/node_modules/.bin/dsh \
  --profile eval-clowder \
  delivery report <CAMPAIGN_ID>
```

报告必须分别展示：

- Requirement Delta
- Domain Preservation
- Semantic Residual
- Measurement Validity
- Harness Impact

系统不得用一个跨轴综合分掩盖不同风险。

## 4. 查看判定依据

打开对应 Campaign 的 `delivery/` 目录：

- `claim-ir.json`：Requirement 影响了哪些 Claims
- `oracle-plan.json`：Claims 如何映射为确定性行为
- `grader-admission.json`：为什么该 Grader 有资格判题
- `report.json`：机器可重放结论
- `report.md`：人类可读摘要

检查能否沿 `Claim → behavior → evidence` 追到每项结果。

## 5. 可选：亲自运行新的双臂 Campaign

这一步会产生两个新的模型 Episodes。仍在 `<ACCEPTANCE_ROOT>` 执行：

```bash
/usr/bin/env -i \
  PATH=/Users/slipshod/.nvm/versions/node/v24.16.0/bin:/usr/bin:/bin \
  DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  DSH_EVAL_INSTANCE_ID=clowder-ai \
  /Users/slipshod/AIBuild/dsh-eval-lab-runtime/npm-cache/_npx/6c7f445d1bf61956/node_modules/.bin/dsh \
  --profile eval-clowder \
  delivery run domain-eval manifests/reservation-ledger-domain-v1.json \
  implement-reservation-ledger --timeout-ms 900000
```

确认摘要与 Requirement/Plan 相符后输入 `RUN`。

## 验收判断

- [ ] 我能理解 Domain Pack 与 Requirement 的关系
- [ ] 我能区分 Requirement Delta 与 Domain Preservation
- [ ] 我能从 Claim 追到 behavior 与 evidence
- [ ] 我认同 `accept / reject / inconclusive` 的边界
- [ ] 我认同报告不使用跨轴综合分

本指南只覆盖 `reservation-ledger-v1` 有界确定性模板，不代表开放领域 Grader 或 Phase 3C semantic Judge 已完成。
