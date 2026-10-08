---
feature_ids: []
topics: [coding, consumer, harness, permissions, trial-design]
doc_kind: consumer-trial-contract
created: 2026-09-09
status: command-flow-complete-source-check-incomplete
fresh_context_agent_consumer_observed: true
independent_human_consumer_observed: false
qualification: not_qualified
---

# 新会话消费者试用：方案与当前授权门

本阶段要检验一个未参与开发、未继承本线程上下文的 Agent，能否仅凭包内 README 完成
一轮消费。它不修复 Java，不审代码，不再测那道支付修复题；它使用未修复基座，正确解释
验收失败并完成回放。真人体验和独立评测资格不由这轮 Agent 试用代替。

**已完成一次新会话消费者试用，命令链完成，但消费者侧来源摘要核对未闭合。**
详见[实际反馈与补充交付回执](CONSUMER-FEEDBACK.md)。之前的工具授权拒绝与预检诊断
分别保留，不能将接入问题算成消费者不会使用。

## 为什么需要一个有限的控制端入口

上一轮已发现，在 Agent 终端沙箱内直接运行验收器，会触发 macOS Seatbelt 嵌套拒绝。
消费者的评测控制端与被测代码不是同一权限角色，不能为了调用验收而打开整个宿主执行权限。

因此增加一个仅用于本地试用的固定命令入口，通过
[Codex STDIO MCP 配置](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers)挂在现有 Harness 上。
其[标准传输](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio)
使用本地进程的标准输入/输出；没有新增公开服务、SDK 依赖、账号或全局配置。
它是作者提供的接入适配器，**不能隐去后再称作完全无作者参与的端到端消费**。

| 入口 | 允许内容 | 明确不允许 |
| --- | --- | --- |
| read_guide | 原样返回固定包的 README | 任意文件读取、作者答案、历史会话 |
| kit_command | doctor、prepare、submit、evaluate、replay | shell、workspace-exec、外部路径、任意源码或文件写入接口 |

prepare 只能创建一个实例；submit/evaluate 只能引用该入口刚产生的实例和提交；replay
只能引用它产生的 Run；evaluate 最多一次。全过程最多 32 次工具调用，日志逐条内容寻址。
评测命令以固定 argv 调用包内 CLI，不经过 shell。被测代码仍由原有 StrictProcessRunner 隔离。
Agent 原生文件权限仅覆盖空白前台目录及必要开发工具，不直接获得整个消费包或控制日志的权限。

## 试用前固定的判读边界（eval-design）

- **utility claim**：在这个预先搭好的受限接入环境中，新会话 Agent 能凭原说明完成一轮
  未修复基座消费，且不需运行中追加作者指导。它不证明所有用户都觉得易用。
- **estimator**：保留说明读取、环境检查、实例创建、源码提交、一次基座验收、回放一致、
  包输入不变等分项观察；无“可用性总分”。权限预检未通过时机会未成立，记未观察，不记消费失败。
- **新鲜证据**：真实 CLI 产物、控制端调用日志、原生 Session 和工具结果关联；不以模型的
  自报“完成”代替。模型自然语言反馈保留为体验意见，等待人的判断，不自动转成事实或评分。
- **角色**：作者提供说明/适配器/观察器，未冒充独立校准者；试用者为独立上下文的新 Agent
  会话，非跨猫代码 reviewer；operator 决定消费价值与授权。真人消费者尚未参与。
- **repeatability**：固定包摘要、README、提示、模型与权限；一次根 Session，无 fork/resume、
  无运行中追加消息。拟沿用 gpt-5.6-sol/xhigh，上限 300 秒和 1 MiB 原生输出，不自动追加模型尝试。
- **validity bounds**：同宿主/固定 JDK、作者提供接入环境、公开历史任务、同 JVM 观察器限制。
  工具授权/环境失败与消费结果分开；未观察到的体验不得由作者演练补齐。
- **calibration / roles overlap**：目前只有开发与无模型预检，缺少独立真人和校准者；仍为
  not_qualified，不得把新模型会话当成另一票独立真值。

## 当前做到了什么

本地后端定向检查通过：拒绝任意 shell 和外部 Run 路径，按原包 README 的命令完成一次
基座验收/回放，结果为预期的 valid/fail。没有修复基座或更改包摘要。

- 后端证据根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/consumer-broker-test.eKkXDE`
- 基座 Run：`16e7b4e5e8336a17c5f5b5ec2b17615a463c7eb478b4ccf3c556e8599d81e34d`
- 四项原有原生轨迹/参数检查通过，仅消费保存的无模型轨迹。

随后使用新建、无登录的 model-free home 和本地合成响应，检查现有 Codex 0.153.4 能否
通过 STDIO 调用这两个工具。工具已被原生层发现，但调用被拒绝，原始错误为：

```text
MCP tool call requires approval, but approval policy is never
```

- 预检根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-trial.5hzkRX`
- 证据：`launch.json`、`process.json`、`preflight.json` 和合成请求记录。
- 原生进程退出 1；控制端实际调用记录为 0；真实模型请求为 0。
- 缺失后端产物导致后续预检断言终止，预检正确未通过；真实 prepare 要求全部预检门通过，
  当时不能产生获准的 live launch。

没有通过修改 approval_policy、伪造只读工具注解或换通道绕过这一拒绝。原工具策略、原包、
既有 Coding 结果和失败预检都保留。新增入口仍为本地实验代码，没有公开发布。

## 授权范围与后续处理

operator 于 2026-09-09 09:37 UTC 在消息 `0001788946676859-000030-078dc411` 明确授权
**本轮固定工具消费试用**：允许新会话读取原 README，并在新复制包里调用上表
五种命令；包括它们必需的实例/提交/验收产物写入，不包含任何任意宿主命令权限。
代价是一轮最多 5 分钟的消费者模型运行；所得证据用于判断此接入下的消费流程，不晋升资格。

使用[官方列明的逐工具配置](https://learn.chatgpt.com/docs/extend/mcp)，在本轮启动参数中：

- `enabled_tools = ["read_guide", "kit_command"]`；
- 服务默认 `default_tools_approval_mode = "prompt"`；
- 仅这两个工具的 `tools.<tool>.approval_mode = "approve"`；
- 全局 `approval_policy = "never"`、原生文件权限和网络禁用保持不变。

授权来源和准确工具/命令范围进入启动清单，并在启动前校验；没有改全局配置文件或伪造只读
注解。这些设置已在固定的本机 Codex 0.153.4 实际验证，不仅依据最新文档推测。

授权后的预检曾发现两个诊断脚本问题：`RqkGIX` 中局部 process 变量遮蔽 Node 全局对象，
导致末项检查没有构造成功；`7TARjq` 中检查进程被不需要的 OpenSSL 系统配置读取阻断，尚未
触及目标文件。前者改为 processEvidence；后者只在不使用 TLS 的文件读取探针指定
`--openssl-config=/dev/null`，未增加读权限或修改系统配置。末项判据明确要求命令退出 0 且
恰有两个明确拒绝结果，不能把启动失败算成隔离成功。以上失败记录均保留，真实模型请求为 0。

最终无模型预检 `janitor-consumer-trial.y8KFYY` 的 10 项门全部通过：完整原生会话与参数/
权限关联、正确题面、固定工具命令实际执行、基座 valid/fail、回放一致、拒绝 shell、外部 Run
和两个私有文件读取。工具配额与候选 OS 沙箱未改变。

- 预检根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-trial.y8KFYY`
- live launch：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-trial.qS8L4y/launch.json`
- launch digest：`7a5e4fac43b9dded815ececff37b4948c4c0fa2e839ddb500aa686240810992b`
- 包摘要仍为 `f653cf46a8637c5dccae897802532486546b88e90353590edf88b216239fc9f6`。

以上是当时的预检通过和 live 准备检查点。随后的唯一会话在 90.082 秒内完成命令链，6 次
控制端调用全部成功，基座保持原样、验收 valid/fail 且回放相同。原生 Session、准确授权、
broker 事件链与 66 个包文件不变均已核对；结果摘要为
`e144661db869c62715afe0098f7e43696e25f75d5932c94d982e9d3c8a28d6d8`。

消费者还指出没有收到 README 要求的外部预期包摘要，已核实初始输入确实漏发。原始八项
观察全成立不等于这项来源核验完成；补充[交付回执](DELIVERY-RECEIPT.md)仅供后续分开发送，
不改旧包或旧结果，尚未复测。真人体验、独立校准及跨宿主结论仍未取得，保持 `not_qualified`。
