---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, domain-eval-weave, capsule, open-source, package-boundary, contributor-experience]
doc_kind: plan
created: 2026-08-26
description: "DomainEval Weave Phase 4B 产品合同：独立主包、Capsule 贡献体验与开源预览门禁。"
---

# DomainEval Weave Phase 4B 产品方案

## 0. 2026-08-27 品牌修订

Operator 将开源项目品牌确定为 **DomainEval Weave**，主张为 **Make domain truth executable.**。
本修订只迁移新用户公共面：主包为 `@domaineval/weave`，CLI 为 `domain-eval`，可选 DSH 包为
`@domaineval/dsh-adapter`。根 `dsh-eval-lab` 继续作为 private legacy compatibility package；Phase 1–4A
历史合同、artifact identity 和 replay 语义不重写。

## 1. 产品判断

Phase 4A 已证明 runner-neutral Capsule/Evaluator 薄腰能够校验、校准、执行、比较和重放，也用同一 Capsule/Evaluator
完成了一次 bounded DSH control/treatment projection。它仍不是可直接开源的产品：默认 tarball 物理携带历史 DSH/Judge
实现，核心安装仍依赖 DSH，贡献者需要复制示例并手工理解多个 YAML，默认 command runner 仅支持 macOS。

Phase 4B 同时收口两条价值链：

```text
Distribution Boundary
+
Capsule Contribution Experience
```

只分包会得到一个干净 npm 包但没有社区积累能力；只改善 authoring 会继续把数百个 legacy 文件和 DSH dependency
交给新用户。两条缺一不可。

## 2. 一句话目标

> 陌生维护者安装唯一主包 `@domaineval/weave`，无需 DSH/OAuth/模型调用即可初始化、理解、补全、校准和重放一份
> Capsule；同仓库历史 DSH runtime 仍可兼容，但不进入主包 dependency 或 tarball closure。

## 3. 物理产品边界

### 3.1 `@domaineval/weave`

唯一默认主包，包含 Capsule contracts/loader/release、Evaluator Engine、calibration/compare/replay、runner-neutral Harness
projection、CLI、TypeScript API、六份 JSON Schema 与 reference Capsule。它不得依赖 DSH Session、profile、Judge、OAuth、
Commerce production template 或历史 Campaign/Suite。

### 3.2 `@domaineval/dsh-adapter`

可选包，包含 DSH raw Session projection、observation adapters、TDD mechanism evidence 与 Candidate/Harness bridge。它依赖
`@domaineval/weave`，反向依赖禁止。

### 3.3 Legacy 与 research

根 `dsh-eval-lab` package 保留为 private legacy DSH compatibility build；Phase 1–3C production/replay 和 Judge research
继续受历史合同保护，但不再是新用户默认安装面。Phase 4B 不删除历史 artifacts，也不为 legacy 增加新领域模板。

## 4. Capsule 贡献体验

贡献动线只暴露五个主概念：Capsule、Claim、Requirement、Evaluator、Run。Phase 4B 增加三个低魔法命令：

```text
capsule init    创建合法 draft，不复制 Commerce 偶然结构
capsule doctor  给出 readiness、blocker 和下一动作
capsule show    生成人类可读 Truth/Evaluation/Release 摘要
```

现有 `validate/confirm/release/run/calibrate/compare/replay` 保留。工具生成 id/digest/release/run，用户仍编辑透明、可 Git review
的 YAML/Markdown。Phase 4B 不建设自动 LLM 访谈或自动 truth confirmation。

## 5. Readiness 状态

- `draft`：manifest/domain 可解析，允许尚无 Requirement/Evaluator/Case；
- `runnable`：至少一个 Requirement、Evaluator、Candidate，所有 required confirmed Claims 有 checks；
- `qualified`：指定 Evaluator 的 exact release calibration 已持久化且通过；
- `publishable`：qualified，所有来源声明 license/provenance，且无 required truth/observability blocker。

Readiness 是规则向量，不是分数。`doctor` 只报告，不自动确认 Claim、修改 Evaluator 或生成 labels。

## 6. 跨平台 runner

默认 runner 在 macOS 使用 sandbox-exec，在 Linux 使用 bubblewrap-compatible adapter。两者都必须清理环境、禁止网络、只读
Candidate closure、隐藏 Capsule truth/labels，并只允许 scratch 写入。缺失受支持 sandbox 时输出 measurement invalidity，绝不
无沙箱降级执行。Windows 在 Developer Preview 可显式 unsupported。

## 7. 开源预览门禁

Developer Preview 必须满足：

- `@domaineval/weave` tarball 不含 legacy/DSH/Judge 文件或依赖；
- 安装后的 package 可离线 init/validate/calibrate/compare/replay；
- macOS/Linux platform contract 有测试，unsupported host fail closed；
- LICENSE 决策已由 operator 完成；
- CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、GOVERNANCE 与 CI workflow 齐备；
- secret/source-tree/package-closure gates 通过；
- 文档不宣称单 pair uplift、生产 Judge admission 或行业代表性。

Public Alpha 还需要独立 clean-room contributor 完整产生一个 publishable Capsule。

## 8. 非目标

Phase 4B 不建设：

- Web UI、远端 Registry 或 Marketplace；
- 自动访谈、自动 Claim confirmation；
- 第二个真实领域；
- 生产 Semantic/Code Quality Judge；
- Windows sandbox；
- arbitrary remote code execution；
- legacy artifact 删除；
- leaderboard 或 confirmatory Harness uplift。

## 9. 完成定义

Phase 4B implementation candidate 只有在独立 Lab/adapter tarballs、contributor UX、cross-platform fail-closed contract、治理骨架、
clean packed consumer 和全部历史回归同时通过时完成。许可证选择与首次 remote CI 是 Developer Preview 外部门禁；独立人类
clean-room 是 Public Alpha 的额外门禁，均不得由本地测试伪造。
