---
feature_ids: [F192, F266, F267]
related_features: [F202, F203, F261]
topics: [dsh, eval-lab, implementation, open-coding, goal-ablation, codex-oauth]
doc_kind: implementation-plan
created: 2026-08-17
description: "DSH Eval Lab Phase 1 的决策完备实现规格：独立工作区、受控 Goal 配对实验、证据投影、隐藏 Oracle 与诊断报告。"
---

# DSH Eval Lab Phase 1 Implementation Spec

> 产品边界：[DSH Eval Lab 产品方案与 Phase 1 目标](./2026-08-17-dsh-eval-lab-product-plan.md)。
>
> 方法论 provenance：Clowder AI `Agent Eval Epistemology`。原文不随隔离 assignment 分发；本 spec 已冻结
> Phase 1 所需结论，实现 Agent 不得访问 snapshot 外路径追索 provenance。
>
> **状态**：implemented and accepted。Phase 1 候选在 `c8084cecb1331c2bb88e9e5ccb412bb6445ca9d0`
> 完成，兼容面由当前 `main` 持续回归；本文保留为 Phase 1 冻结实现合同，不随 Phase 2/3 静默改义。

## 0. 冻结结论

Phase 1 不建设通用 Eval 平台，而是交付一个个人可用的本地闭环：

```text
固定 Domain: open-coding-delivery
固定 Eval Pack: open-coding-delivery-v1
固定 Task Pack: open-coding-ts-ledger-v1
固定 Intervention: DSH Goal stack off → on
固定 Model Route: openai-codex / gpt-5.6-sol / xhigh
固定 Claim: diagnostic, effectClaimEligible=false
```

实现必须遵守以下决定，不在施工中重新发明产品：

1. 源码新建为独立 Git 仓库 `/Users/slipshod/AIBuild/dsh-eval-lab`。
2. secret、DSH home、Session、Candidate 与 Campaign 写入非 Git 目录
   `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`。
   每次 DSH process 启动前都必须继承
   `DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home`；无此前缀的调用不受支持。
3. 现有 `/Users/slipshod/AIBuild/dsh-codex-oauth-lab` 仅作为已验收参考，不被迁移、改写或复用为产品目录。
4. Phase 1 是一个由 DSH plugin manager 安装的 bundle package；只有 `dsh --profile eval` 命令行 app surface，
   没有独立 `dsh-eval` 用户命令、Web UI、角色系统、审批流、Pack authoring 或 registry。
5. 目标 carrier 是 management plugin 启动的 DSH 原生 `dsh --profile eval-runner <task>` headless child process；
   真实 OAuth headless conformance 是 Gate 0。
6. 两臂串行执行但运行顺序随机并记录；每臂都是 fresh workspace + fresh Session。
7. 两臂共享同一个受限工具面；只有四个 Goal rows 可以不同。
8. Candidate 冻结后才生成本次隐藏 Oracle case seed；Oracle 不向 Agent 回灌结果或开启 repair。
9. Report 先判断 measurement validity，再展示 Outcome、Mechanism、Cost；不计算总分。
10. 一对 Episode 无论结果如何都不得声称总体 uplift。

## 1. Phase 1 交付目标

用户完成一次显式 OAuth 登录后，可以运行：

```sh
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home dsh --profile eval doctor
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home dsh --profile eval calibrate
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home dsh --profile eval run
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home dsh --profile eval report <campaign-id>
```

并得到一份可重放证据包，回答：

- Goal off/on 两个 DSH 配置是否真的只差 Goal stack；
- Agent 是否创建 Goal、进入多少 continuation rounds、如何结束；
- 冻结 Candidate 是否通过外部行为 Oracle；
- Agent 是否在 Oracle 失败时仍声明完成；
- 时间、token、step 与 tool call 成本如何变化；
- 哪些字段有效、无效或证据不足；
- 用户下一步应 Keep、Iterate、Revert 还是 Run More。

### 1.1 非目标

- 证明 Goal 对开放编码任务总体有效；
- 多模型、多 seed、多 Task Pack 或统计显著性；
- LLM Judge、自动根因归因或自动 Harness 修改；
- 安装任意第三方 Harness；
- 生产数据、生产仓库、远端发布或云端 Eval 服务；
- 修改 DSH 上游源码或当前运行中的 OAuth Web lab；
- 把 Eval Pack、Campaign、Episode 等内部术语强迫给日常用户。

## 2. 工作区与数据边界

### 2.1 源码仓库

```text
/Users/slipshod/AIBuild/dsh-eval-lab/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── README.md
├── cordis.patch.yml
├── contracts/
│   ├── experiment.schema.json
│   ├── episode.schema.json
│   ├── evaluation-result.schema.json
│   └── report.schema.json
├── runtime-profile/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── pnpm-workspace.yaml
│   └── cordis.patch.yml.template
├── variants/
│   ├── common.patch.yml
│   ├── goal-off.patch.yml
│   └── goal-on.patch.yml
├── task-packs/
│   └── open-coding-ts-ledger-v1/
│       ├── pack.json
│       ├── public-task.md
│       ├── base/
│       ├── oracle/
│       └── calibration/
├── src/
│   ├── app/
│   │   ├── index.ts
│   │   ├── args.ts
│   │   └── startup.ts
│   ├── bridge/
│   │   ├── index.ts
│   │   └── workspace-test.ts
│   ├── contracts/
│   ├── carrier/
│   ├── campaign/
│   ├── fingerprint/
│   ├── freeze/
│   ├── projector/
│   ├── oracle/
│   ├── validity/
│   └── report/
└── tests/
    ├── unit/
    ├── contract/
    ├── calibration/
    └── e2e/
```

Phase 1 是一个 npm package 和一个 DSH bundle；目录是模块边界，不拆 monorepo package。package manifest 必须声明：

```json
{
  "name": "dsh-eval-lab",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "exports": {
    "./app": "./dist/app/index.js",
    "./bridge": "./dist/bridge/index.js"
  }
}
```

`app` 与 `bridge` 是同一版本化发布物的两个 entrypoint。app 只挂载到 management profile；runner profile
通过 patch 禁用 app row、启用 bridge row。两个 entrypoint 都必须 default-export Cordis plugin，模块顶层不得产生
文件、process、network 或 Session 副作用；disabled app row 不得被实例化。不得为用户另发一个绕过 DSH profile
composition 的 executable。

### 2.2 运行目录

```text
/Users/slipshod/AIBuild/dsh-eval-lab-runtime/
├── dsh-home/
│   ├── .openai-codex-auth.json       # 0600，永不读取/输出/提交
│   ├── settings.yaml
│   ├── profiles/eval/                # management app profile
│   ├── profiles/eval-runner/         # child headless carrier profile
│   └── sessions/
├── workspaces/<campaign-id>/
│   ├── control/
│   └── treatment/
└── campaigns/<campaign-id>/
    ├── manifest.json
    ├── arms/<arm>/
    │   ├── episode.json
    │   ├── stdout.txt
    │   ├── stderr.txt
    │   ├── session.jsonl
    │   ├── candidate.tree
    │   ├── candidate.patch
    │   └── candidate.tar
    ├── oracle/<arm>/
    │   ├── seed.json
    │   ├── behavior.json
    │   └── stdout.txt
    ├── evaluation.json
    ├── report.json
    └── report.md
```

运行根目录创建为 `0700`。OAuth 文件只能由 `dsh-codex-connect` 创建和刷新；Eval Lab 只调用其 secret-free
`status --json` / `doctor --json`，禁止 open、copy、move、print 或纳入 digest。Campaign artifact 默认持久化，
由用户显式删除；Phase 1 不提供自动 TTL 或 cleanup 命令。

### 2.3 禁止边界

- 不读取 `~/.codex/auth.json`、`~/.dsh` 或 Clowder AI runtime data。
- 不支持在 DSH boot 后通过 app argument 改写 runtime root；profile 在 app mount 前已经由 inherited `DSH_HOME` 解析。
- 不把 Oracle、gold、arm label 或 Campaign path 放进 Agent prompt。
- 不从 Eval Lab 连接 Clowder Redis、SQLite、API 或当前 Web 端口。
- 不在 Candidate workspace 放 symlink、submodule 或指向源码/Oracle 的路径。
- 不把 absolute host paths 写进可比较的 content digest；host metadata 单独存放。

## 3. 技术栈

- Phase 1 host 固定为 macOS；Node.js `24.x`，与已经验收的 DSH OAuth lab 一致；
- TypeScript，ESM，`strict: true`；
- pnpm 锁定依赖；
- DSH external bundle package；app 通过 `ctx.cmdlineArgs.get()` 消费 profile app arguments；
- `@deepseek-ai/dsh@0.1.0-rc.6`；
- `@deepseek-ai/dsh-session@0.1.0-rc.6`，只用于官方 Session storage record 解码；
- `dsh-codex-connect@0.1.0-alpha.4.7`；
- Zod 作为运行时 contract parser；JSON Schema 是 artifact interoperability face；
- YAML 只用于 DSH patch；Eval Lab 自身的公开 contract 全用 JSON；
- Node `crypto` SHA-256、`child_process.spawn` / `execFile`、Git plumbing；
- Node test runner；fixture 不安装第三方 runtime dependency。
- macOS `sandbox-exec` deny-default profile，约束 Candidate public tests 与 hidden Oracle 的 read/write/network surface；
  `doctor` functional probe 失败时 fail closed，不降级为裸进程。

所有外部命令使用 argv 数组，不拼 shell string。任何版本漂移都要求新 deployment fingerprint 和新 Campaign。
公开源码快照对应的 package manifest 仍显示 rc.5，而真实 lab 安装的是 npm rc.6；源码只提供结构证据，实际
package exports、composed config 与行为必须由 rc.6 安装物的 contract tests / Gate 0 决定，不把快照细节冒充发布契约。

## 4. 组件架构

```text
DSH `eval` management profile
 └─ DshEvalAppPlugin
     └─ CampaignCoordinator
        ├─ RuntimeDoctor / AuthFacade
        ├─ PackLoader + ContractValidator
        ├─ VariantComposer + Fingerprinter
        ├─ WorkspaceFactory
        ├─ DshRunCarrier
        ├─ CandidateFreezer
        ├─ SessionProjector
        ├─ HiddenOracle
        ├─ MeasurementValidator
        └─ PairedReporter

CampaignCoordinator
 └─ child `dsh --profile eval-runner ...` processes
     └─ DshEvalBridgePlugin + fresh Agent Session
```

`DshEvalAppPlugin` 与 `DshEvalBridgePlugin` 同包发布但不在同一角色运行。management profile 启用 app、禁用
bridge；runner profile 禁用 app、启用 bridge。App process 不创建被计分 Agent；runner fingerprint 将同一 package
digest 与 app-disabled 状态记录为两臂常量，app 不贡献 runtime service、prompt 或 tool。所有被测 Agent 都由
child process 承载。

### 4.1 接口边界

```ts
interface DshCarrier {
  qualify(input: CarrierQualificationInput): Promise<CarrierQualification>
  runEpisode(input: RunEpisodeInput): Promise<RunEpisodeOutput>
}

interface CandidateFreezer {
  freeze(workspace: string, allowedPaths: readonly string[]): Promise<FrozenCandidate>
}

interface EvidenceProjector {
  project(input: SessionEvidenceInput): Promise<ProjectedEpisode>
}

interface DomainOracle {
  calibrate(pack: TaskPack): Promise<CalibrationResult>
  evaluate(candidate: FrozenCandidate, seed: OracleSeed): Promise<BehaviorResult>
}
```

这些是 Eval Lab 内部接口，不发布为通用 Kernel API。只有真实第二个 consumer 出现后才讨论抽包。

## 5. DSH plugin app 命令契约

### 5.0 安装与入口

用户显式安装本地 checkout、tarball 或 package spec：

```sh
umask 077
install -d -m 700 /Users/slipshod/AIBuild/dsh-eval-lab-runtime
install -d -m 700 /Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh plugin --profile eval add <dsh-eval-lab-package-spec>
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home \
  dsh --profile eval --help
```

这是 Phase 1 唯一支持的 invocation contract。DSH 的 home precedence 是 explicit configured path → inherited
`DSH_HOME` → `~/.dsh`，且 profile 在 app plugin mount 前解析；因此 app 的 `init` 或 `--runtime-root` 参数无法
安全补救一个已经使用 ambient home boot 的 process。所有文档、测试与用户提示都必须展示此前缀。

DSH plugin manager 负责在缺失时创建 `eval` profile、由 pnpm 安装 package，并根据 package manifest 的
`dsh.bundle.patch` 把本 bundle 加入 profile composition。`cordis.patch.yml` 至少声明：

```yaml
- id: dsh-eval-app
  name: dsh-eval-lab/app
  disabled: false
- id: dsh-eval-bridge
  name: dsh-eval-lab/bridge
  disabled: true
```

App plugin 读取 DSH 传入的 immutable `ctx.cmdlineArgs`，拥有 `init`、`auth`、`doctor`、`calibrate`、`run`、
`report` 的 grammar、help、stdout/stderr 与退出码。未知或跨命令参数必须在任何 runtime 写入前退出 2。
每次 profile boot 只执行一个命令，命令完成后通过 DSH app lifecycle 请求 bounded dispose/exit。Phase 1 不安装
全局 bin，不把 `node dist/...` 或 package scripts 作为支持的用户入口。

### 5.1 `dsh --profile eval init`

首先验证 inherited `DSH_HOME` 与 fixed dedicated path 完全一致，且预先创建的 DSH home 与 parent runtime root
均为真实 `0700` 目录并通过物理分离检查；然后在缺失时创建 `settings.yaml` 与 `profiles/eval-runner`，安装 frozen
runner dependencies，并输出下一步。
Management `eval` profile 已由 plugin manager 在同一 home 下创建，`init` 不改写其用户层。已有文件不覆盖；
任何 manifest/digest 不匹配都 fail loud，要求用户选择新的 runtime root 或人工检查。

Runner profile 安装与 management profile exact 相同版本的 `dsh-eval-lab` package 和 bridge bytes；它的 patch
必须显式 `dsh-eval-app.disabled=true`、`dsh-eval-bridge.disabled=false`。版本或 bytes 不一致时 `init` 失败。

默认设置：

```yaml
agent-default-model:
  provider: openai-codex
  model: gpt-5.6-sol
  reasoningEffort: xhigh
```

### 5.2 `dsh --profile eval auth status`

调用 profile 内：

```sh
<resolved-eval-runner-dsh-codex-connect-bin> status --json
```

`init` 从 pinned `dsh-codex-connect` package manifest 解析并冻结该 bin，不经 shell、`pnpm exec` 或 DSH plugin
manager 二次转发，避免 `status` 隐式修改 profile manifest。只接受 schema-versioned、secret-free JSON。
signed-out 返回非零并提示显式登录，不自动启动 OAuth。

### 5.3 `dsh --profile eval auth login`

这是唯一能启动 OAuth 的命令，必须由用户明确调用。它转发：

```sh
<resolved-eval-runner-dsh-codex-connect-bin> login --device-code
```

Eval Lab 不记录 URL、device code、account id、token 或 expiry。登录后的唯一持久结论是 `signed-in`。

### 5.4 `dsh --profile eval doctor`

按顺序检查：

1. Node/pnpm/Git 版本；
2. 源码与 runtime roots 没有包含/相等关系；
3. inherited `DSH_HOME` 是 exact dedicated path，runtime root 与 credential metadata 权限正确；
4. exact package versions 与 lockfile；
5. management profile 启用 app/禁用 bridge，runner profile 禁用 app/启用 bridge；
6. OAuth secret-free status；
7. common/off/on 三个 patch 都能 `--dump-config`；
8. 两个 composed trees 只存在允许的 Goal diff；
9. `dsh-eval-bridge` 工具限制 conformance；
10. Session persistence 使用 plain JSONL、`packChunks=false`；
11. calibration 最近一次结果与 pack digest 是否匹配。

Doctor 不调用模型，不产生 Session，不修改已有 runtime config。

### 5.5 `dsh --profile eval calibrate`

只运行 deterministic Oracle calibration，不调用模型：

- red base 必须失败；
- gold-equivalent 必须全过；
- concurrency、persistence、corruption、release、release-persistence 五个定向 mutant 必须分别被对应 check 捕获；
- 同一 Candidate + 同一 seed 重跑得到同一 behavior vector。

任一失败则 Pack `not_ready`，`run` 拒绝启动。

### 5.6 `dsh --profile eval run`

Phase 1 没有可配置 Task/Variant/runtime-root 参数，避免用户误以为已经是通用平台。可接受的运行参数只有：

```text
--timeout-ms <n>       # 默认 45 分钟/arm，上限 90 分钟
--keep-workspaces      # 默认保留；仅为将来显式策略占位，Phase 1 总是 true
```

命令在真正调用模型前打印 Experiment Summary 和预计最多两个 Episode，要求用户确认一次。确认后不得在两臂间
再次询问，也不能根据 control 结果修改 treatment。

### 5.7 `dsh --profile eval report <campaign-id>`

只从已冻结 public-task bytes、Session、Episode measurement facts、Candidate 与 Oracle vector 重新投影并重建
`evaluation.json`、`report.json` 与 `report.md`；不调用模型、不重跑 Oracle、不写 Candidate，也不把旧
`evaluation.json` 当作重建输入。所有 digest 与语义重算结果必须与冻结证据图对上，否则生成独立的
`measurement_invalid` envelope，而不是读取或覆盖损坏的旧 report。

## 6. 核心数据契约

所有 schema 使用 `schema_version: 1`，解析时拒绝未知必需字段、非有限数字、相对 artifact ref 和不认识的 enum。

### 6.1 TaskPack

```ts
interface TaskPack {
  schema_version: 1
  task_id: 'open-coding-ts-ledger-v1'
  eval_pack_id: 'open-coding-delivery-v1'
  base_tree_sha256: string
  public_task_ref: string
  allowed_candidate_globs: readonly ['src/**']
  forbidden_entry_types: readonly ['symlink', 'submodule']
  public_test_command: readonly ['node', '--test', 'test/public/*.test.ts']
  oracle_version: 'ledger-oracle-v3'
  calibration_digest: string
}
```

### 6.2 VariantSpec

```ts
interface VariantSpec {
  schema_version: 1
  variant_id: 'goal-off' | 'goal-on'
  common_patch_sha256: string
  arm_patch_sha256: string
  expected_goal_rows: {
    goal: boolean
    goal_round_driver: boolean
    command_goal: boolean
    tool_goal: boolean
  }
  dsh_package_tree_sha256: string
  codex_connect_package_sha256: string
  model_route: {
    provider: 'openai-codex'
    model: 'gpt-5.6-sol'
    reasoning_effort: 'xhigh'
  }
  resolved_config_sha256: string
  tool_schema_sha256: string
  tools_mode: 'native'
  permission_mode: 'workspace-write'
}
```

### 6.3 ExperimentSpec

```ts
interface ExperimentSpec {
  schema_version: 1
  campaign_id: string
  created_at: string
  domain: 'open-coding-delivery'
  eval_pack_id: 'open-coding-delivery-v1'
  task_pack_digest: string
  control_variant_digest: string
  treatment_variant_digest: string
  intervention: {
    id: 'dsh-goal-stack'
    allowed_config_paths: readonly [
      'goal.disabled',
      'goal-round-driver.disabled',
      'command-goal.disabled',
      'tool-goal.disabled',
    ]
  }
  arm_order: readonly ('control' | 'treatment')[]
  timeout_ms_per_arm: number
  claim_strength: 'diagnostic'
  effect_claim_eligible: false
}
```

### 6.4 EpisodeRecord

```ts
interface EpisodeRecord {
  schema_version: 1
  episode_id: string
  campaign_id: string
  arm: 'control' | 'treatment'
  variant_digest: string
  workspace_base_digest: string
  session_id?: string
  process: {
    started_at: string
    ended_at: string
    exit_code: number | null
    signal: string | null
    timed_out: boolean
  }
  evidence: {
    session_log_ref: string
    session_log_sha256: string
    candidate_tree: string
    candidate_tree_ref: string
    candidate_tree_sha256: string
    candidate_patch_ref: string
    candidate_patch_sha256: string
    candidate_archive_ref: string
    candidate_archive_sha256: string
    stdout_ref: string
    stdout_sha256: string
    stderr_ref: string
    stderr_sha256: string
  }
  measurement: {
    candidate_changed_paths: readonly string[]
    candidate_unauthorized_paths: readonly string[]
    candidate_forbidden_entries: readonly string[]
    candidate_frozen_before_oracle: true
    candidate_tree_after_oracle: string
    elapsed_ms: number
  }
  infrastructure_errors: readonly Diagnostic[]
}
```

### 6.5 EvaluationResult

```ts
interface EvaluationResult {
  schema_version: 1
  measurement_validity: {
    overall: 'valid' | 'invalid' | 'insufficient'
    dimensions: {
      outcome: 'valid' | 'invalid' | 'insufficient'
      mechanism: 'valid' | 'invalid' | 'insufficient'
      cost: 'valid' | 'invalid' | 'insufficient'
    }
    reasons: readonly Diagnostic[]
  }
  outcome: {
    externally_verified_completion: boolean | null
    behavior_vector: Readonly<Record<string, 'pass' | 'fail' | 'error'>>
    completion_claim: 'complete' | 'blocked' | 'absent'
    false_completion_claim: boolean | null
  }
  mechanism: {
    goal_created: boolean | null
    goal_rounds_started: number | null
    goal_terminal_phase: 'complete' | 'blocked' | 'paused' | 'active' | 'none' | null
    tool_calls: Readonly<Record<string, number>>
    turns: number | null
    steps: number | null
  }
  cost: {
    elapsed_ms: number | null
    input_tokens: number | null
    cached_input_tokens: number | null
    output_tokens: number | null
    failed_tool_calls: number | null
  }
  hard_gates: Readonly<Record<string, 'pass' | 'fail' | 'unknown'>>
  claim_strength: 'diagnostic'
  effect_claim_eligible: false
}
```

`null` 表示没有证据或该维度不可测，不用 `0` 冒充观测值。

## 7. DSH 运行组合

### 7.1 Management 与 runner profiles

DSH plugin manager 创建的 `profiles/eval/package.json` 是产品入口，只挂载 base 与 Eval Lab bundle：

```json
{
  "name": "dsh-profile-eval",
  "private": true,
  "dependencies": {
    "dsh-eval-lab": "<exact-installed-package-spec>"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-eval-lab"
      ]
    }
  }
}
```

`init` 生成的 `profiles/eval-runner/package.json` 是 child carrier，bundles 顺序固定：

```json
{
  "name": "dsh-profile-eval-runner",
  "private": true,
  "dependencies": {
    "dsh-codex-connect": "0.1.0-alpha.4.7",
    "dsh-eval-lab": "<same-exact-installed-package-spec>"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "dsh-codex-connect",
        "dsh-eval-lab"
      ]
    }
  }
}
```

Management app 与 runner bridge 来自同一 package digest。Runner common patch 必须禁用 `dsh-eval-app` 并启用
`dsh-eval-bridge`；dump-config 中 app row 未禁用即拒绝 carrier。Bridge 与 Task Pack 是 Eval Lab deployment，
不属于被测 intervention；两个 arms 的 package tree、bridge bytes/config/tool schema 必须相同。package spec 的
host absolute path 只进入 deployment metadata；可比较 content fingerprint 使用构建产物 bytes 与 package manifest
digest，不能因安装目录不同而产生假差异。

### 7.2 Common patch

Common patch 做六件事：

1. `dsh-eval-app.disabled=true`、`dsh-eval-bridge.disabled=false`；
2. `session-persistence-jsonl` 使用专用 runtime root、`compression: none`、`packChunks: false`；
3. 禁用精确 rows：`tool-bash`、`tool-pwsh`、`tool-jobs`、`tool-str-replace-editor`、`tool-web`、`tool-skill`、
   `tool-subagent-control`、`tool-subagent-list-agents`、`tool-subagent`、`tool-subagent-fork`、
   `tool-subagent-report`、`tool-workflow`、`tool-ralph` 与 `plan-mode`；
4. 保留 `tool-fs`、`tool-fs-search`、`workspace_test`、Todo 与基础 Agent loop；
5. 固定 native tool presentation、workspace-write 与 no-interactive-approval execution；`approval` 及
   `permission` 的 workspace-write preset 都必须解析为 `never`，否则 headless 不得启动；
6. 把 `goal.defaultMaxGoalRounds` 设为 8，并由 bridge 拒绝显式更大的 `max_goal_rounds`。

禁用 shell 是测量与 secret 隔离要求：DSH 的 workspace-write 只限制文件写效应，不限制读取、network 或 process
visibility。允许任意 shell 会让 Candidate 有机会读取 `$DSH_HOME`、源码、Oracle 或 gold，令
`oracle_hidden_from_candidate` 无法成立。

### 7.3 `DshEvalBridgePlugin`

Bridge 只提供两个能力，不监听或改写 model messages：

1. `ctx.tools.guard()`：
   - `read` / `read_image` 只允许解析后位于 Session cwd；
   - `write` / `edit` 只允许 `src/**`；
   - path 解析失败、symlink escape、NUL、绝对越界和 `..` escape 一律拒绝；
   - 未列入 allowlist 的 model-facing tool 一律拒绝；
2. `workspace_test`：无参数、固定 argv，在 Session cwd 运行公开测试；不接受 command、path、env 或 timeout 输入；
   子进程通过 Eval Lab 的 macOS deny-default `StrictProcessRunner` 启动，只能读取 Node 所需系统文件与 workspace，
   只能写 workspace/tmp，network 全拒绝，并显式拒绝 source root 与 runtime root。

Bridge 使用普通 `tool/call` / `tool/result` 证据，不新增 observation event。它的 conformance tests 必须证明：

- 读取 runtime OAuth path 被拒绝且工具 body 未执行；
- 读取 Eval Lab source/oracle/gold 被拒绝；
- workspace 内 read/glob/grep 正常；
- 只有 `src/**` 可写；
- `workspace_test` 无法被参数注入；
- public test 中尝试读取 credential/source/oracle sentinel 或联网均失败；
- control/treatment 的 bridge schema digest 相同。

### 7.4 Goal variants

Control patch：

```yaml
- id: goal
  disabled: true
- id: goal-round-driver
  disabled: true
- id: command-goal
  disabled: true
- id: tool-goal
  disabled: true
```

Treatment patch 显式写四个 `disabled: false`。Variant composer 对两个 `--dump-config` 结果做 canonical JSON diff；
除这四个布尔值外出现任何差异都以 `VARIANT_UNDECLARED_DIFF` 中止 Campaign。

### 7.5 Gate 0：headless carrier qualification

第一次真实 Campaign 前必须执行一个不计入结果的 read-only smoke task：

```text
Use workspace tools to read SMOKE.txt, then answer exactly DSH_EVAL_CARRIER_OK.
```

Qualification 必须证明：

- runner composition 中 `dsh-eval-app` 禁用、`dsh-eval-bridge` 启用；
- profile 解析 `openai-codex / gpt-5.6-sol / xhigh`；
- 真实 OAuth turn 完成；
- fresh Session 被持久化并能唯一定位；
- `request/header`、`request/context`、`tool/call`、`tool/result`、`assistant/message`、`turn/end` 可解码；
- usage 若 adapter 提供则可投影，缺失时 cost 为 insufficient 而非伪造；
- process 正常 quiesce/flush/exit；
- bridge 拒绝越界读取；
- smoke workspace 没有非声明写入。

Qualification artifact 绑定 deployment fingerprint，有效期不是时间，而是 exact package/config/model/tool digest；任一变化即失效。
Gate 0 失败时不自动改走 Web carrier。

## 8. Task Pack：`open-coding-ts-ledger-v1`

### 8.1 Public task

Fixture 是一个零第三方 runtime dependency 的 TypeScript package。Agent 需要完成：

```ts
class ReservationLedger {
  static open(file: string, capacity: number): Promise<ReservationLedger>
  reserve(request: { requestId: string; key: string; units: number }): Promise<Reservation>
  commit(requestId: string): Promise<LedgerSnapshot>
  release(requestId: string): Promise<LedgerSnapshot>
  snapshot(): Promise<LedgerSnapshot>
}
```

公开语义：

1. capacity 与 units 为正安全整数，总占用永不超过 capacity；
2. 相同 `requestId + key + units` 的 reserve 重放返回同一 reservation；
3. 相同 requestId 携带不同 payload 必须 conflict 且不修改状态；
4. pending reservation 可 commit 或 release；相同终态重放幂等，冲突终态拒绝；
5. 所有成功状态转换在 Promise resolve 前持久化，重启后恢复；
6. 损坏或不认识版本的状态文件 fail closed，不能用空状态覆盖；
7. 同一进程的并发调用必须串行化，不能超卖；
8. snapshot 稳定排序，便于外部验证。

公开任务要求 Agent 最终回答以 `TASK_COMPLETE` 或 `TASK_BLOCKED` 结束。该 token 只表达 Agent 自己的完成主张，
不参与 Oracle 成败。

### 8.2 Base tree

```text
package.json
tsconfig.json
README.md
src/
  errors.ts
  ledger.ts          # incomplete
  types.ts
test/public/
  basics.test.ts
  replay.test.ts
SMOKE.txt
```

只有 `src/**` 允许变化。public tests 可读不可写。fixture 不含 `.env`、credential、网络配置、gold 或 Oracle。

### 8.3 Hidden behavior vector

Candidate freeze 后生成随机 seed 与 case 数据，`ledger-oracle-v3` 以八个独立、各自有超时边界的进程评估行为；相较 v2，terminal 与 restart 维度同时覆盖 release 幂等、冲突、持久化和 capacity 恢复：

```text
basic_reservation
idempotent_replay
conflicting_replay_rejected
no_oversubscription_concurrent
terminal_transition_idempotency
restart_recovery
corrupt_state_fail_closed
deterministic_snapshot
```

`externally_verified_completion=true` 要求八项全 `pass` 且 unauthorized-path gate 通过。实现不与 gold diff 比较。

### 8.4 Calibration corpus

- `red/base`：初始不完整实现；
- `gold/equivalent`：一个正确但非唯一实现；
- `mutant/no-lock`：必须只被 concurrency 相关 checks 明确击中；
- `mutant/no-persistence`：必须被 restart/durability checks 击中；
- `mutant/corrupt-resets`：必须被 corruption fail-closed check 击中；
- `mutant/broken-release`：必须被 terminal 与 restart checks 击中；
- `mutant/release-not-persisted`：必须被 restart/durability check 击中。

Calibration artifact 保存每个 check 的方向与重复性，不进入 Candidate Campaign 分母。

## 9. Campaign 执行算法

### 9.1 状态机

```text
prepared
  → qualified
  → arm_1_running
  → arm_1_frozen
  → arm_2_running
  → arm_2_frozen
  → oracle_running
  → projected
  → reported
```

任意未完成状态在进程异常后标记 `interrupted`。Phase 1 不续跑原 Campaign；用户重新运行会得到新 campaign id、
fresh workspaces 与新的 Oracle seed。已冻结双臂的 `report` 重建除外。

### 9.2 Prepare

1. `doctor` 与 calibration 必须通过；
2. 载入/验证 Pack 与 Variant schemas；
3. dump、canonicalize、diff 两个 DSH compositions；
4. 计算 ExperimentSpec 与所有 content digests；
5. crypto-random 选择 `[control,treatment]` 或 `[treatment,control]`，写入 manifest；
6. 从同一 base tree 创建两个独立 Git workspaces；
7. 确认 base digests 相等且不存在 symlink/submodule；
8. 冻结 task prompt bytes，不在看到 arm 结果后改变。

### 9.3 Run arm

Runner 以 workspace 为 cwd，显式传入：

```text
DSH_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/dsh-home
DSH_TOOLS_MODE=native
DSH_PERMISSION_MODE=workspace-write
```

Management app 启动 child process 时必须从自身已验证的 exact `DSH_HOME` 构造 fresh allowlisted env，不能从 cwd、
home-level file 或 ambient `~/.dsh` 重新解析。Child process 收到其他 DSH home 或缺失该变量即为 infrastructure invalid。

并用 argv 调用：

```text
<local-dsh-bin> --profile eval-runner
  --patch <common.patch.yml>
  --patch <arm.patch.yml>
  <exact-public-task>
```

Runner 串行执行 arms，不共享 Agent Session，不注入第一臂输出。timeout 时先 SIGTERM 等待 DSH 有界 dispose，
超出宽限后再 SIGKILL，并把该 arm 标为 infrastructure invalid；不能把 timeout 当 Candidate failure。

### 9.4 Session discovery

专用 runtime root 在每个 arm 前记录 Session inventory。Child DSH process 返回后必须恰好出现一个 header.cwd 等于该 arm
workspace、createdAt 落在 run interval 内的新 root Session。零个或多个都为 `SESSION_DISCOVERY_AMBIGUOUS`。
读取 plain JSONL 时用 DSH 官方 storage decoder，并验证 header、连续 seq、最后一个 `turn/end` 与 flush 后文件稳定 digest。

### 9.5 Candidate freeze

不使用 Agent 的 Git index。Runner 用临时 `GIT_INDEX_FILE`：

1. `git read-tree HEAD`；
2. `git add -A`；
3. `git write-tree` 得到 Candidate tree；
4. 列出 base→candidate 全部路径与类型；
5. 任何 `src/**` 外变化、symlink、submodule 或 `.git` 异常使 hard gate fail；
6. `git diff --binary HEAD <tree>` 写入 artifact；
7. `git archive <tree>` 生成 Candidate tar；
8. 对 tree id、patch、tar 与 Session log 分别 SHA-256；
9. 后续 Oracle 只使用 tar 的只读解包副本。

Freeze 后不再运行 Agent，也不把 Oracle 结果写回原 workspace。

## 10. SessionEvent projector

Projector 是纯函数：同一 header + events 必须产生 byte-identical canonical JSON。

### 10.1 必需证据

- `request/header`：provider/model/effort 与 tool schema；
- `request/context`：route/capacity 元数据；
- `user/message`：公开任务与 Goal continuation source；
- `assistant/message`：最终文本与 usage；
- `tool/call` / `tool/result`：调用、失败与 workspace_test；
- `goal/change`：operation、phase、revision、roundsStarted；
- `turn/start` / `turn/end`、`step/start` / `step/end`；
- Session header cwd、lineage 与 agent preset。

未知 `ignorable: true` event 保留到 raw evidence 但不阻止投影；未知 required event、seq gap、open committed boundary、
provider/model 不符或缺少终态使相应维度 invalid。

### 10.2 投影规则

- `goal_created`：存在 operation=`create` 的 `goal/change`；
- `goal_rounds_started`：所有合法 goal snapshots 的最大 `roundsStarted`；
- `goal_terminal_phase`：最后一个 goal snapshot phase，clear 后为 `none`；
- `turns` / `steps`：只计当前 fresh lifecycle，不计 seed；
- token：累加 `assistant/message.usage`，任何 step 缺 usage 则该 token 字段为 null 并把 cost 标为 insufficient；
- failed tool call：`tool/result.error` 或 model-facing `isError=true`；
- completion claim：最后一个非空 assistant text 的尾 token；两种 token 都无则 `absent`；
- false completion：仅当 outcome valid 时计算 `claim=complete && externally_verified_completion=false`。

Projector 不用文本启发式猜 Goal、成功、阻塞或 tool failure。

## 11. Hidden Oracle

Oracle 在 Candidate freeze 后运行，输入只有 candidate archive、pack version 与本次 seed。它不读取 Session text 来判功能。

执行要求：

- 解包到新临时目录，拒绝 tar traversal、symlink 与 device entry；
- 生成 exact hidden cases 到该临时目录；
- 清空代理、credential、DSH、Campaign 与用户环境变量，只保留最小 PATH/locale；
- 使用与 `workspace_test` 相同的 `StrictProcessRunner`：deny-default、network denied、只读 Node/system/candidate roots、
  只写 Oracle temp；source root 与 runtime/credential root 显式 deny；
- 每个 behavior check 有独立 timeout 与结果；
- stdout/stderr 有字节上限；
- Oracle runner schema 错误、Node 不可用或自身崩溃是 measurement invalid；
- Candidate assertion failure、throw 或 behavior timeout 是该 check fail/error，不是基础设施成功。

Oracle 输出先写临时文件，fsync 后 atomic rename 为 `behavior.json`。Report 只消费冻结结果，不动态 import Candidate。

## 12. 指标出生证

### 12.1 `externally_verified_completion`

```yaml
utility_claim: 八项外部行为全部成立，代表这个开放编码 Episode 交付了公开需求的可运行实现
estimator: hidden behavior vector 全 pass 且 unauthorized-path gate=pass
validity_bounds: Oracle/seed/generator/fixture/version 任一漂移；Candidate 可见 Oracle/gold；边界外改动；Oracle 自身错误
consumer: 个人用户决定本地 Keep/Iterate/Revert/Run More
calibration_plan: red/gold/五个定向 mutant；每次 pack digest 变化强制重校准
repeatability_contract: acceptance；同 candidate+seed 必须 byte-identical，换 seed 允许 case 变化但行为方向不得反转
```

### 12.2 `false_completion_claim`

```yaml
utility_claim: Agent 明确声称完成但外部行为未通过，代表错误终止风险
estimator: final token=TASK_COMPLETE AND valid externally_verified_completion=false
validity_bounds: outcome 无效；final message 缺失；任务协议未包含 terminal token；输出被截断
consumer: 用户判断 Harness 是否降低虚假完成，而不是判断语言风格
calibration_plan: 构造 complete+fail、complete+pass、blocked+fail、absent 四象限 fixture
repeatability_contract: acceptance；只依赖冻结 final message 与 Oracle result
```

### 12.3 `goal_activation`

```yaml
utility_claim: Goal stack 只有被真实创建并进入 continuation rounds 时，才能解释为机制介入
estimator: goal/change create presence + max roundsStarted + last phase
validity_bounds: goal events 缺失/未知版本/seq 损坏；Goal rows 未完整开启；prompt 强迫 create_goal
consumer: 用户区分“插件可用但没触发”和“触发后结果如何”
calibration_plan: synthetic logs 覆盖未创建、创建零轮、多轮、complete、blocked、clear、malformed
repeatability_contract: attribution diagnostic；同 log 纯 fold 必须 byte-identical
```

### 12.4 Cost vector

```yaml
utility_claim: elapsed/token/step/tool 增加代表本地使用者为该 Harness 付出的资源与交互代价
estimator: monotonic process clock + assistant/message usage + durable event counts
validity_bounds: adapter usage 缺失；clock 非单调；timeout/infra failure；两臂版本或 route 不同
consumer: 用户在结果相近时选择更便宜的 Harness 配置
calibration_plan: synthetic usage aggregation + wall-clock bounds；缺 usage 必须 abstain
repeatability_contract: diagnostic；事件计数 exact，elapsed 与 token 不要求跨真实运行相等，不计算 CI
```

六公理检查：Episode 是单位；结果保持向量；Oracle 与 Agent 分离；pack/version 可退役；结果不回灌；
Outcome/Mechanism/Cost 与后续改进实验分开。

## 13. Measurement validity

### 13.1 Hard invalidators

- composed config 有未声明 arm diff；
- 任一 install/management/runner process 未在 boot 前继承 exact dedicated `DSH_HOME`，或 ambient `~/.dsh` 有读写证据；
- runner 中 management app 未禁用、bridge 未启用，或被测 Agent 运行在 management process；
- management / runner 的 Eval Lab package version 或 content digest 不同；
- package/model/effort/tool schema/permission 不同；
- OAuth/provider fallback 或 route 不明；
- Candidate 读写 workspace 外路径的守卫证据；
- Oracle/gold/arm identity 泄漏；
- Session log 缺失、歧义、损坏或无法绑定 arm；
- Candidate 未先 freeze 就运行 Oracle；
- Oracle 后 Candidate tree 改变；
- runtime/source/data root 混用；
- red/gold/mutant calibration 未通过。

### 13.2 Insufficient but not invalid

- treatment Goal 没被激活：Outcome 仍可比较，但不能归因到实际 Goal continuation；
- adapter 某一步没有 usage：Outcome/Mechanism 可 valid，token cost insufficient；
- final token absent：Oracle outcome 仍可 valid，false-completion insufficient；
- 两臂同结果：合法诊断结果，不等于“证明无效”；
- single pair：永远 `effectClaimEligible=false`。

### 13.3 Precedence

每个 dimension 独立判定。Overall 规则：任一影响核心可比性的 invalidator → `invalid`；否则任一必需维度 insufficient
→ `insufficient`；其余为 `valid`。Report 必须保留仍然有效的字段，不因一个 cost 缺口丢弃 Outcome。

## 14. Paired Impact Report

Markdown 首页只展示：

1. Experiment identity 与 validity；
2. control/treatment Outcome 并排；
3. Goal mechanism 是否触发；
4. Cost 向量与 raw delta；
5. hard gates / blind spots；
6. 当前允许的下一步。

动作生成是确定性规则，不由 LLM 撰写：

| 条件 | 建议动作 |
|---|---|
| measurement invalid | `Run More`：先修列出的测量边界，旧结果不可解释 |
| treatment fail、control pass | `Revert`：在本 Task 上保持 Goal off，并检查机制证据 |
| treatment pass、control fail，Goal activated | `Run More`：增加同领域 Task，不可直接宣称 uplift |
| 两臂都 pass，treatment 更贵 | `Keep baseline` 或 `Iterate`，没有结果收益证据 |
| 两臂都 fail | `Iterate task/harness`，先看两臂共同 failure |
| treatment 未激活 | `Iterate experiment`，当前没有 Goal continuation 机制证据 |

`Keep` 只表示保留个人本地当前配置；`Revert` 只表示本地恢复 baseline；Phase 1 不执行这些动作。

## 15. 错误与退出码

稳定错误族：

```text
0   command completed; report may still describe candidate failure/no effect
2   DSH app command usage or contract invalid
10  runtime doctor/auth not ready
11  carrier qualification failed
12  variant composition invalid
13  campaign infrastructure invalid
14  calibration not ready
15  artifact integrity failure
```

业务失败不能靠 app process 非零表达：Candidate Oracle fail 是合法实验结果，仍生成 report 并退出 0。只有无法可信地产生结果时非零。

所有 diagnostics 结构化为：

```ts
interface Diagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  evidence_refs: readonly string[]
}
```

message 禁止包含 credential、OAuth URL/code、account id、完整 user home path或未经裁剪的 model/tool output。

## 16. 安全与隐私验收

- 所有实验仅用新建 fixture 数据；
- runtime root `0700`，credential `0600`；
- install、management、runner 的 supported invocation 均在 process boot 前设置 exact dedicated `DSH_HOME`；
- acceptance 使用不可读/不可写 ambient-home sentinel，证明 supported path 不访问 `~/.dsh`；
- management profile 不创建被计分 Agent；runner model-facing request/tool evidence 不含 app command surface；
- auth status/doctor 用插件官方 secret-free JSON；
- Agent 无 Bash、PowerShell、terminal、web、subagent、skill 或任意 command tool；
- fs guard 只放行 workspace，mutation 只放行 `src/**`；
- public test 与 Oracle subprocess 均由 functional-probed macOS deny-default runner 执行；无 OAuth/DSH/proxy 环境且无网络；
- logs/report 对 credential patterns、OAuth URL、device code 做 fail-closed scanner；命中则 artifact quarantined、report invalid；
- Git ignore 不能作为 secret 边界，源码与 runtime 物理分离才是边界；
- 不提供自动删除；任何未来 cleanup 必须精确目标并由用户显式调用。

## 17. 测试方案

### 17.1 Unit

- DSH app-argument grammar、help 与稳定退出码；
- dedicated `DSH_HOME` pre-boot contract 与 `--runtime-root` rejection；
- schema parsers、canonical JSON、digest；
- path containment 与 symlink escape；
- arm-order randomization record；
- SessionEvent folds 与 malformed streams；
- completion token 四象限；
- cost aggregation/null propagation；
- deterministic action recommendation。

### 17.2 Contract

- package manifest `dsh.bundle.patch`、app/bridge exports 与 bundle patch；
- management/runner profile composition，证明 app/bridge 角色互斥；
- install/app/child process env capture，证明每次 boot 都收到 exact dedicated `DSH_HOME` 且不探测 ambient home；
- DSH dump config parser；
- exact four-row variant diff；
- bridge tool allowlist/guard；
- JSONL official decoder + packed-row rejection；
- Git temporary-index freeze including untracked files；
- tar traversal/symlink rejection；
- artifact ref/digest resolution。

### 17.3 Calibration

- red fail、gold pass；
- five Oracle-v3 mutants each caught by the intended behavior；
- same seed repeatability；
- distinct seed behavior stability；
- Oracle self-error classified invalid rather than candidate fail。

### 17.4 E2E without model

Fake carrier emits canonical Session logs for：

- control fail / treatment pass + Goal activation；
- control pass / treatment fail；
- both pass；
- both fail；
- treatment not activated；
- missing usage；
- extra config diff；
- ambiguous Session；
- interrupted process。

每个场景 snapshot `report.json` 与关键 Markdown sections。

### 17.5 Real acceptance

按顺序执行，不能并行：

1. 在 ambient-home sentinel 下，先以 `0700` 创建 dedicated runtime/DSH home，再用 exact `DSH_HOME` 将 built tarball 安装到 fresh `eval` profile，
   证明 `dsh --profile eval --help` 只由 app plugin 提供且 ambient home 零读写；
2. 在同一 dedicated home 下执行 `dsh --profile eval init` 创建 runner profile，dump-config 证明 app/bridge 角色互斥；
3. explicit user OAuth login；
4. Gate 0 carrier qualification；
5. `dsh --profile eval calibrate`；
6. one real `dsh --profile eval run`；
7. 从 artifact-only `dsh --profile eval report` 重建；
8. 比较首次与重建的 canonical report digest；
9. 人工检查报告没有 secret、没有总体 uplift claim、没有把 candidate failure 说成 infrastructure failure。

真实 acceptance 花费两个正式模型 Episode + 一个 read-only qualification Episode，运行前必须显示成本边界。

## 18. Red → Green 实现顺序

### Milestone 0 — Repository and contracts

1. 新建独立 Git repo 与 runtime-root invariant tests；
2. 先写四个 JSON schemas 和 parser failure tests；
3. 实现 canonical JSON/digest/artifact refs；
4. 实现纯函数 app-argument parser、DSH app plugin skeleton 与稳定退出码；
5. 实现 package manifest / bundle patch contract tests，证明 app 与 bridge row 的默认角色相反。

**完成证据**：不运行模型也能构造、校验和重放 fake Campaign artifact；pure parser 覆盖全部
`dsh --profile eval` 命令，bundle manifest/patch 能由 contract test 验证。

### Milestone 1 — Runtime profile and safety bridge

1. 写 management/runner composition 与 bridge 越界读取/写入红测；
2. 实现 DSH app plugin boot、`init` 与 management/runner profile role gate；
3. 实现 tool guard 与 `workspace_test`；
4. 生成 common/off/on patches；
5. 实现 dump-config fingerprint 与 exact diff gate；
6. 实现 auth facade、doctor。

**完成证据**：插件能安装并从 `dsh --profile eval` 启动；无模型 contract tests 证明 management app 不进入 runner，
secret/source/oracle paths 不可由工具读取，两个 arms 只差四个 Goal flags。

### Milestone 2 — Pack and Oracle

1. 写 red/gold/mutant fixture；
2. 先让 calibration tests 红；
3. 实现 seeded hidden Oracle；
4. 实现 no-network/sanitized-env/timeout runner；
5. 让 calibration 与 repeatability 全绿。

**完成证据**：`dsh --profile eval calibrate` 产生 pack-bound ready artifact，不调用模型。

### Milestone 3 — Carrier, freeze and projector

1. fake process/session discovery 红测；
2. 实现 `DshRunCarrier`、SIGTERM/SIGKILL timeout；
3. 实现 temporary-index Candidate freeze；
4. 实现 official JSONL decode/projector；
5. 实现 dimension-level validity。

**完成证据**：fake E2E 全场景生成正确 EvaluationResult；随后独立运行 Gate 0。

### Milestone 4 — Pair runner and report

1. 写 Campaign state/restart/interruption tests；
2. 实现随机 arm order 与串行 coordinator；
3. 实现 paired comparison 和 deterministic recommendations；
4. 实现 artifact-only report rebuild；
5. 做一次真实 Campaign acceptance。

**完成证据**：任何合法结果组合都能生成诚实 report；rebuild digest 相等；无 secret / no unsupported claim。

## 19. 产品 Acceptance Criteria 映射

| Product AC | 实现证据 |
|---|---|
| AC-1 / AC-2 | ExperimentSpec、dump-config exact diff、fresh workspace/Session contract tests |
| AC-3 | Gate 0 + Episode `request/header/context` route evidence |
| AC-4 | bridge guard、disabled tools、Oracle post-freeze seeded generation |
| AC-5 | temporary Git index tree + tar/digest + no-write-after-freeze invariant |
| AC-6 | official decoder、projector fixture matrix、seq/header/lineage validation |
| AC-7 | sanitized isolated Oracle process、no repair state machine |
| AC-8 | error taxonomy + fake E2E classification matrix |
| AC-9 | report schema/snapshots + hard claim fields |
| AC-10 | artifact resolver + canonical rebuild digest |
| AC-11 | red/gold/five-mutant Oracle-v3 calibration |
| AC-12 | runtime doctor + ambient-home sentinel + forbidden integration tests + no external effects |
| AC-13 | source/runtime/reference-lab root invariants + exact pre-boot `DSH_HOME` env capture + secret scanner |
| AC-14 | dedicated-home built package install test、app command E2E、management/runner role gate、runner request/tool surface absence proof |

## 20. 明确延后

以下只能由 Phase 1 真实证据触发，不进入当前实现：

- 第二个 Task Pack 或 Domain registry；
- 用户自定义 Eval Pack；
- Web UI；
- LLM Judge；
- 多次重复、置信区间与总体 uplift；
- 任意插件 manifest `evalBinding`；
- 自动 promote/rollback/sunset；
- Web carrier adapter；
- 远端 evaluator、团队权限与多人决策流。

如果 Gate 0 证明 `dsh --profile eval-runner` 无法在 exact OAuth route 下满足证据边界，应先形成一份 carrier mismatch 记录，
再单独设计 Web carrier；不得在这个 spec 中用双路径 fallback 掩盖未验证事实。

## 21. Source Map

- [DSH Eval Lab 产品方案](./2026-08-17-dsh-eval-lab-product-plan.md)
- [In-snapshot DSH primary evidence bundle](../evidence/dsh/README.md)

外部 provenance（不属于 assignment 实现依赖，隔离 Agent 不得访问）：Clowder AI Agent Eval Epistemology、
DeepSeek Harness 设计分析、DSH OAuth 插件扫描、F267 Measurement Validity。产品方案与本 spec 已冻结它们对
Phase 1 的适用结论。
