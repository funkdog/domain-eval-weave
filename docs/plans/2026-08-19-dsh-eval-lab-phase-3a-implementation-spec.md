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
> **状态**：approved implementation contract v1（governance-narrowed）。Phase 3A 获准实施；Phase 3B deterministic grader compiler 与
> Phase 3C Semantic Judge 尚未获准编码。
>
> Scope contraction：Phase 3A 只提供 `domain confirm`。通用 reject/withdraw、rejection receipt replay 与对象撤销治理后移；
> 未确认候选留在 authoring plane，不写永久 authority event。

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
   `confirmed` 必须由独立、digest-bound 的 OwnerConfirmationEvent 证明，不能靠对象内 actor 字符串自证。
   Event 只能由 `eval-clowder` management CLI 的显式 operator invocation 写入；author Skill/profile 与 Candidate runner
   都不能调用该 surface。
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
├── owner-confirmation.schema.json
├── domain-decision-question.schema.json
├── product-domain-contract-candidate.schema.json
├── product-domain-contract.schema.json
├── requirement-change-set.schema.json
├── claim-dependency-graph.schema.json
├── domain-readiness-request.schema.json
├── domain-pack-manifest.schema.json
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

src/author-bridge/
├── domain-artifact.ts
└── index.ts
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
- author-only deterministic `domain_artifact` tool；
- `dsh-eval-author-bridge` 在所有 model-facing tool body 前执行 realpath containment：只允许读取当前选定 project workspace，
  只允许在其 `domain-eval/` 内写入；通用 editor 的 absolute-path read 不得绕过该 guard；
- 与现有 transport 相同的 pinned provider/model/effort。

它固定禁用：

- `dsh-eval-app` management command plugin；
- `dsh-eval-bridge` Candidate bridge；
- Candidate workspace/Oracle/exposure/Suite 路径读取；
- production data/network connector。

Runner profile `eval-clowder-runner` 必须继续禁用 `tool-skill`、filesystem/shell/web 等既有禁止工具，且
`design-domain-grader` provider row 为 disabled。Contract test 必须证明 authoring bytes 不进入 Candidate composed surface。

### 2.1 Phase 2 / accepted Phase 3A → current release profile upgrade

`init` 必须支持已有、已验证的 Phase 2 `eval-clowder-runner`，不能要求用户删除 profile、迁移 `DSH_HOME` 或丢弃
既有 Session/Campaign/Suite artifact；已进入 Phase 3A 后，也必须支持从前一份已验收 package set 原位升级。Predecessor
allowlist 只包含：

1. exact Phase 2 runner profile：固定 package/profile identity、rc.4 installed package、workspace policy 与 Phase 2
   app/bridge patch；local tar SHA-256
   `a725190e200bbb6a08edabbc7ac82ac883ae4567712686852900430872cf10e5`，size `161769` bytes，installed package
   content digest `adc309b1e729d0f99e6765af6d46f48d4f3e83753f8662c6888f1c1a7cc4ca65`；
2. exact accepted Phase 3A runner+author set at main `eb2505d11a3d3e247328b7adc04de8965608b66a`：version
   `0.3.0-alpha.1`，local tar SHA-256
   `9be34174e00f0089c43f9951dcc21f62a374be2dfb4b73061dd993f29c3d47f3`，size `231008` bytes，installed package
   content digest `afafa65b48da6a080a3bfd9c9b816e087befe06f206cfb4fce68403b76b96822`，且两套 profile managed files 必须
   分别精确匹配同一个 tar spec。该 predecessor 只能作为完整 runner+author cohort 被接受；任一 peer 缺失或与 current target
   混合都不是可恢复 predecessor。

同名同版本但 tar、installed bytes、profile bytes 或 runner/author package spec 不同仍是 drift，必须在零 install side
effect 时拒绝。每次签发新的 reviewed runtime tar，都必须在本节推进 predecessor evidence，不能回退为任意历史版本或
任意本地 tar。

Runner 与新增 author profile 作为一个 staged profile set 升级：

1. 在写 live profile 前完成两个目标的 path、predecessor/current bytes 与 shared model settings preflight；
2. 在 profiles parent 下的隔离 sibling directory 物化三份 frozen profile 文件，生成 lockfile、安装 package closure，并验证
   exact package spec/version 与 pinned `dsh-codex-connect`；`node_modules`、两个 package directory 及 manifest 的每一层
   都必须 no-follow 验证为 profile 内 physical entry，lockfile 必须结构化绑定 root importer，已安装 Eval Lab bytes 必须与
   management package content digest 相同；
3. Preflight 为 runner/author 的 missing/present identity、managed bytes、`cordis.yml`、lockfile 与 package contents 冻结
   commit-time snapshot；全部 staging 成功后、任一 live rename 前必须复核两个 snapshot。Existing root rename 到 backup 后再次
   对该 exact inode/bytes 做 CAS；
4. Existing root 通过同 filesystem directory rename 切换。Missing root 不得使用会覆盖空目录的普通 rename：必须以 atomic
   exclusive `mkdir` claim root、写 durable transaction ownership marker，再从 stage 激活内容，以 `package.json` 最后进入作为 ready
   boundary。Marker 必须 canonical 绑定 transaction UUID、runner/author role、profile name、target package spec digest/version 与
   三份 managed-file digest；recovery 只接受 marker + 允许的 staged entry 子集，任何 unknown entry 均拒绝；
5. 并发创建者先赢时 claim 返回 typed concurrent failure并保留其 inode/bytes；进程在 ready boundary 前中断时，下一次 `init`
   只重放上述 marker 验证通过的 product-owned partial root。无 marker 的空 root、tokenless partial 或带 owner/unknown bytes 的 root
   一律在零 install side effect 时 fail closed，不能猜测所有权；
6. 切换后在 marker 仍存在时再次验证两套 live profile 均为同一 target package set，通过后才移除 marker；任一失败必须倒序恢复
   已经切换的 profile；
7. staging/install/verification/CAS 失败不得改写旧 runner，也不得留下半创建的 author；重复使用同一 package spec 执行 `init`
   必须是无安装、无改写的幂等操作；
8. 只替换 profile deployment bytes；既有 `cordis.yml` 必须保留，Session、Campaign、Suite、exposure、confirmation ledger 与
   OAuth/共享 settings 都不得迁移、删除或重写。

该事务是产品版本部署，不是 Domain truth promotion，也不新增 rollback/治理 surface。

### 2.2 Deterministic author artifact helper

Author bridge 注册一个固定名 `domain_artifact` 的 model-facing tool。它只在 exact `eval-clowder-author` profile、完成 layout
校验且选定 physical project workspace 后可用；`eval-clowder-runner` 不注册该 tool。它不是 shell/process，也不接受任意命令。

Tool 只冻结三个 action：

1. `snapshot_source`
   - 输入 `artifact_ref`、`source_id`、`kind`、可选 `locator`，以及 `source_path` / `content` 二选一；`source_path` 必须是
     project-root-relative、physical、regular UTF-8 file，`content` 只允许保存本轮明确的 `owner_statement`；两者都最大 1 MiB，
     且不得命中 credential/OAuth-sensitive path 或 content；
   - `artifact_ref` 必须位于 `domain-eval/sources/` 对应的 pack-relative `sources/...` namespace；helper 将 exact source bytes
     immutable 写入该路径；
   - 无 JSON Pointer locator 时 digest 为 exact snapshot bytes 的 SHA-256；`locator` 以 `/` 开始时，source 必须是 JSON，
     digest 为该 pointer value 的 canonical JSON SHA-256；其他 portable anchor/symbol 保持 whole-file digest；
   - 成功返回 strict `DomainSourceRef`，模型不得提供或覆盖 digest。
2. `write_artifact`
   - 输入 `kind`、`artifact_ref` 与 schema-shaped `value`。`kind` 只允许 `interview_session`、`evidence_card`、
     `decision_question`、`product_domain_contract_candidate`、`requirement_change_set_candidate`；
   - helper 用 frozen Zod parser 校验 object，并验证所有 SourceRef、DomainArtifactPointer、product/object identity、predecessor
     及 source snapshot closure。`interview_session`、`evidence_card`、`decision_question` 必须分别使用 canonical
     `interviews/<id>/r<n>.json`、`evidence-cards/<id>/r<n>.json`、`decision-questions/<id>/r<n>.json`；Contract/Requirement
     candidate 必须使用 `candidates/<candidate-id>.json`；
   - author 写入的 Evidence Card 必须非 `confirmed` 且无 confirmation，DecisionQuestion 必须 `open` 且无 resolution receipt，
     Requirement 必须 `draft` 且无 confirmation；Contract candidate 不含 issued/decision fields；
   - Contract candidate 的 `source_snapshot_digest` 由 helper 从已绑定的 completed Interview 推导；调用方应省略该字段，若提供
     则必须与推导值相同；
   - 成功以 exclusive-create 写 `${canonicalJson(parsed)}\n`，同路径同 bytes 幂等，不同 bytes typed fail，并返回可直接嵌入
     后继对象的 `{ ref, sha256 }` DomainArtifactPointer。
3. `stage_confirmation_candidate`
   - 输入 `target_kind=evidence_card|decision_question`、已由 helper 写出的 exact primary `artifact` pointer 与
     `candidate_ref=candidates/<candidate-id>.json`；
   - helper 重新解析、验证 pointer/source closure；Card 只有 `proposed|unresolved` 可 stage，Question 必须 `open`，再把 exact
     canonical bytes immutable stage 到 candidate namespace。模型不重复提交 object value，management `domain confirm` 消费该
     candidate。

所有 action 成功返回 `{ ok: true, ... }`；输入、schema、closure、path、secret 或 immutable conflict 失败返回
`{ ok: false, action, diagnostics: [{ code, path, message }] }`，不得留下目标文件或半写 bytes。Path resolution 必须逐层
no-follow，拒绝 absolute/traversal/NUL/symlink/escape；tool 注册时冻结 selected workspace 的 physical realpath + device/inode
identity，每个 action 在首次 mkdir/read/write 前及最终 immutable write 前必须重新 CAS，root 被 rename、替换或改成 symlink 时须在
workspace 外零副作用失败。credential path/content 不能靠 provider 枚举：统一先做 camel/acronym/separator tokenization，
再按结构化 key 位置分类。高置信 terminal（`token|secret|password|passphrase|verifier`）不依赖 provider prefix；歧义较高的
`key|code` 必须同时带认证上下文 token（如 `auth|authentication|authn|authz|api|oauth|access|client|consumer|private`）。JSON 递归 object key 与
YAML quoted/block/list/flow key、env/header/assignment key 都必须进入同一 classifier；YAML 使用受 source-size 上限约束的线性 lexer。
Double-quoted mapping key 只正常解码 JSON-compatible escape；YAML-only named/hex/long-unicode escape 或 malformed/truncated escape
不得静默跳过，只要其 lexical candidate 后接 mapping `:` 就按 sensitive ambiguity fail closed。
路径 basename 的每个 dot-delimited component 分别复用同一 terminal 判定，使复合 backup/version suffix 不能遮蔽此前的 credential identifier。普通 prose
中无 key 位置的 `token` 不得仅因单词出现而失败。保留 private-key、credential-store 等结构性禁项；新目录与文件使用 private mode。Tool 不读 confirmation ledger，也不能生成
confirmed/resolved/owner-confirmed/issued face、OwnerConfirmationEvent、receipt、graph、readiness 或 manifest。

通用 `str_replace_editor` 可读取 `domain-eval/`，但 mutation guard 必须拒绝 `sources/`、`candidates/`、`interviews/`、
`evidence-cards/`、`decision-questions/`、`contracts/`、`requirements/`、`graphs/`、`readiness/` 与 `manifests/`；
非契约 author notes（例如 decision packet）仍可写。这样 deterministic bytes 是 author profile 的能力边界，而不是提示词约定。

## 3. Skill contract

Skill 名固定为 `design-domain-grader`，frontmatter 仅包含 `name` 与 `description`。正文低于 500 行，详细合同和
failure modes 按需从一层 `references/` 加载。

Embedded provider 必须把 `inject=["skills"]` 挂在 Cordis loader 实际 unwrap 的 default plugin export 上，不能只保留为
module named export。Contract gate 必须从 clean packed tar 导入该 default export，再通过 pinned real Cordis `Context.plugin()`
挂载并验证 exact `eval-clowder-author` profile identity 下的 Skill registration；直接调用 apply 函数不构成 loader 证据。
真实 profile acceptance 还必须证明 author composed tree 可启动并发现该 Skill，而 runner composed tree 保持 provider disabled，
全程在模型调用前完成。

Skill 必须用 `domain_artifact snapshot_source` 取得 SourceRef，用 `write_artifact` 生成 primary/candidate，并仅在需要 operator
确认 Evidence Card/DecisionQuestion 时用 `stage_confirmation_candidate`。不得让模型手算 SHA-256、发明 envelope、用 editor
直接写 schema-governed namespace，或在失败后降级为非 canonical JSON。

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
反斜杠、`..`、空 segment、非有限数字和不认识的 enum。时间必须是唯一字节表示的 UTC
`YYYY-MM-DDTHH:mm:ss.SSSZ`；offset 与省略毫秒的等价写法都拒绝。

### 4.0 Shared nested types and domain pointer protocol

Phase 3A 不复用 `artifact://campaign/` 或 `artifact://suite/` pointer。它使用独立的 pack-root-relative协议：

```ts
type DomainPackRef = string // normalized relative ref; no scheme/absolute/../backslash//

interface DomainArtifactPointer {
  readonly ref: DomainPackRef
  readonly sha256: string // canonical JSON digest of the complete target artifact
}

interface OwnerConfirmationPointer {
  readonly confirmation_id: string
  readonly sha256: string
}

interface ClaimRef {
  readonly claim_id: string
  readonly contract_version: number
}

interface ProposedClaim {
  readonly claim_id: string
  readonly domain_id: string
  readonly statement: string
  readonly applicability: string
  readonly source_ref_ids: readonly string[]
}

interface ClaimModification {
  readonly claim: ClaimRef
  readonly proposed: ProposedClaim
  readonly reason: string
}

interface ClaimConflict {
  readonly claim: ClaimRef
  readonly reason: string
  readonly source_ref_ids: readonly string[]
}
```

`DomainArtifactPointer` 只能解析到当前 pack root 内的 physical regular file，逐段拒绝 symlink。Pointer digest 与
SourceRef digest 不同：Pointer 总是绑定完整 canonical artifact；SourceRef 可以按下一节绑定 locator value。
`OwnerConfirmationPointer` 不含 workspace ref；它只解析到
`<instance-root>/domain-confirmations/<confirmation-id>.json` 的 immutable 0600 ledger record。

可演进对象使用 immutable path：

```text
EvidenceCard       evidence-cards/<card-id>/r<revision>.json
DecisionQuestion   decision-questions/<question-id>/r<revision>.json
InterviewSession   interviews/<interview-id>/r<revision>.json
DomainContract     contracts/<contract-id>/v<version>.json
Requirement        requirements/<requirement-id>/v<version>.json
Graph              graphs/<graph-id>.json
ReadinessRequest   readiness/requests/<request-id>.json
ReadinessReport    readiness/reports/<report-id>.json
SnapshotManifest   manifests/<snapshot-id>.json
AuthorityCandidate candidates/<candidate-id>.json
```

`AuthorityCandidate` 是 immutable、canonical JSON input，不是临时文件；management CLI 与 replay 只接受上面的单层
candidate namespace。Evidence Card、RequirementChangeSet 与 DecisionQuestion candidate 复用各自 schema；Contract draft 与
Contract draft 使用独立的 `product-domain-contract-candidate.schema.json`。Candidate bytes 一经 confirm event 引用不得覆盖。

所有写入使用 exclusive create；相同 path+bytes 幂等，不同 bytes 冲突。不得维护可覆盖的 `current` truth file。

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

`artifact_ref` 是 pack-root-relative portable ref。无 `locator` 时，`digest` 绑定整份 source artifact bytes；存在 JSON
pointer `locator` 时，`digest` 绑定该 pointer 所指 canonical JSON value，避免 owner answer 引用其 InterviewSession 时形成
自引用 digest。其他 locator 只作 anchor/symbol 定位，digest 仍绑定整文件。`locator` 不能包含 host absolute path，
`domain_knowledge` 永远不能单独支持 promotion。

### 4.2 OwnerConfirmationEvent

Owner confirmation 是独立 primary artifact：

```ts
interface OwnerConfirmationEvent {
  readonly schema_version: 1
  readonly confirmation_id: string
  readonly actor_id: string
  readonly authority_scope: {
    readonly product_id: string
    readonly domain_ids: readonly string[]
  }
  readonly target: {
    readonly kind: 'evidence_card' | 'product_domain_contract' |
      'requirement_change_set' | 'decision_question'
    readonly object_id: string
    readonly object_version?: number
    readonly projection_sha256: string
  }
  readonly decision: 'confirm'
  readonly origin: {
    readonly kind: 'management_cli_operator_invocation'
    readonly profile: 'eval-clowder'
    readonly command: 'confirm'
    readonly invocation_sha256: string
  }
  readonly supporting_source_ref?: SourceRef
  readonly occurred_at: string
}
```

`projection_sha256` 不绑定包含 confirmation pointer 的最终对象，以避免循环；它绑定该 target 的冻结确认投影：

- Evidence Card：除 `status/confirmation` 外的全部字段；
- Product Domain Contract：除 `state/confirmation/decided_by/decided_at` 外的 identity、version、predecessor、source snapshot 与 Claims；
- Requirement ChangeSet：除 `status/confirmation` 外的全部字段；
- DecisionQuestion：除 `status/resolution_confirmation` 外的全部字段；

最终对象保存 `confirmation: OwnerConfirmationPointer`；replay 同时验证隔离 ledger event bytes、actor authority scope、target identity/version、
projection digest、decision 与 external origin。`actor_id` 来自 operator command 参数，scope 由 target artifact 推导后写入，
不能由 Skill 提供；management CLI 的 app row 在 author/runner profile 都 disabled。单用户 Phase 3A 只冻结本机 operator gesture，
不新增 RBAC。

### 4.3 DomainInterviewSession

```ts
interface DomainInterviewSession {
  readonly schema_version: 1
  readonly interview_id: string
  readonly revision: number
  readonly predecessor?: DomainArtifactPointer
  readonly mode: 'onboard' | 'delta' | 'audit'
  readonly product_id: string
  readonly domain_ids: readonly string[]
  readonly base_contract?: DomainArtifactPointer
  readonly requirement_ref?: SourceRef
  readonly source_snapshot: readonly SourceRef[]
  readonly turns: readonly InterviewTurn[]
  readonly evidence_card_refs: readonly DomainArtifactPointer[]
  readonly decision_question_refs: readonly DomainArtifactPointer[]
  readonly status: 'draft' | 'awaiting_owner' | 'completed' | 'aborted'
  readonly started_at: string
  readonly ended_at?: string
}
```

```ts
interface InterviewTurn {
  readonly turn_id: string
  readonly question_id: string
  readonly question: string
  readonly reason: string
  readonly source_ref_ids: readonly string[]
  readonly blocked_claim_ids: readonly string[]
  readonly answer?: string
  readonly answer_ref_id?: string
  readonly status: 'asked' | 'answered' | 'skipped'
}
```

每个问题保留输入来源、owner answer 正文与 answer ref。每轮问题/回答/状态变化 exclusive-create 下一 revision，manifest
始终 pin exact revision；不得只在结尾保存摘要或覆盖先前 Session bytes。

### 4.4 DecisionQuestion

DecisionQuestion 是独立 primary artifact，不只保存一个裸 ID：

```ts
interface DecisionQuestion {
  readonly schema_version: 1
  readonly question_id: string
  readonly revision: number
  readonly predecessor?: DomainArtifactPointer
  readonly product_id: string
  readonly requirement_id?: string
  readonly question: string
  readonly reason: string
  readonly blocked_claim_ids: readonly string[]
  readonly risk: 'low' | 'medium' | 'high' | 'critical'
  readonly blocking: boolean
  readonly status: 'open' | 'resolved'
  readonly resolution_confirmation?: OwnerConfirmationPointer
}
```

`open` 禁止 resolution pointer；`resolved` 写新 revision 并绑定对应 OwnerConfirmationEvent。Requirement 与 InterviewSession
都引用 question pointer。Readiness 只把 requested closure 中 `blocking=true && status=open` 的问题判为 red。

### 4.5 DomainEvidenceCard

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
  readonly revision: number
  readonly predecessor?: DomainArtifactPointer
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
  readonly confirmation?: OwnerConfirmationPointer
  readonly conflict?: { readonly source_ref_ids: readonly string[]; readonly reason: string }
}
```

Semantic validator 强制：

- `confirmed` 必须有一个验证通过的 `decision=confirm` OwnerConfirmationEvent、至少一个 authority ref，且不能只有 `domain_knowledge`；
- `conflicted` 必须列出至少两个不同 source ref；
- `observability_gap` 的 observation refs 必须为空或显式指向不可用观察；
- 其他状态不得携带 confirmation pointer。

### 4.6 ProductDomainContract and Claim lifecycle

```ts
interface ProductDomainContract {
  readonly schema_version: 1
  readonly contract_id: string
  readonly product_id: string
  readonly version: number
  readonly predecessor?: DomainArtifactPointer
  readonly state: 'issued'
  readonly confirmation: OwnerConfirmationPointer
  readonly decided_by: string
  readonly decided_at: string
  readonly source_interview: DomainArtifactPointer
  readonly source_snapshot_digest: string
  readonly claims: readonly ProductDomainClaim[]
}
```

Contract candidate 的冻结 face 为：

```ts
interface ProductDomainContractCandidate {
  readonly schema_version: 1
  readonly contract_id: string
  readonly product_id: string
  readonly version: number
  readonly predecessor?: DomainArtifactPointer
  readonly source_interview: DomainArtifactPointer
  readonly source_snapshot_digest: string
  readonly claims: readonly ProductDomainClaim[]
}
```

它明确不含 `state/confirmation/decided_by/decided_at`；不得把 issued Contract 或任意松散 JSON 当作 Contract candidate。

```ts
interface ProductDomainClaim {
  readonly claim_id: string
  readonly domain_id: string
  readonly statement: string
  readonly applicability: string
  readonly evidence_card: DomainArtifactPointer
  readonly authority_refs: readonly SourceRef[]
  readonly observation_refs: readonly SourceRef[]
  readonly false_accept_risk: 'low' | 'medium' | 'high' | 'critical'
  readonly false_reject_risk: 'low' | 'medium' | 'high' | 'critical'
  readonly dependencies: readonly ClaimRef[]
  readonly lifecycle: 'active' | 'retired'
  readonly transition?: {
    readonly kind: 'supersedes' | 'retires'
    readonly predecessor: ClaimRef
  }
}
```

每个 `ProductDomainClaim` 必须回指一个 confirmed Evidence Card digest。Claim ID 在 Contract 版本间稳定；同一版本
ID 唯一。Contract draft 是 management CLI 的 input candidate，不占用 final Contract path。`state=issued` 必须绑定
OwnerConfirmationEvent，`decided_by/at` 必须等于 event actor/time；只有 issued Contract 可作为 Requirement base。
新版本不得静默删除 Claim，只能保留 Claim 并以 transition 表达：`supersedes → lifecycle=active`，
`retires → lifecycle=retired`。整份 successor Contract 的一次 owner confirmation 同时授权其中所有 transition，不再为每个 Claim
另建治理事件。Version 迁移状态机：

```text
candidate --confirm--> issued@vN
active@vN --supersedes--> active@vN+1
active@vN --retires-----> retired@vN+1
retired --(no implicit transition)--> retired
```

单对象 schema 必须允许 later-version `retired` Claim 不带 transition，以表达 terminal carry-forward；跨版本 shared successor
validator 再唯一判定：`active→retired` 必须 `retires`，`retired→retired` 必须无 transition 且 semantics 不变，
`retired→active` 永远拒绝。

### 4.7 RequirementChangeSet

```ts
interface RequirementChangeSet {
  readonly schema_version: 1
  readonly requirement_id: string
  readonly version: number
  readonly predecessor?: DomainArtifactPointer
  readonly product_id: string
  readonly requirement_refs: readonly SourceRef[]
  readonly base_contract: DomainArtifactPointer
  readonly effects: {
    readonly uses: readonly ClaimRef[]
    readonly preserves: readonly ClaimRef[]
    readonly introduces: readonly ProposedClaim[]
    readonly modifies: readonly ClaimModification[]
    readonly deprecates: readonly ClaimRef[]
    readonly conflicts_with: readonly ClaimConflict[]
  }
  readonly decision_question_refs: readonly DomainArtifactPointer[]
  readonly status: 'draft' | 'owner_confirmed'
  readonly confirmation?: OwnerConfirmationPointer
}
```

每个 semantic version 只写一次 final path；draft candidate 使用独立临时/候选路径。`owner_confirmed` 要求 validation scope 中零 open blocking DecisionQuestion，并绑定 target projection 一致的
OwnerConfirmationEvent；它仍不修改 ProductDomainContract。Requirement 撤销治理不属于 Phase 3A。

### 4.8 ClaimDependencyGraph

Graph 是上述 primary artifact 的派生 snapshot：

```ts
interface ClaimDependencyGraph {
  readonly schema_version: 1
  readonly product_id: string
  readonly contract: DomainArtifactPointer
  readonly requirements: readonly DomainArtifactPointer[]
  readonly nodes: readonly ClaimGraphNode[]
  readonly edges: readonly ClaimGraphEdge[]
  readonly reverse_index: Readonly<Record<string, readonly string[]>>
}
```

```ts
interface ClaimGraphNode {
  readonly node_id: string // claim:<version>:<id> | proposal:<requirement-version>:<requirement>:<id> | requirement:<version>:<id>
  readonly kind: 'contract_claim' | 'historical_claim' | 'proposed_claim' | 'requirement'
  readonly object_id: string
  readonly object_version: number
  readonly domain_id?: string
}

interface ClaimGraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: 'depends_on' | 'uses' | 'preserves' | 'introduces' | 'modifies' |
    'deprecates' | 'conflicts_with' | 'supersedes' | 'retires'
}
```

Graph builder 必须检测重复边、missing node、invalid contract version、非法 Claim dependency cycle，并证明 reverse index
可由 edges 重新生成。Requirement/Proposal node identity 必须包含 pinned Requirement version；同一 snapshot 不允许两个
pointer 声明相同 requirement_id+version。Claim transition 必须投影为 `supersedes/retires` edge，不能只留在运行时约定。

### 4.9 DomainReadinessRequest and DomainTruthReadinessReport

```ts
interface DomainReadinessRequest {
  readonly schema_version: 1
  readonly request_id: string
  readonly product_id: string
  readonly requirements: readonly DomainArtifactPointer[]
  readonly requested_by: string
  readonly requested_at: string
  readonly source_ref: SourceRef
}
```

Readiness report 必须绑定 `request: DomainArtifactPointer`，并保存从这些 Requirement 经过 uses/preserves/modified Claim
与 dependency/reverse-impact 得出的 `requested_closure_node_ids`。只有该 closure 中的 open blocking question、conflict、
observability gap 才是 red；closure 外的低/中风险未决项是 yellow audit warning。相同 primary bytes + ReadinessRequest
必须唯一重建相同 dimensions/overall。

### 4.10 DomainPackManifest

```ts
interface DomainPackManifest {
  readonly schema_version: 1
  readonly snapshot_id: string
  readonly product_id: string
  readonly contract: DomainArtifactPointer
  readonly interviews: readonly DomainArtifactPointer[]
  readonly evidence_cards: readonly DomainArtifactPointer[]
  readonly confirmations: readonly OwnerConfirmationPointer[]
  readonly decision_questions: readonly DomainArtifactPointer[]
  readonly requirements: readonly DomainArtifactPointer[]
  readonly graph: DomainArtifactPointer
  readonly readiness_request: DomainArtifactPointer
  readonly readiness_report: DomainArtifactPointer
}
```

`domain validate/impact` 接收 exact manifest ref，不扫描目录猜“最新版”。Replay 只读取 manifest closure；新增 revision/version
不会改变任何旧 snapshot。Manifest 只包含成功 confirmation 的 receipts；未确认候选与 decision packet 不进入已签发 snapshot。

## 5. Promotion 与 readiness

Promotion 分两步：authoring library 以纯函数从 Cards 生成 Contract candidate projection；operator-only management command
验证 target、推导 authority scope、写 OwnerConfirmationEvent 与 immutable issued Contract。后续 replay 仍以纯函数验证 Cards、
Card/Contract/Requirement/DecisionQuestion confirmation。Contract-level event 授权 successor 中的 Claim transitions；任何一步不得
从 Session 自由文本或当前模型上下文推断确认。

`DomainTruthReadinessReport` 绑定一个 DomainReadinessRequest，并保存多维状态：

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
- requested closure 内的 open blocking question/conflict/observability gap → red；
- 非 blocking unresolved 或未来 audit warning → yellow；
- 当前 requested closure 全部 confirmed、可追踪且可重放 → green。

Green 只表示 `domain_truth_ready`，不表示 grader admitted、需求已交付或 Harness 有效。

## 6. CLI surface

Management profile 新增 deterministic、无模型命令：

```text
dsh --profile eval-clowder domain confirm <pack-root> <target-kind> <candidate-ref> <actor-id>
dsh --profile eval-clowder domain validate <pack-root> <manifest-ref>
dsh --profile eval-clowder domain impact <pack-root> <manifest-ref> <claim-id>
```

合法 confirm surface 冻结为四类：EvidenceCard `proposed/unresolved → confirmed r+1`、ProductDomainContract
`candidate → issued vN`、RequirementChangeSet `draft → owner_confirmed vN`、DecisionQuestion `open → resolved r+1`。其他 target、
已确认对象重复 confirm、或不满足前置状态都必须在 ledger pre-write 阶段 typed fail。所有生成下一 revision/version 的对象都必须
写 predecessor pointer。Preflight 完整验证 target schema/state、证据/问题闭包、输出可表达性、目标 immutable path
是否可用；只有它成功后才允许写永久 ledger。Ledger 写成功而 final write 因 I/O 失败时保留 event，并返回 typed incomplete
result，禁止把它解释为已完成 transition。

要求：

- pack/manifest/target path 相对 invocation cwd，realpath containment，不接受 absolute/traversal/symlink；
- confirmation command 只能由 `eval-clowder` app 接受；author profile 禁用 app 与 shell/process 工具，Candidate runner
  同样禁用，故 Skill/模型不能调用；command 从 target 推导 object identity/scope/projection，先 exclusive-create runtime ledger
  event，再写带 receipt 的下一 immutable revision；validator 必须同时核 pack receipt 与 ledger，workspace 内伪造 event 无效；
- confirm × target kind 必须按上述 allowlist 做 pre-write red matrix；非法 target/state 零 ledger side effect；
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
- 十一个 JSON Schema + Zod parser parity；
- SourceRef/path/time/id/status failure tests；
- no Phase 1/2 schema regression。

### Milestone 1 — Promotion and Contract versioning

- Evidence Card semantic validation；
- confirmed-only promotion；
- stable Claim IDs and predecessor binding；
- digest-bound OwnerConfirmationEvent and target projections；
- proposed/conflicted/observability-gap red tests。

### Milestone 2 — Requirement binding and impact graph

- all six requirement edge kinds；
- cross-domain requirement；
- same Claim reused by two requirements；
- reverse impact closure and deterministic graph replay；
- supersede/retire transition edges and migration state machine；
- DecisionQuestion resolve + requested-closure replay；
- missing node/cycle/alias rejection。

### Milestone 3 — Skill and authoring profile

- initialize `design-domain-grader` with the canonical skill scaffold；
- concise SKILL.md + one-level references/assets；
- embedded provider and author profile materialization；
- author-only deterministic source snapshot/canonical artifact helper、typed diagnostics 与 editor anti-bypass；
- packed-default real Cordis mount、author registration 与 runner visibility regression test；
- operator-only `domain confirm` + artifact-only `domain validate/impact` CLI。

### Milestone 4 — Synthetic vertical acceptance

- synthetic commerce onboarding；
- second requirement delta against same Contract；
- one shared Claim reused；
- one requirement spanning payment + inventory domain slices；
- one seeded policy ambiguity, conflict and observability gap remain non-confirmed；
- three forward runs for unauthorized truth classification/attempt rate；
- independent missing-question/content review；
- package/build/import/pack gates and clean candidate。

## 8. Acceptance criteria

- **P3A-AC1** Skill supports onboard/delta/audit and persists every question/answer/evidence transition through real-SHA,
  schema-valid canonical artifacts produced by the author helper.
- **P3A-AC2** Only Evidence Cards backed by verified OwnerConfirmationEvents enter an issued ProductDomainContract.
- **P3A-AC3** ProductDomainContract and RequirementChangeSet retain independent versions/lifecycles.
- **P3A-AC4** All six requirement edge kinds validate, and requirement-scoped proposals do not mutate the base Contract.
- **P3A-AC5** One confirmed Claim is referenced by at least two Requirements without duplication.
- **P3A-AC6** One Requirement spans at least two domain slices and produces deterministic impact closure.
- **P3A-AC7** Confirmation targets, Claim lifecycle edges, DecisionQuestion resolution, Graph/reverse index and requested-closure readiness can be rebuilt from frozen primary artifact and detect drift.
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
