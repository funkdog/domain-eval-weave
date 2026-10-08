---
feature_ids: []
topics: [coding, consumer, portability, local-delivery, evidence]
doc_kind: consumption-rehearsal
created: 2026-09-09
status: same-host-source-independent-rehearsal
independent_consumer_observed: false
qualification: not_qualified
---

# 本地消费包：做了什么、为什么现在做、得到什么价值

**结果：同一宿主上的新目录，已能只使用交付包完成检查、准备、提交、验收和回放。**
这一结果没有被升级为“独立消费者已经验收”：演练仍由作者执行，没有新增模型请求。

## 为什么在这个节点

上一阶段已验证真实 Agent 能修改这道题的源码并通过业务验收，但入口仍引用作者仓库与原
runtime 工件。若把这些隐含依赖一并称为“可复用领域资产”，消费者拿到说明仍可能无法开始。
所以本阶段先固定一个可交付单元，检验运行是否仍需要作者机器中的未交付材料。

这不是新建 Harness、扩大题库或比较模型；是补“资产 → 消费者实际使用”的交付边界。

## 本次工作

1. 增加本地导出器，按固定文件清单复制必要运行源码、任务种子、派生 JAR 和消费说明。
   不递归搬运原 runtime，不携带凭据、会话、完整开发 assessment、参考修复源码或以前 Agent 答案。
2. 将控制端代码与数据装进一个本地消费包；其 CLI 在导入运行模块前检查固定文件摘要，绑定
   包自己的 `state/` 目录。原仓库调用保持原来的默认 runtime。没有新增 npm 依赖或公共 API。
3. 将整个包复制到新目录，按[消费说明](CONSUMER.md)使用 Node 24 直接执行，没有 pnpm/tsx
   或原仓库参与子进程加载；验收仍使用原有 macOS StrictProcessRunner。
4. 定向验证原目录读取被拒、未修复基座仍会失败、回放一致、判读器文件变化会被拒绝。

包有 66 个受摘要保护的文件，负载 15,760,029 字节，另有 `kit.json` 与 `kit.sha256`。
JAR 在公开输入与可信依赖各有独立副本，避免可修改侧和验收侧共享文件。
消费者评测端持有私有判据；只有 prepare 返回的 workspace 才能交给被测 Agent。

## 已观察与未观察

| 问题 | 当前证据 |
| --- | --- |
| 是否还需要读取原仓库、原任务目录或原导出包？ | Node 文件权限拒绝这三处读取，搬移后的完整流程仍成功 |
| 包里是否真有未修复任务，而不是成功答案？ | 初始源码验收 valid/fail，仅 concurrent_capture 失败；其余四项通过 |
| 回放是否能脱离原作者目录？ | 从复制包 state 中的 Code Run 重算，结果一致，无 Java/模型调用 |
| 被测代码是否失去了隔离？ | 未改动 StrictProcessRunner；workspace-exec 拒绝读取私有包入口和原任务工件 |
| 固定代码被改动会怎样？ | 单独篡改副本的判读器，doctor 在导入该模块前以 kit file drift 拒绝 |
| 是否已经证明别人觉得好用？ | 没有；independent_consumer_observed=false |
| 是否支持换机器、系统或 JDK？ | 未验证且当前会按固定宿主/JDK 指纹拒绝，不宣称跨机支持 |

控制端是**可信程序**，其文件依赖使用 Node 权限检查；为了启动原有候选沙箱，显式允许
child_process。Node 对此的 SecurityWarning 原样保留，不能把这层说成抗恶意控制端的安全隔离。
候选程序的 OS 隔离是另一层，仍由原执行器承担。目录搬移不是独立评测资格，结果保持 not_qualified。

## 本轮发现的摩擦及处理

第一次演练把控制端整体也套进 macOS Seatbelt，内部编译沙箱申请被系统拒绝：
`sandbox_apply: Operation not permitted`，退出 71，未开始 Java 编译。
验收结果正确为 invalid/inconclusive，未将环境失败误记为业务失败。

处理是改变**演练分层**，不是关掉候选沙箱：可信 Node 控制端限定文件读取；原有执行器继续
为候选创建 OS 沙箱。其后一个检查把拒绝码限定为 EPERM，实际另一路返回 ERR_ACCESS_DENIED；
改为接受明确的拒绝码族，同时仍要求两处访问都被拒绝。该次也尚未进入 Java 验收。
最终仅一次完整基座编译/执行通过搬移路径；未重复先前真实 Agent 编码或四版本开发验证。

失败与警告留在原目录，不覆盖或自动清理：

- 嵌套沙箱失败：`janitor-consumer-exercise.SfliJE/copied-kit/state/janitor-coding.no5ajM/control/runs/14de24c258eb0d8d4a19b2d702f7c3f3c9138f1fb87a793d65e1627d62f57e98.json`
- 拒绝码检查过窄：`janitor-consumer-exercise.J0J71x/evidence/`
- 上述路径均相对于 `/Users/slipshod/AIBuild/dsh-eval-lab-runtime`。

## 交付与证据

- 可复制交付包：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-kit.kS2fXp`
- 包清单 SHA-256：`f653cf46a8637c5dccae897802532486546b88e90353590edf88b216239fc9f6`
- task digest 未变：`6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8`
- 演练原始证据：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-exercise.6rR4DL/evidence/result.json`
- 搬移后的基座 Code Run：`7de29db01d849e85e245d9d197ff63f4f4d46d23dd7add5d3c2c743f70bacba4`

作者侧重新导出命令为：

```sh
node --import tsx scripts/export-janitor-consumer-kit.mjs <已准备的任务根>
```

消费者只使用包内 README 和 `node cli.mjs`，不用运行导出器或访问作者模板。包的摘要用于
完整性核对，不是来源签名；公开发布/再分发尚未授权或验收。
原真实 Agent Run 的 artifact replay 也复核一致；本轮没有改动题面、判据或历史结果。
运行模块增加目录绑定后，旧 native launch 的代码指纹会失效，这是预期的拒绝重跑，不影响
原结果读取；未来新模型运行需新的权限预检与启动清单。

## 产出价值与下一步

现在，“可复用”至少有了明确交付物、入口和一条可复现的工程证据，消费者不必先理解作者的
仓库布局或索要运行目录。也显式暴露了尚未支持的边界：固定宿主/JDK、可信控制端、外部 Harness
的权限与来源责任、以及独立校准问题。

下一步才是**由未参与开发的消费者，仅凭包内说明完成一轮消费**，记录缺失输入、需要临时
解释的步骤、是否能理解失败原因与证明边界。在取得这种外部反馈前，不把作者演练标为独立
可用性通过，也不需要再跑一次模型来替代人的消费体验证据。

后续以独立上下文 Agent 作为另一类消费者，经过明确授权后完成了命令链，并发现外部预期摘要
漏发。具体[试用范围](CONSUMER-TRIAL.md)与[实际反馈](CONSUMER-FEEDBACK.md)单独记录；这不
改写本篇作者搬移演练的历史结论，也不等于独立真人已经试用。
