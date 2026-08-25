---
feature_ids: [F192, F267]
topics: [dsh, eval-lab, phase-3c, semantic-judge, code-quality, admission, calibration]
doc_kind: research
created: 2026-08-25
description: "Phase 3C 独立 Curator、Judge development、locked holdout 与 fail-closed admission 实跑报告。"
---

# Phase 3C Judge admission 实跑报告

## 结论

本轮没有产生 admitted Judge，也没有启动 Candidate Campaign：

- Semantic Judge v5 在 development cohort 只有 `4/6` exact matches；失败 case 会随重复运行漂移，故在 locked holdout 前拒绝。
- Code Quality Judge v5 在 development cohort 达到 `8/8`，随后完成 locked admission `12/12` 和 locked bias `9/9` 的三次运行；但 admission 中 6/12 cases、8 dimensions 不稳定，bias 中 6/9 cases、7 dimensions 不稳定。
- Phase 3C 合同规定任一 `unstable_across_repeats` 即拒绝 admission，不使用多数票。因此人工标签无法把本轮结果变成 admitted；标签未 unseal。
- production preflight 现在返回 `PHASE3C_JUDGE_NOT_ADMITTED`，并保证 Candidate Episode 未启动。

这不是“没跑完”，而是完整流程到达了预注册的 fail-closed 终点。

## 1. 独立 Curator

独立 Curator root：

`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/phase3c-judge-curation-v2`

四套 label-free inputs：

| Set | Cases | SHA-256 | 分布 |
|---|---:|---|---|
| Semantic locked admission | 12 | `16bcf9fcc3b75811b09c943556032e375174b08b4f3f9291ad6769849bd0e333` | critical 7 / standard 5 |
| Semantic locked bias | 9 | `c89a8b7b02e7705a2423566bc10bf6fe0f5740e680d4a3dc7a035a033a482c63` | critical 6 / standard 3 |
| Code Quality locked admission | 12 | `20dec5b4c3447b085f7b6ce635d2504a02866f65b2cb9eb8ec73fab18a2839bd` | critical 6 / standard 6 |
| Code Quality locked bias | 9 | `9385c010f48156d2dce8772ad2241fd0f3e899c81383001d87ba4bcf9a5a483b` | critical 5 / standard 4 |

两套 bias 各覆盖 order、position、verbosity、format、identifier、comment、language、arm-label 和 prompt-injection。
Curator 独立复算 42/42 closure digests、42 diffs 与 270 次 bias/canonical 行为等价比较；symlink、hardlink 和权限异常均为 0。

## 2. 真实 runner 暴露并修复的协议缺口

在进入 Judge 校准时，真实 DSH Session 暴露了测试替身没有覆盖的缺口：

1. Prompt 未提供 input-manifest 自身 SHA，模型无法填写强制字段。
2. Output schema 只有指针，schema bytes 没进入 no-tools Judge context。
3. Rubric 被调用方 material 当作 untrusted data；改为从已校验 contract 自动注入 trusted control。
4. Judge patch 未禁用 native filesystem/search/todo tools；真实 request header 非空。
5. `read-only + approval never` 不匹配 common permission preset；Judge patch 现在冻结专用 preset。
6. DSH 在无工具时省略 `tools` 字段，而 carrier 只接受显式 `[]`。
7. WebSocket/Session failure 原先抛异常且不落 receipt；现在投影为 `JUDGE_SESSION_INVALID`，仅 transport failure 可按退避重试，output/schema invalid 不可重抽。
8. 长 cohort 被进程中断后只能全量重跑；runner 现在可复核已有 aggregates 并从下一个 case resume。
9. Semantic schema 曾允许非空 `matched_condition_ids`，与 runtime validator 矛盾；生成 schema 现在机械固定为空数组。

上述修复只完善测量协议，没有根据 locked Judge outputs 修改 rubric 或 prompt。

## 3. Semantic development 结果

最终候选 definition：`phase3c-semantic-definition-v5`

- Definition SHA：`dc4b8a48593fca9f1d42b4fd751d6e5d4fe81e55bd6459d6ed6c77bb2601c66e`
- FreezeReceipt SHA：`77777036c8cd65db43a020336ef16b74fbe525682af45ac0825421ba89ee3510`
- Full development summary SHA：`940d97c8534628d6666db148008c3d58b6000cfe628385f67ab430f2cc2e618f`
- Protocol：6/6 cases 均完成三个有效 repeats。
- Exact calibration：4/6。

失败身份会随运行漂移：早期版本在 atomicity、authority-conflict、handoff abstention 上不稳定；v5 针对性 probes 可各自 `1/1`，但 full cohort 的不稳定迁移到 insufficient-evidence 与 prompt-injection equivalent cases。说明继续调 prompt 会拟合 development case，而非消除方差。

结论：Semantic Judge 未达到 exact-unanimity admission 前置条件，未读取或运行 Semantic locked holdout。

## 4. Code Quality development 与 locked runs

最终候选 definition：`phase3c-code-quality-definition-v5`

- Definition SHA：`25a80bc0f6d4d5237c68d9af09782d51ecafd4994653e230931fd2646cd4b915`
- FreezeReceipt SHA：`83c8da67efaef5fbb8c0adccf8d15d19031cf3cd502ff380a6d93144b1c314c4`
- Development：8/8 exact matches，24 valid logical repeats；另有 1 个进程中断 attempt，不计票。

Locked admission：

- Root：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/phase3c-judge-holdout-v5/code-quality-admission-r2`
- Summary SHA：`f9a30877c6e6092ea031832a62c988a7ad5a0d5cbd523d29d992a8fb3cf42ce4`
- 12 cases / 36 logical repeats / 43 attempt receipts。
- 6 unstable cases / 8 unstable dimensions。

Locked bias：

- Root：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/phase3c-judge-holdout-v5/code-quality-bias`
- Summary SHA：`89c8cdb60be92c17fc631fd132aea879732fccc45053a7c0b1363d3f3ca63ee1`
- 9 cases / 27 logical repeats / 30 attempt receipts。
- 6 unstable cases / 7 unstable dimensions。

Code Quality 在已见 development 上全绿，却在独立 locked inputs 上大面积不稳定。这正是独立 holdout 阻止过拟合的作用。

## 5. 为什么没有 unseal 人工标签

Admission 要求每个 case 的三次逐维 map 先 unanimous，再与双人标签及 adjudication 精确比较。当前 locked results 已违反第一项必要条件。人工标签只能判断正确性，不能让不一致的三次 Judge result 变成 unanimous。

因此本轮保持：

- labels unsealed：false；
- JudgeAdmission：未构造；
- Semantic/CQ production contract：未加入 admission SHA；
- Candidate Campaign：未启动；
- 四轴 Candidate verdict：未伪造。

## 6. 对评测设计的判断

### 成立的部分

- 独立 Curator、development/locked/bias digest-disjoint、freeze/execution ordering 和 Candidate isolation 都真实成立。
- Deterministic Observation Boundary 与 LLM Judge 分工成立：确定性事实没有被 LLM 重判。
- 三次 exact-unanimity 与 abstention 没有把模型方差藏在多数票里。
- 独立 holdout 成功揭露了 development 过拟合；若只看 8/8 CQ development，会错误宣布 Judge 可用。

### 当前不成立的部分

- `gpt-5.6-sol/xhigh` 在本合同下不是稳定分类器。Semantic 在 development 已失败；CQ 在 locked admission 与 bias 都大面积 unstable。
- “通过更详细 prompt 解决方差”已被实跑反证：针对性 probes 可转绿，full cohort failure 会迁移。
- 当前不能声称 Phase 3C 已具备自动 Semantic/Code Quality production verdict。

### 建议

1. 保留当前 strict gate，不改成多数票或加权总分；否则只是在隐藏测量不稳定。
2. 把 LLM Judge 暂时降为 evidence-producing/advisory measurement，required semantic/code-quality verdict 继续投影为 `inconclusive`。
3. 下一轮科学问题应是比较不同 Judge mechanism（更稳定的模型、两阶段 evidence extraction→classification、人工终裁），而不是继续改同一 prompt。
4. 只有新 mechanism 在新的 development 与独立 locked holdout 上满足 exact stability 后，才生成生产 admission。

## 7. 清理状态

失败与中断 attempts 保留为诊断 evidence；它们不会进入最终 admission。尝试删除旧 manual/failed runtime roots 时，本宿主无交互确认面，返回 `confirmation_unavailable`，未绕过删除门禁。Source tree 未写入 runtime artifacts。
