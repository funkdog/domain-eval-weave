---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, capsule, evaluator-engine, open-source-baseline, harness-effect]
doc_kind: plan
created: 2026-08-26
description: "DSH Eval Lab Phase 4A 产品合同：以 runner-neutral Capsule 与 Evaluator Engine 收缩公共表面，同时保留 DSH Harness 配对实验能力。"
---

# DSH Eval Lab Phase 4A 产品方案

## 1. 产品判断

Phase 1–3C 证明了 Candidate 隔离、领域真相确认、确定性判评、校准、配对实验与 artifact replay
可以被严格实现，也暴露了一个新的产品风险：实验室为了证明不可伪造而持久化的内部对象过多，公共参与者被迫理解
runner profile、receipt、admission、digest 与模板实现细节。

Phase 4A 不继续横向扩展 Judge 或领域模板。它建立一个公开的薄腰：

```text
Sources / interview
→ Domain Evaluation Capsule
→ versioned Evaluator
→ Candidate Evaluation
→ optional Harness Experiment
```

Capsule 定义“测什么”；Evaluator 定义“怎么测”；Runner 定义“怎么执行”；Experiment 只定义“改变了什么”。

## 2. 一句话目标

> 一个不了解 DSH Eval Lab 的维护者，无需 DSH、OAuth 或口头指导，即可贡献并演进一份可追溯 Commerce Capsule、
> 比较两个 Evaluator 版本；同一 Capsule 又能通过 DSH adapter 形成不过度归因的 Harness 对照报告。

## 3. 两类独立用户价值

### 3.1 领域资产价值

用户可以：

- 从来源建立 Claims；
- 区分 `confirmed/proposed/unresolved/conflicted/observability_gap`；
- 声明 Requirement Delta；
- 发布、fork 与升级 Capsule；
- 贡献 Gold、equivalent 与 mutant calibration cases；
- 独立升级和比较 Evaluator。

这条旅程不依赖 Agent runtime、Judge 或 Harness。

### 3.2 Harness 实验价值

在同一 frozen Capsule/Evaluator 下，DSH adapter 可以：

- 运行 control/treatment；
- 验证唯一 intervention 与 arm parity；
- 记录 activation、行为与成本；
- 先独立评价两臂 Candidate，再计算 Harness Effect；
- 输出 bounded diagnostic，不自动执行 Harness lifecycle。

## 4. 公共对象

Phase 4A 主流程只暴露五个概念：

1. **Capsule**：来源、领域、需求、Evaluators、Candidates 与 calibration cases 的发布单元；
2. **Claim**：带来源、适用范围、权威状态和风险的产品事实；
3. **Requirement**：相对领域 Claims 的 typed delta；
4. **Evaluator**：逐 Claim observation 与 decision rule 的版本化定义；
5. **Run**：Candidate Evaluation 或 Harness Experiment 的结果。

Digest、pointer、dependency graph、release lock、receipt 与 normal form 均由工具生成或保留在 debug 层。

## 5. Domain Evaluation Capsule

Capsule 是社区贡献和版本化的基本单位：

```text
capsule.yaml
sources/
domain.yaml
requirements/
evaluators/
candidates/
cases/
README.md
```

生成物统一写入 Capsule 内的 `.eval/`，但示例的预生成 release/runs 可以随 source 版本控制以支持离线 replay。
贡献者不手写 SHA、artifact pointer 或 receipt。

Community Domain Knowledge Pack 可以建议问题、风险和 observation adapters，但安装后的内容仍是 `proposed`，不会自动成为
任何产品的 confirmed truth。

## 6. Evaluator Engine

Evaluator 只接受 confirmed Claims 形成 hard pass/fail。其他状态固定投影为非硬判：

| Claim status | Candidate result |
| --- | --- |
| confirmed + checks valid | pass/fail |
| confirmed + runner/observation failure | measurement_error |
| proposed/unresolved/conflicted | inconclusive |
| observability_gap | inconclusive |

Evaluator v2 不覆盖 v1。比较必须基于同一 Capsule、Requirement、Candidates 与 cases，保留逐 Claim delta，
不计算跨 Claim 综合分。

## 7. Runner 与 Experiment

Phase 4A 至少提供：

- 本地 command runner：无 DSH、无网络、无凭证的 reference path；
- DSH adapter：复用现有 runtime 的 Candidate 隔离与 Harness evidence。

Evaluator 不知道 arm label 或另一臂结果。Harness Effect 只能消费已经完成的 Candidate Evaluations，不能改变各自 verdict。

## 8. 参与成本合同

陌生维护者必须能在不读源码的情况下完成：

```text
offline replay
→ 添加 source
→ 添加/确认 Claim
→ 添加 Requirement
→ 添加 mutant
→ 构建 Evaluator v2
→ compare v1/v2
```

所有失败必须定位到用户可编辑文件、对象 ID 与修复动作。内部 artifact 名不能作为主错误信息。

## 9. 历史与研究模块

- Phase 1/2/3 artifacts 保持只读 replay；
- Phase 3C Judge admission 进入 optional research surface；
- Semantic/Code Quality Judge 未 admitted 时不阻止 deterministic Candidate/Harness evaluation；
- 当前 Commerce/Withdrawal 模板作为 Capsule 迁移来源，不再复制为新的 core execution stack。

## 10. 非目标

Phase 4A 不建设：

- 第二个真实领域；
- Domain Marketplace 或远端 Registry；
- Web UI；
- 自动 LLM interview；
- 生产 Semantic/Code Quality Judge；
- 通用 Observation DSL 全覆盖；
- Leaderboard；
- confirmatory Harness effect claim；
- 多用户 RBAC；
- 历史 contract 删除。

## 11. 完成定义

Phase 4A 只有在独立 clean-room 用户完成 Capsule 贡献、Evaluator 迭代、离线 replay，且同一 Capsule 通过 DSH adapter
产生一次 bounded Harness report 后才完成。内部测试通过但该用户旅程失败，产品仍未验收。
