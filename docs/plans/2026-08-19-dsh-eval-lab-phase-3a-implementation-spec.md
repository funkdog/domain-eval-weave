---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, phase-3a, domain-truth, requirement-binding, agent-skill]
doc_kind: implementation-plan
created: 2026-08-19
description: "DSH Eval Lab Phase 3A 的决策完备实现规格：领域访谈 Skill、Evidence Cards、版本化 Product Domain Contract、Requirement ChangeSet 与影响图。"
---

# DSH Eval Lab Phase 3A Implementation Spec

> 产品边界：[DSH Eval Lab Phase 3 Product Plan](./2026-08-19-dsh-eval-lab-phase-3-product-plan.md)。
>
> **状态**：approved implementation contract v1。Phase 3A 获准实施；Phase 3B deterministic grader compiler 与
> Phase 3C Semantic Judge 尚未获准编码。

## 0. 冻结结论

Phase 3A 交付一个 authoring-plane 纵向闭环：

```text
`design-domain-grader` Skill
→ persistent InterviewSession / EvidenceCard
→ issued ProductDomainContract
→ RequirementChangeSet
→ deterministic ClaimDependencyGraph / impact query
→ DomainTruthReadinessReport
```

实现必须遵守：

1. Domain Knowledge Pack 只有建议权，没有产品真相权威。
2. 只有 `confirmed` Evidence Card 可以晋升为已签发 Product Domain Contract Claim。
3. Domain Contract 与 Requirement ChangeSet 是不同生命周期、不同版本对象。
4. `introduces/modifies/deprecates` 只形成 requirement-scoped proposal，不自动修改 Contract。
5. Authoring Skill、owner answers、Domain Pack、Gold/mutants 和 readiness 不进入 Candidate runner。
6. 所有运行态继续位于 `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`；用户选择持久化到 source repo 的
   domain-eval artifact 是产品文档/契约，不是 Eval Lab runtime。
7. Phase 3A 不运行 Candidate、不生成 Grader、不调用 LLM Judge、不产生 lifecycle action。
8. Phase 1/2 Campaign、Suite、Registry、exposure、reservation 与 replay 语义保持不变。

## 1. Package 与目录

新增 package surfaces：

```text
contracts/
├── domain-evidence-card.schema.json
├── domain-interview-session.schema.json
├── product-domain-contract.schema.json
├── requirement-change-set.schema.json
├── claim-dependency-graph.schema.json
└── domain-truth-readiness.schema.json

skills/design-domain-grader/
├── SKILL.md
├── references/
│   ├── interview-protocol.md
│   ├── artifact-contracts.md
│   └── failure-modes.md
└── assets/
    └── domain-eval/
        ├── product-domain-contract.json
        └── requirement-change-set.json

src/domain/
├── contracts.ts
├── promotion.ts
├── graph.ts
├── pack.ts
├── readiness.ts
└── skill-provider.ts
```

Skill 目录是发布物的一部分。不得把领域政策塞进 `SKILL.md`；差异化知识由显式 Domain Knowledge Pack 或用户证据提供。

## 2. Authoring profile 与隔离

Phase 3A 新增 profile：

```text
author profile: eval-clowder-author
instance id:    clowder-ai
session root:   <DSH_HOME>/sessions/clowder-ai-author
```

Author profile 使用 DSH headless/standard Agent surface，启用：

- package 内 embedded `design-domain-grader` Skill；
- normal skill catalog/loader；
-受 DSH workspace policy 约束的文件读取与编辑；
- 与现有 transport 相同的 pinned provider/model/effort。

它固定禁用：

- `dsh-eval-app` management command plugin；
- `dsh-eval-bridge` Candidate bridge；
- Candidate workspace/Oracle/exposure/Suite 路径读取；
- production data/network connector。

Runner profile `eval-clowder-runner` 必须继续禁用 `tool-skill`、filesystem/shell/web 等既有禁止工具，且
`design-domain-grader` provider row 为 disabled。Contract test 必须证明 authoring bytes 不进入 Candidate composed surface。

## 3. Skill contract

Skill 名固定为 `design-domain-grader`，frontmatter 仅包含 `name` 与 `description`。正文低于 500 行，详细合同和
failure modes 按需从一层 `references/` 加载。

### 3.1 触发与模式

Skill 在用户要求下列工作时触发：领域接入、设计领域 Grader、梳理业务真相/不变量、需求与领域 Contract 绑定，
或显式使用 `/design-domain-grader`。

第一次动作必须选择：

- `onboard`：不存在可验证 Contract 或用户要求从头接入；
- `delta`：已有可验证 Contract，当前目标是一个新需求或政策变化；
- `audit`：目标是检查 Contract 过期、冲突、观察面或影响闭包。

### 3.2 访谈策略

Skill 先读取用户授权范围内的权威证据，再问无法从证据推出的问题。问题按 information gain 排序：

1. 一个真实成功案例；
2. 一个真实失败/拒绝案例；
3. 重复与冲突请求；
4. 并发、乱序、延迟；
5. 中断、重启、补偿；
6. 跨系统身份、权威观察和时间窗；
7. false accept / false reject 的产品风险。

不得使用固定八十题问卷。每轮最多提出三个紧密相关的问题，并回放当前状态投影。

### 3.3 Fail-closed 规则

Skill 必须把以下情况保留为非 confirmed：

- 只有 Domain Knowledge Pack 或模型先验支持；
- 权威来源缺失；
- 两个权威来源冲突；
- 产品政策需要 owner 选择；
- 可观察事实不足以执行判定；
- 法律、体验、审美等开放语义没有冻结 rubric。

Skill 不得自行签发 Contract；它只生成 candidate artifacts，Domain Owner 的显式确认事件才允许执行 promotion。

## 4. JSON contract

所有 schema 使用 `schema_version: 1`、strict object、canonical JSON 与 SHA-256。拒绝未知字段、重复 id、绝对路径、
反斜杠、`..`、空 segment、非有限数字和不认识的 enum。时间必须是规范 UTC ISO-8601。

### 4.1 SourceRef

```ts
interface SourceRef {
  readonly source_id: string
  readonly kind: 'owner_statement' | 'requirement' | 'product_doc' | 'external_contract' |
    'code' | 'test' | 'runtime_observation' | 'domain_knowledge'
  readonly artifact_ref: string
  readonly digest: string
  readonly locator?: string
}
```

`artifact_ref` 是 pack-root-relative portable ref。`locator` 只允许文档 anchor、JSON pointer 或代码 symbol，不能包含
host absolute path。`domain_knowledge` 永远不能单独支持 promotion。

### 4.2 DomainInterviewSession

```ts
interface DomainInterviewSession {
  readonly schema_version: 1
  readonly interview_id: string
  readonly mode: 'onboard' | 'delta' | 'audit'
  readonly product_id: string
  readonly domain_ids: readonly string[]
  readonly base_contract?: ArtifactPointer
  readonly requirement_ref?: SourceRef
  readonly source_snapshot: readonly SourceRef[]
  readonly turns: readonly InterviewTurn[]
  readonly evidence_card_refs: readonly ArtifactPointer[]
  readonly decision_packet: readonly DecisionQuestion[]
  readonly status: 'draft' | 'awaiting_owner' | 'completed' | 'aborted'
  readonly started_at: string
  readonly ended_at?: string
}
```

每个问题保留 `question_id`、`reason`、`blocked_claim_ids`、输入来源与 owner answer ref。不得只保存最终摘要。

### 4.3 DomainEvidenceCard

```ts
type EvidenceStatus =
  | 'confirmed'
  | 'proposed'
  | 'unresolved'
  | 'conflicted'
  | 'observability_gap'

interface DomainEvidenceCard {
  readonly schema_version: 1
  readonly card_id: string
  readonly product_id: string
  readonly domain_id: string
  readonly claim_id: string
  readonly statement: string
  readonly applicability: string
  readonly status: EvidenceStatus
  readonly source_refs: readonly SourceRef[]
  readonly authority_ref_ids: readonly string[]
  readonly observation_ref_ids: readonly string[]
  readonly false_accept_risk: 'low' | 'medium' | 'high' | 'critical'
  readonly false_reject_risk: 'low' | 'medium' | 'high' | 'critical'
  readonly confirmed_by?: string
  readonly confirmed_at?: string
  readonly conflict?: { readonly source_ref_ids: readonly string[]; readonly reason: string }
}
```

Semantic validator 强制：

- `confirmed` 必须有 `confirmed_by/at`、至少一个 authority ref，且不能只有 `domain_knowledge`；
- `conflicted` 必须列出至少两个不同 source ref；
- `observability_gap` 的 observation refs 必须为空或显式指向不可用观察；
- 其他状态不得携带 owner confirmation。

### 4.4 ProductDomainContract

```ts
interface ProductDomainContract {
  readonly schema_version: 1
  readonly contract_id: string
  readonly product_id: string
  readonly version: number
  readonly predecessor?: ArtifactPointer
  readonly issued_by: string
  readonly issued_at: string
  readonly source_snapshot_digest: string
  readonly claims: readonly ProductDomainClaim[]
}
```

每个 `ProductDomainClaim` 必须回指一个 confirmed Evidence Card digest。Claim ID 在 Contract 版本间稳定；同一版本
ID 唯一。新版本不得静默删除 Claim，只能以显式 supersede/retire relation 表达。

### 4.5 RequirementChangeSet

```ts
interface RequirementChangeSet {
  readonly schema_version: 1
  readonly requirement_id: string
  readonly version: number
  readonly product_id: string
  readonly requirement_refs: readonly SourceRef[]
  readonly base_contract: ArtifactPointer
  readonly effects: {
    readonly uses: readonly ClaimRef[]
    readonly preserves: readonly ClaimRef[]
    readonly introduces: readonly ProposedClaim[]
    readonly modifies: readonly ClaimModification[]
    readonly deprecates: readonly ClaimRef[]
    readonly conflicts_with: readonly ClaimConflict[]
  }
  readonly decision_question_ids: readonly string[]
  readonly status: 'draft' | 'owner_confirmed' | 'withdrawn'
  readonly confirmed_by?: string
  readonly confirmed_at?: string
}
```

`owner_confirmed` 要求零 blocking decision question；它仍不修改 ProductDomainContract。

### 4.6 ClaimDependencyGraph

Graph 是上述 primary artifact 的派生 snapshot：

```ts
interface ClaimDependencyGraph {
  readonly schema_version: 1
  readonly product_id: string
  readonly contract: ArtifactPointer
  readonly requirements: readonly ArtifactPointer[]
  readonly nodes: readonly ClaimGraphNode[]
  readonly edges: readonly ClaimGraphEdge[]
  readonly reverse_index: Readonly<Record<string, readonly string[]>>
}
```

Edges 只允许 `depends_on/uses/preserves/introduces/modifies/deprecates/conflicts_with`。Graph builder 必须检测重复边、
missing node、invalid contract version、非法 Claim dependency cycle，并证明 reverse index 可由 edges 重新生成。

## 5. Promotion 与 readiness

Promotion 是纯函数：输入 verified Evidence Cards + owner confirmation event，输出下一候选 Contract。它不得读取 Session
自由文本、当前模型上下文或 mutable global state。

`DomainTruthReadinessReport` 保存多维状态：

```text
source_integrity
owner_confirmation
conflict_state
observability
requirement_binding
impact_closure
artifact_replay
overall = green | yellow | red
```

`overall` 是规则化 gate，不是加权总分：

- 任一 artifact/digest/graph invalid → red；
- blocking conflict/unresolved/observability gap → red；
- 非 blocking unresolved 或未来 audit warning → yellow；
- 当前 requested closure 全部 confirmed、可追踪且可重放 → green。

Green 只表示 `domain_truth_ready`，不表示 grader admitted、需求已交付或 Harness 有效。

## 6. CLI surface

Management profile 新增 deterministic、无模型命令：

```text
dsh --profile eval-clowder domain validate <relative-pack-path>
dsh --profile eval-clowder domain impact <relative-pack-path> <claim-id>
```

要求：

- pack path 相对 invocation cwd，realpath containment，不接受 absolute/traversal/symlink；
- `validate` 解析所有 primary artifacts、重建 graph/readiness 并比较 frozen bytes；
- `impact` 只在 validate 通过后输出依赖 Requirement/Claim IDs；
- 不调用模型、不读取 live Candidate/Suite/Profile/Session、OAuth 或 ambient home；
- 不自动修复或覆盖 artifact。

Authoring profile 入口：

```text
DSH_HOME=<dedicated-home> \
DSH_EVAL_INSTANCE_ID=clowder-ai \
  dsh --profile eval-clowder-author \
  "/design-domain-grader onboard <synthetic-domain-description>"
```

用户也可以从持久 Session 继续 delta/audit；Phase 3A 不提供自动 Session TTL。

## 7. Milestones（red → green）

### Milestone 0 — Truth source and schemas

- Phase 2/Phase 3 canonical docs and AGENTS routing；
- 六个 JSON Schema + Zod parser parity；
- SourceRef/path/time/id/status failure tests；
- no Phase 1/2 schema regression。

### Milestone 1 — Promotion and Contract versioning

- Evidence Card semantic validation；
- confirmed-only promotion；
- stable Claim IDs and predecessor binding；
- proposed/conflicted/observability-gap red tests。

### Milestone 2 — Requirement binding and impact graph

- all six requirement edge kinds；
- cross-domain requirement；
- same Claim reused by two requirements；
- reverse impact closure and deterministic graph replay；
- missing node/cycle/alias rejection。

### Milestone 3 — Skill and authoring profile

- initialize `design-domain-grader` with the canonical skill scaffold；
- concise SKILL.md + one-level references/assets；
- embedded provider and author profile materialization；
- runner visibility regression test；
- `domain validate` / `domain impact` CLI。

### Milestone 4 — Synthetic vertical acceptance

- synthetic commerce onboarding；
- second requirement delta against same Contract；
- one shared Claim reused；
- one requirement spanning payment + inventory domain slices；
- one seeded policy ambiguity, conflict and observability gap remain non-confirmed；
- three forward runs for unauthorized-truth-promotion metric；
- independent missing-question/content review；
- package/build/import/pack gates and clean candidate。

## 8. Acceptance criteria

- **P3A-AC1** Skill supports onboard/delta/audit and persists every question/answer/evidence transition.
- **P3A-AC2** Only owner-confirmed, provenance-bound Evidence Cards enter ProductDomainContract.
- **P3A-AC3** ProductDomainContract and RequirementChangeSet retain independent versions/lifecycles.
- **P3A-AC4** All six requirement edge kinds validate, and requirement-scoped proposals do not mutate the base Contract.
- **P3A-AC5** One confirmed Claim is referenced by at least two Requirements without duplication.
- **P3A-AC6** One Requirement spans at least two domain slices and produces deterministic impact closure.
- **P3A-AC7** Graph/reverse index/readiness can be rebuilt from frozen primary artifact and detect drift.
- **P3A-AC8** delta mode does not ask about unrelated unchanged confirmed Claims.
- **P3A-AC9** Candidate runner cannot discover Skill, owner answer, Domain Pack or authoring artifacts.
- **P3A-AC10** Phase 1/2 Campaign/Suite/replay/holdout tests remain green and their semantics unchanged.
- **P3A-AC11** All tests use synthetic fixtures; runtime artifacts remain outside Git and persist by default.
- **P3A-AC12** No Grader code, Semantic Judge, open registry, UI, production connector or automatic Contract promotion exists.

## 9. Hard invalidators

- 将 Domain Knowledge Pack 或模型先验直接晋升为产品真相；
- 把聊天摘要当作 Contract，不保存 provenance-bound primary artifact；
- `proposed/unresolved/conflicted/observability_gap` 进入已签发 Contract；
- Requirement 评测结果自动改写 ProductDomainContract；
- Candidate 可以看到 authoring Skill、owner answer、Gold/mutants 或领域提示；
- readiness 通过加权总分覆盖任一 hard invalidator；
- CLI 接受 absolute/traversal/symlink pack path；
- 读取 OAuth credential、ambient `~/.dsh`、Clowder runtime/data/API/ports；
- 自动删除 Interview/Contract/Requirement artifact；
- Phase 3A 顺手引入 grader runtime、Judge、Web UI、远端执行或生产数据。
