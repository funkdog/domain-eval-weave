---
feature_ids: []
topics: [coding, payments, recovery, agent-episode, evidence]
doc_kind: coding-result
created: 2026-09-09
status: single-local-agent-episode-observed
qualification: not_qualified
---

# Janitor 首次真实编码结果：业务状态修复通过

**一个真实 Agent 已完成这道冻结任务的源码修复，五个限定场景通过，证据回放一致。**
本次使用已有 Codex CLI 0.153.4、`gpt-5.6-sol / xhigh`，整条托管命令约 112 秒完成；
原生进程 110.389 秒，退出码 0，无超时或输出截断。原生记录包含 8 条模型响应记账与 7 次
顶层工具调用，Agent turn 为 105.887 秒。这些是本轮运行记录，不用于跨 Harness 能力或成本比较。

## Agent 具体改了什么

它删除了取得账户锁之前的旧快照读取，把锁内回调恢复为调用已有的“重新读取交易、再决定
是否更新”方法。没有增加新的恢复算法，没有修改依赖、观察驱动或期望值。

原始轨迹记录了读取公开源码、查看依赖与 DAO helper 字节码、应用这一个源码补丁及开发编译。
最终提交的完整源码与固定上游参照**字节一致**。这说明本轮恢复了已知正确路径，不是新的独立
算法发现；公开历史题的训练暴露未知，不能据此声称“模型从未见过答案”。公开 JAR 中目标类
原始字节码已在准备阶段移除，原有 helper 作为允许依赖仍可读取。

## 实际执行观察

外部协调器在原生进程停止后冻结源码，用可信依赖重新编译、执行。判定读取状态更新观察，
不采纳 Agent 的“已修复”文字，也不采用其开发 build 产物。

| 场景 | 实际状态与更新 | 结果 |
| --- | --- | --- |
| 旧请求遇到已完成扣款 | Payment 当前/最近成功状态均保持 CAPTURE_SUCCESS；锁内读到 AUTH 已 SUCCESS，更新 0 次 | pass |
| 正常未决授权恢复 | AUTH 变为 SUCCESS，Payment 推进 AUTH_SUCCESS；更新同一记录 1 次，金额/币种符合合同 | pass |
| 明确 UNDEFINED | 保持 UNKNOWN，更新 0 次 | pass |
| PENDING 未变化 | 保持 PENDING，更新 0 次 | pass |
| 账户锁失败 | 保持原状态，更新 0 次 | pass |

关键不是“全部绿”，而是同时观察到**不覆盖已有扣款进度**和**正常恢复仍能推进**。没有通过
永不更新来规避风险。上述五种机会的记录完整，锁释放、交易身份与固定交错前置均满足判读要求。

## 已核对的证据链

- launch、episode、process、源码提交与 Code Run 的内容摘要和相互引用一致。
- 仅新增一个原生 Session，其磁盘原文与 episode 内嵌轨迹及摘要一致；实际题面、模型、
  effort、cwd、权限和工具结果关联通过既有原生验证器。
- 最终公开文件集合不变，27 个受保护输入摘要不变；唯一源码文件与提交快照一致。
- live 与开发基座/等价 Run 使用完全相同的 task、grader 和执行实现指纹，没有看完答案再改尺子。
- artifact replay 只读取保存结果并重算五项向量，与记录完全相同；本次核对没有再执行 Java 或模型。

本轮有一个保留的辅助错误：Agent 尝试 `git diff` 时遇到宿主 `xcrun` 开发工具路径错误，
该组合命令退出 1，尚未执行后面的编译。Agent 随后直接使用给定 JDK 编译，退出 0。
可信验收编译也退出 0；执行时的 SLF4J NOP logger 警告保留。没有因此安装/修复宿主工具，
也没有把辅助命令失败归为本题业务失败。

## 证据索引

任务根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-coding.NzbStP`

- 源码实现版本：`4c58200`
- launch：`control/codex-run.Jfnrbi/launch.json`
  — `75ea873657f4374c0681f40c82e73c9b844b1837183c58f66ea57cb349915621`
- task：`6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8`
- episode：`control/codex-run.Jfnrbi/coding-episode.json`
  — `122cc757854152c0cfa38369d0ad670936016afc30e29aba585ad97d3f787c23`
- Session：`01a084bb-548c-7e31-9971-8485cc34bc7c`
- 源码提交：`c7c65c8afadae9587e0e2431410923b59412d3c0d0ac3ec8162b64342c2e09d6`
- Java 源码 SHA-256：`23df7a78b85a803d61bb5dd228388b0eceebdd9a36c7055cfaae49f0bf742e7c`
- Code Run：`control/runs/aa5ecad0ac130c46ce002bb44884f96de16da242eda3caf24f8c567c0ab5c256.json`
- grader SHA-256：`cb7ef53f2c122e2bf8414aa656d8ee5918afec88ef31fa2961867be319fc62f9`

## 证明到哪里为止

这闭合了本题的“业务定义 → 冻结任务 → Agent 修改真实源码 → 执行验收 → 可追溯回放”。
外层 episode 是 `observed_in_trusted_local_codex_run`；内层 Code Run 的
`agent_execution: not_observed` 只表示代码判定层不自行认证作者身份，两者不冲突。

仍为 **not_qualified**：仅覆盖直接给定 Plugin 结果的 on-the-fly 组件路径、内存 DAO 与
受控锁调度。Capture 完成是夹具输入，没有执行真实扣款、SQL、多节点锁或完整项目；同 JVM
观察器也不是抗恶意篡改证明。没有独立校准者或独立消费者；单题成功不证明领域包提升 Agent，
更不代表一般支付/并发 Coding 能力。领域 Claims、公共 API 和旧任务均不晋升。

后续重点是**无作者现场指导的消费可用性**。其工程前置——可复制交付包与同宿主搬移——
已有[单独证据](CONSUMPTION-RESULT.md)；但独立消费者是否能仅凭说明完成依赖准备、提交、
失败解释与回放仍未验证。不靠重复本题模型运行或增加无关场景来替代它。接口和边界详见
[本地交付合同](CONTRACT.md)与[消费说明](CONSUMER.md)。
