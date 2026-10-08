---
feature_ids: []
topics: [coding, harness, consumer, integration, evidence]
doc_kind: local-consumer-guide
created: 2026-09-07
status: internal-consumption-guide
---

# 外部 Harness 如何消费这道代码任务

我们提供的是**有来源的代码任务、受控开发环境、源码验收与可回放证据**。
外部 Harness 提供模型、Agent 循环和工具调用适配；被测 Agent 交付 Java 源码。
Agent 不交付分数，Weave 不用 Agent 的修复声明替代代码执行结果。

本说明整理已有 [本地 CLI](../../../../scripts/killbill-coding-task.mjs) 的真实行为，
不新增 Schema、公共 SDK 或新的 Harness 协议。现阶段仍需本项目 checkout、Node/tsx、
macOS sandbox-exec 和固定 Java 依赖；**不是已经可跨机器分发的独立安装包**。
DSH 与 Codex CLI 已实际消费同一固定任务和判定器；这是作者接入的同机单题证据，
尚未完成未经指导的外部消费或跨宿主安装验证。

## 谁拿到什么

| 接收方 | 可以拿到的材料／能力 | 不应交给它的东西 |
| --- | --- | --- |
| 被测 Agent | `workspace/TASK.md`、缺陷源码、`ENVIRONMENT.json`、LICENSE、公开依赖；受限的工作区读写／命令工具 | `control/`、验收驱动、作者参考实现、私有评分结果、宿主无约束 shell |
| 外部 Harness 的可信协调器 | `prepare` 返回值、固定任务摘要、公开任务文本；绑定工作区的工具适配入口 | 不能把它拥有的控制侧权限转交给模型工具 |
| 验收控制侧 | 固定任务、源码提交快照、私有依赖、观察器、期望映射和原始执行结果 | 不接受 Agent 自报分数作为真实观察 |
| 结果消费者 | Code Run；有受信来源核验时，再关联外层 Agent episode | 不能从一次代码通过推出一般编码能力或自动独立资格 |

可信协调器是应用角色，不一定另开一个服务。权限边界必须由实际工具和进程隔离实现；
给 Agent 一句“别读 control”或设置工作目录都不够。

## 当前可用的五个操作

以下命令由**可信协调器**在本项目 checkout 根目录执行。尖括号均需替换为实际绝对路径；
`workspace-exec` 自己进入公开工作区，不要求协调器切换 cwd。运行数据只能放在
`/Users/slipshod/AIBuild/dsh-eval-lab-runtime` 下。

### 1. 准备新工作区

```sh
node --import tsx scripts/killbill-coding-task.mjs prepare '<runtime-parent>' '<dependency-directory>' '<jdk-home>'
```

依赖版本、SHA-256 和 JDK 条件见 [README](README.md)。此操作固定任务、保护文件、依赖与
观察实现，并验证基座缺陷可观察。JSON 返回 `root`、`workspace`、`task_digest`、`source` 等字段。
给模型的是 [TASK.md](TASK.md) 和公开工作区，不是含有 oracle 的 `control/task.json`。

同一题换 Harness 时保留相同任务语义与验收实现。当前 `task_digest` 也绑定宿主/JDK/实现指纹：
改这些条件会产生新摘要，不能强行沿用旧摘要宣称环境相同。每次真实运行应新建工作区和会话，
不要复用另一个 Agent 已修好的源码目录。

### 2. 让 Agent 通过受限工具开发

```sh
node --import tsx scripts/killbill-coding-task.mjs workspace-exec '<task-root>' '<development-command>'
```

外部 adapter 将模型工具调用转成这个操作，或调用同一受限执行函数。
任务根路径由协调器固定，不能接受模型传入的任意任务根。用进程参数数组传入整个 command，
不要将模型字符串再拼进协调器的宿主 shell；真正的开发 shell 只能由该操作在沙箱内启动。

工作区可以读写、网络被拒绝、私有控制目录不能读写；命令上限 15 秒、输出上限 128 KiB。
三个工具 `workspace_read / workspace_write / workspace_exec` 的现有 DSH 适配示例在
[bridge](../../../../scripts/lib/dsh-coding-bridge.mjs)。这些工具名不是第三方必须采用的公共协议；
第三方可使用自己的工具命名，但必须证明权限和提交范围相同，不能留下绕过限制的原生工具。

注意两层状态：CLI 成功输出 JSON **不代表开发命令成功**。应读取返回对象中的
`exitCode`、`signal`、`stdout`、`stderr`、`timedOut`、`outputLimitExceeded`。
开发失败可以在同一任务预算内反馈给 Agent 正常修正；私有最终评分不能自动反馈重试。

本例是组件目录，不是 Git checkout。使用 `ENVIRONMENT.json` 中的绝对 JDK 路径；不要假定
`JAVA_HOME` 或系统 `javac` 可用。临时构建放 `build/`，最终仅接纳
`src/PaymentTransactionInfoPluginConverter.java`。

### 3. Agent 结束后冻结源码

```sh
node --import tsx scripts/killbill-coding-task.mjs submit '<task-root>'
```

协调器先确保 Agent 与其工作区命令已停止，不能有后台写入者继续竞争源码快照。
`submit` 检查保护文件、输入集合、链接和稳定读取，再返回 `digest`、`task_digest`、`path`。
交付的是完整源码快照：若 Harness 产出 patch，应先受限地应用到工作区，而非把 patch 文本
直接当成这里支持的提交格式。未知文件、额外源码文件及保护输入变化都会被拒绝。

### 4. 在控制侧验收快照

```sh
node --import tsx scripts/killbill-coding-task.mjs evaluate '<task-root>' '<submission-digest>'
```

使用固定依赖及观察器，在另一个私有构建目录编译提交快照，并调用真实 Java 方法。
不使用 Agent 的 `build/`，不读之后仍可能被编辑的工作区源码，不要求与参考补丁逐字相同。
输出包含 `digest`、`path`、`result`，其中：

- `measurement_validity`：`valid` 或 `invalid`；
- `verdict`：`pass`、`fail` 或 `inconclusive`；
- `diagnostic`：说明编译失败、观察完成或观察协议不完整；
- `mismatches`：实际方法行为与固定要求不符的条目；
- `task_digest / candidate_digest`：绑定哪道固定任务和哪份代码。

CLI 抛出异常时是操作未完成，不能编造一个 Code Run。当输出 `inconclusive / invalid` 时，
不能转换成模型能力失败。当前这些值是内部代码任务的现有语义，不是新的全产品 verdict Schema。

### 5. 回放结果

```sh
node --import tsx scripts/killbill-coding-task.mjs replay '<run-json-path>'
```

只从保存的 Run 核验摘要关联并返回结果，不重跑模型、Java 或当前判定器。
同一候选可以产生不同执行回执；同一个源码摘要不是同一个运行 ID。
所有运行材料默认保留，不自动清理或过期。

## 代码结果与 Agent 来源是两件事

仅通过上述 CLI 提交源码，Code Run 会如实保留：

```text
claim_scope: component_code_artifact_only
agent_execution: not_observed
qualification: not_qualified
```

这不是说外部 Agent 一定没有运行，而是**这层代码验收器本身没有证明谁生成了源码**。
可信协调器应另外保留并核验：固定的实际输入、Harness/模型/工具版本和预算、新会话身份、
原始模型与工具记录、完成/超时/退出情况、最终源码与生成记录的关联，再连接到 Code Run。
仅提交一份自报 `model`、`sessionId` 的 JSON，不构成来源证明。

DSH 的 [协调器](../../../../scripts/lib/dsh-coding-harness.mjs) 已实现自己的这些核验。
Codex 的[来源适配](../../../../scripts/lib/codex-coding-harness.mjs)也已取得真实运行证据；
其他 Harness 仍需实现并验证对应适配。当前没有可接收任意第三方自报 episode 并自动
授信的公共入口。不能为了通过而改写 Code Run 的 `not_observed`，也不能让 Harness 给自己评分。

## 第二个 Harness 的验收边界

按已对齐的产品步骤，后续需要取得这些真实证据：

1. 由另一套实际 Harness 的 Agent 循环执行，而非更换 DSH 的模型名或人工写入答案。
2. 只按本说明提供任务与工具，不为它改题目、判定器或提前提供私有答案。
3. 启动前证明控制目录和未允许工具不可达；模型认证留在可信控制面，不读取/复制凭据来移植环境。
4. 原始轨迹可核验，冻结源码确实对应其输出；代码验收由同一任务执行器完成。
5. 区分接入失败、环境问题、源码失败和证据不足；记录人工介入，不把人工恢复标成全自动。

本说明和命令行冒烟检查只能改善接入可操作性，不能替代第 1 项真实执行，也不能替代独立资格。
初期消费者仍需遵守现有 macOS/本机运行边界；跨宿主发行及正式 API 要等消费验证后再决定。

## 本轮接入探查（2026-09-07）

当前工程入口及源码验收本来就不依赖 DSH runtime；本轮没有改它们的实现、摘要或评分规则。
本机已发现 Claude Code 安装候选 `/opt/homebrew/Caskroom/claude-code/2.1.150/claude`，
但其 `--help` 启动即收到 `SIGKILL`，stdout/stderr 均为空。二进制为 arm64，与宿主匹配；
`codesign --verify` 通过。这些检查没有定位发出 SIGKILL 的原因，不能称为安装损坏或认证失败。

未启动 Claude 模型、未检查认证内容、未修复或替换外部安装。

替代候选 Codex CLI 已完成只读启动探查：本机版本 `0.153.4`，在新建的
`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/codex-consumer-probe.3gjL6g` 中使用独立
`CODEX_HOME`、限定环境变量，只执行 `--version` 与 `exec --help`，二者退出码均为 0。
没有读取默认认证文件、复制登录信息或请求模型。CLI 帮助明确列出非交互执行、JSONL 事件、
工作区选项，以及 `--ignore-user-config`（但该选项本身并不会更换认证目录）。

官方 [CLI 文档](https://learn.chatgpt.com/docs/developer-commands?surface=cli) 确认上述非交互及
事件输出选项；[配置文档](https://learn.chatgpt.com/docs/config-file/config-reference) 提供
`features.shell_tool` 开关。关闭默认 shell 的配置能力不等于已经证明全部模型工具都无法
绕过隔离，必须在所选 CLI 版本上单独验证。`--ephemeral` 不用于正式运行：证据默认持久保存。

**下一接入优先候选为 Codex CLI**，而非在本任务中修复 Claude 安装。后续适配应仅负责：
把公开任务交给新的 CLI 会话，将文件/命令能力限制在公开工作区，保存实际 JSONL 轨迹并绑定
源码输出，然后调用本页已有的提交和验收操作。权限约束未证明前不启动真实模型；
隔离账户授权必须通过正常授权流程完成，不能从默认目录或 DSH 认证文件搬运凭据。

这轮启动探查没有新增 MCP/SDK 依赖、实现另一套模型循环、发布公共 API 或改变题目摘要。

## Codex 原生工具隔离检查（2026-09-07）

[probe-codex-coding-tools.mjs](../../../../scripts/probe-codex-coding-tools.mjs) 已通过一次完整、
有结果断言的无模型检查。它启动真实 Codex CLI 0.153.4，但 provider 仅为该脚本在
`127.0.0.1` 随机端口创建的合成响应端点，模型响应不来自 OpenAI 服务或任何真实模型。
每次创建全新运行目录和 CODEX_HOME，显式使用 file credential store；没有认证信息可复用。
响应端点不记录 HTTP header，并拒绝任何带 Authorization 的请求，不输出其值。

从仓库根执行：

```sh
node --import tsx scripts/probe-codex-coding-tools.mjs
```

它只用于本机指定 Node/JDK/Codex 版本：不接受远端 provider 参数、不提供 live 模式，
20 秒进程上限、1 MiB 过程输出上限、最多 9 次本地合成请求。只向真实 CLI 提供预定的工具调用
响应，由 Codex 自己调度工具；这是接入前检查，不是另造一个 Agent 循环或让模型返回评分 JSON。

配置开关不等于工具访问控制。探查发现，某些关闭开关并不会使请求中的工具声明消失，关闭
Code Mode host 还会让其调用失效。因此当前可行路线是 Codex 的**原生文件权限 profile**：
仅允许公开工作区写入、Node/JDK 和 `:minimal` 运行支撑读取，禁止命令联网及权限提升。
完整参数保存在 launch 中；其依据是官方[权限配置说明](https://learn.chatgpt.com/docs/config-file/config-reference)。
本轮没有添加 MCP 或改写已有 DSH bridge；未来 Codex adapter 应复用这组已验证的原生权限，
继续调用原有源码提交和 Java 验收流程。

| 实际合成调用 | 观察结果 |
| --- | --- |
| 原生命令读取公开文本，再尝试私有文件读写 | 公开读取成功，私有读写均为 EPERM |
| `apply_patch` 更新私有 canary | 读取被 EPERM 拒绝，原文件不变 |
| `view_image` 读取私有合成图片 | 读取被 EPERM 拒绝，没有返回图像 |
| 将命令 cwd 改为私有目录后重做读写 | 仍拒绝，改变 cwd 没有扩大授权范围 |
| 请求 `require_escalated` | `approval_policy=never` 拒绝 |
| 命令连接本次本地合成端点 | EPERM，未因端点在 localhost 而放行 |
| 原生 `apply_patch` 创建公开文件 | 成功，控制侧核对文件内容 |
| 公开目录编译并运行合成 Java 类 | Java 11 目标编译及执行成功，返回 `JAVA_READY` |

脚本将上述观察与过程完成、调用序列完整性、私有文件未变合为 12 个检查项；任一缺失或失败
即 `preflight_rejected`，不能仅凭 CLI 返回 0 判通过。曾发现 Node 默认 OpenSSL 配置不在最小
读取面，以及相对路径使 cwd 探针提前失败，均未当成越界被拒的证据；最终探针使用显式无外部
OpenSSL 配置和绝对公开路径，确保真实尝试了私有读写。早期探查记录保留，不改写为最终通过。

最终证据：

- 运行根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/codex-tool-probe.jXd0HP`
- `result.json`：`a0859aa56036167b6c34b27227244e6dbf4f3829c27aa6bd4c85d098d181deaf`
- `launch.json`：`e394ba3032e680d8bc32e5b6aec9fa17eacdbe1754b9892888615ccf55224419`
- 原始请求、工具结果、CLI JSONL 输出、stderr 和 Codex 本地 Session 均保存在该运行根。
- `bounded_native_isolation_verified`；`real_model_requests: 0`；`coding_task_executed: false`；
  `qualification: not_qualified`。原始轨迹里的 usage 来自合成响应，不能当成真实 token 成本。

证明范围限于上述实际操作和固定版本，不是“只有三工具”、任意工具/子 Agent 的全覆盖安全证明，
也不是第二 Harness 已完成真实代码任务。工具声明仍有 functions/collaboration 等名称；本轮没有
调用子 Agent。配置包含开发中的 `skip_host_skill_discovery`，CLI 的对应警告如实保存。

### 后续真实运行的前置条件

仍需将 Codex 的持久 Session/工具轨迹与最终源码接到原有提交和验收链，冻结实际模型及预算，
并完成一次独立授权。认证目录已新建为
`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/codex-coding-auth.W6vkrJ`；不能读取或复制默认
`~/.codex/auth.json`，也不能搬运 DSH 凭据。

由 operator 在自己的终端完成正常登录（本轮只检查了 login help，没有替 operator 发起登录）：

```sh
CODEX_HOME=/Users/slipshod/AIBuild/dsh-eval-lab-runtime/codex-coding-auth.W6vkrJ \
  /Users/slipshod/.npm-global/bin/codex \
  -c 'cli_auth_credentials_store="file"' login --device-auth
```

设备码登录及 file store 见官方[认证文档](https://learn.chatgpt.com/docs/auth)。设备码是否可用取决于
账户设置；若不可用，只反馈非敏感错误，不采用该文档中的凭据复制方案。完成后只回复已登录，
不要发送 token、验证码或认证文件。登录不是运行许可或隔离证明的替代；实际 Coding 启动仍需
绑定上述权限与预算，不直接以该认证目录的默认设置执行任务。

### Codex Coding 本地协调入口

operator 随后回复已登录；协调器仅核对了独立 `auth.json` 的普通文件、无链接和 `0600` 权限元数据，
没有读取内容。实际账户/模型可用性仍以真实调用结果为准。

[codex-coding-run.mjs](../../../../scripts/codex-coding-run.mjs) 提供内部 `prepare` 与 `live`：

```sh
node --import tsx scripts/codex-coding-run.mjs prepare '<preflight-root>' '<isolated-auth-home>' '<dependency-root>' '<jdk-home>'
node --import tsx scripts/codex-coding-run.mjs live '<launch.json>'
```

`prepare` 核验 preflight 摘要、全部检查结果与 CLI/探针代码指纹；创建新代码任务工作区，
只将已验证配置中的可写工作区路径替换为新路径，并将合成 provider 换为原生 `openai`。
其余原生权限和功能配置保留。模型固定为 `gpt-5.6-sol / xhigh`；5 分钟进程上限、1 MiB
过程输出上限。本入口不宣称已经实现 DSH adapter 的逐模型请求／工具调用计数预算，
因此两个 Harness 的运行不是归一化成本或能力对比。

`live` 对同一 launch 只允许一次启动；核对初始源码仍为缺陷基座，保存 native JSONL 输出、
进程结果和完整持久 Session，核验实际 prompt、模型、权限与工具结果关联。只接纳一份新根
Session，发现委派或不完整轨迹则拒绝来源认定；不凭完成说明自动判代码成功。
进程结束后冻结源码、调用原有 Java 验收并回放，将两层回执关联到 `coding-episode.json`。
源码来源证明是受控单次工作区的结束快照，不伪称每种 shell/patch 写法都能直接逐字还原为
最后一次模型文本。原 Code Run 的 code-only 身份不变，外层为本地 Codex 观察来源。

会话解析已用保存的真实 CLI 合成轨迹验证，并检查了错误输入、扩大读取范围和工具结果缺失
被拒绝。该检查没有追加模型请求。随后真实 Coding 运行的结果见末节，仍保留 `not_qualified`。

首次托管启动在进入原生 CLI 前被参数一致性断言拒绝：原 launch
`def8732777a26f08897e854fed628a711e20c3b705f0c71fd0014b756de7396d` 的文件权限表在创建 argv
时保留插入顺序，canonical JSON 落盘后键顺序改变，重建的等价参数字符串因此不同。
当时运行目录只有 launch，没有 invocation/process 回执；独立认证目录没有 native Session。
这次没有启动 Codex、没有模型请求，也不是模型能力失败。诊断侧记保存在原运行根
`killbill-coding.lsmZv4/control/codex-run.DDbBsN/prelaunch-rejection.json`，不覆盖原 launch。

参数构造已改为先对整个配置做 canonical 归一化，覆盖外层及嵌套权限键；一项落盘重读回归检查
先红后绿。后续重新准备新 launch，而不是修改原失败记录或删除一致性校验。此前授权的首次
模型运行仍待真正启动，不将这次启动前拒绝算作完成了一次 Agent 任务。

随后另一启动在 CLI 参数解析阶段退出：任务正文以 YAML 的 `---` 起始，被当成选项。
该次原生进程仅运行 46 ms、exit 2，stdout 为空，未创建 Session 或调用模型；原过程回执
保存在 `killbill-coding.MDFevi/control/codex-run.aJhxW6/process.json`，摘要
`62c513d2afe944b82b6bf0ef4220db72d26e22e06f846ab278d2bcbc7fe465b0`。

根因还包括预检与 live 分别构造参数，预检只使用简单合成提示词，未覆盖真实任务的传参边界。
现已将两者统一到同一 canonical 参数构造器，添加 `--` 选项结束标记；预检使用真实 TASK.md
文本并从落盘重读的 launch 启动原生 CLI，再核验正文实际原样到达本地合成 provider。
这不是更换或简化题目，也不删掉原任务的 frontmatter。

对应的前导连字符回归先红后绿；更新后的无模型预检 13 项通过（原 12 项加真实正文传递）：

- 根目录：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/codex-tool-probe.1958CU`
- result：`5a838d6e4ec67e83bc4c7c2bf635950fe74a315791f25bb71e66b185e539dba2`
- launch：`a9fcc37ceaf57e8e59899080eb93fe40df36e06a659b4e4eaea76beff4441f58`

新预检额外固定共用参数构造器代码摘要；真实启动必须使用这份更新后的证据。旧 12 项证明
仍保留为历史隔离证据，不再满足新启动前置条件。这些预检的真实模型请求为 0，不能计入编码结果。

## 首次真实 Codex 编码结果

修订后以 `e473a69` 启动的首次真实模型运行自动完成，完整命令约 130 秒。
新 Session `01a07b34-f400-7e40-8425-7c90c472068d`，固定 `gpt-5.6-sol / xhigh`；
进程 exit 0、无超时、无输出截断。实际输入、权限、工具结果和源码快照的来源链已核对；
原有 Java 验收有效，12 项映射通过，回放一致。

episode 为 `d6553b57f4203f596d35877cd959996cff1f32e54830c9975fe9aa7bd109f5c3`，
保存在 `killbill-coding.0tfk4O/control/codex-run.pecPAI/coding-episode.json`。
源码提交 `7bd2df2fb134d049becc64804ee5e8de02c1e9da1c0e4f9790185dabd8425a39` 与 DSH 提交
不同；两份 Code Run 的固定 task 对象（含判定器）完全相同。
详细人读版、过程中的辅助命令错误与完整证据索引见 [README](README.md)。

第二套实际 Harness 消费这一单题已取得证据；这不是陌生消费者、跨机器发行、独立资格或
一般编码能力的证明，不改变 `not_qualified`。没有为了得到通过结果追加模型运行。
