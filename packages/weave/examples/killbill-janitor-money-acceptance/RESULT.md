---
feature_ids: []
topics: [knowledge-consumption, runtime-failure, experiment-validity]
doc_kind: experiment-result
created: 2026-09-11
status: stopped-environment-confounded
qualification: not_qualified
---

# 本轮结论：运行环境干扰了试用，未得到知识包对照结论

**原始资料组真实运行了，但在 5 分钟上限被终止；知识包组按停止规则未启动。**
原始资料组不是没有产出：它查了源码、改了 Java 验收，开发运行输出了旧五场景和新增三场景。
但它先被我们交付的测试框架运行配置缺口绊住，花了一部分过程改写模拟对象。
没有完成 INFORMATION.md，也没有进入控制侧正式判题。本轮不能说明知识包有效、无效或能节省多少时间。

## 实际发生了什么

| 阶段 | 可核对的事实 | 不作的推断 |
| --- | --- | --- |
| 资料读取 | 从原始 sources 定位 Janitor、DAO helper、交易记录和状态映射，并用 javap 查看依赖接口 | 不把检索次数直接换算成必要人工补答量 |
| 第一次开发运行 | 起始 Java 能编译，但 Mockito 初始化失败，报缺少 ByteBuddyAgent | 不是业务断言失败，不算原始资料组不懂领域 |
| 代码修改 | 三次补丁操作；用 Java Proxy 替代 Mockito 模拟对象，并增加三类字段缺失验收 | 不称这些代码已通过独立审阅 |
| 第二次开发运行 | 输出旧五场景及 missing_amount、missing_currency、missing_amount_and_currency，并有 END 标记 | 这是消费者自己的开发运行，不是组织者的五组件反例判题 |
| 最后活动 | 继续读取固定源码并定位行号；没有交付 INFORMATION.md 或正常结束会话 | 不猜剩余思考内容，也不把未写说明视为业务失败 |
| 截止与停止 | 进程在 300,014 ms 因超时收到 SIGKILL；知识包组无 attempt／invocation／process／episode | 不能做两组胜负、速度或成本比较 |

会话为 `01a08c70-f9cc-7d53-b6f6-76e95193e2cc`，记录 15 次顶层工具调用、15 个对应输出、
15 条模型响应 usage 记录，没有 task_complete。准确题面、gpt-5.6-sol/xhigh、restricted 网络与
文件权限均能在记录中核对；两个 user 记录分别为运行器环境信息和共同任务，没有运行中作者补答。
进程未触发输出上限；终止原因是时间上限。最后已记录的累计 token usage 为 input 529399
（其中 cached input 477952）、output 12290、total 541689；这是原生已记录用量，含重复上下文，
不是独立材料字数，不代表被中断请求的完整计费用量，也没有换算费用。

## 我们的交付问题是什么

控制侧 `assessSource` 会写入 `mockito-extensions/org.mockito.plugins.MockMaker`，内容是
`mock-maker-subclass`。公开工作区和 ENVIRONMENT.json 的构建／运行命令却没有提供等价配置。
因此消费者直接运行起始验收时走了 Mockito 的默认 inline 路径，报：
`NoClassDefFoundError: net/bytebuddy/agent/ByteBuddyAgent`。

原生预检只编译了 JanitorProbe，真正运行的是另一个简单的 Probe，得到 JAVA_READY；
它证明了 Java 与工具权限可用，**没有证明公开起始验收能按交付说明运行**。
这解释了为什么“预检全通过”与消费者遇到运行错误同时存在。

这是我们准备工作区时遗漏了控制侧运行设置；本轮没有证据把它归咎于领域知识不足。
也不能量化这一个问题造成了多少秒延误：后续补丁同时包含环境替代与新业务检查，时间不可直接拆分。

## 原始资料组已经写出了什么

它刻意把请求值、已有 processed 值和插件显式值设得不同，用于区分默认值来源：

| 新场景 | 写入验收的预期 | 本次开发运行输出 |
| --- | --- | --- |
| 插件金额缺失、币种存在 | 已有 processed 金额 3.25 ＋插件 GBP | 3.25 GBP |
| 插件币种缺失、金额存在 | 插件金额 7.50 ＋已有 processed 币种 USD | 7.50 USD |
| 插件金额与币种均缺失 | 已有 processed 值 | 3.25 USD |

这些断言与已固定源码的字段选择约定一致；至少观察到消费者能从原始资料写出这部分规则，
不能声称知识包是获得这些事实的唯一途径。但未运行组织者错误组件矩阵，不能宣布验收完整、
反例识别可靠或整个消费者任务完成。源码还保留旧五类场景并增加锁／身份断言，属于静态核对结果。

## 可复查证据

运行根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-knowledge-trial.Zz6x2C`。

- 已采用 pair：`control/knowledge-pair.b0f93efe73698d5f740efbebba0ff051d45be02ad20c1114cac2e63b3e77d6c7.json`。
- 原始资料组 episode：`control/verifier-run.6iyZBE/consumer-episode.json`，
  digest `f02fb7a7d90bcc2da856ec6ff9539221a43f83986d3b1c1278569f114a31d344`。
- 同目录 `process.json` 与 `native-capture.json` 保留实际超时及完整已记录过程。
  transcript SHA-256：`545fd2e9bfa3761050ad83b2714a1b3a98878a0268bf464a56b6174aec18c2d8`。
- 源码已冻结在 `control/submissions/5f62b572647e5460ada0e12e83d00f464d5615843d8fadf8b795eb630b62a064.json`；
  source SHA-256：`0c96dc77e2579b354bd0116d2d7d12a38b353bf8dfda017117808944f274fa3e`。
- 工具 call 8：起始验收运行异常；call 10/11/13：补丁；call 14：八场景开发输出；call 15：来源定位。
- 知识包组 `control/verifier-run.6zPHTH` 只有旧／新 launch，源码仍等于冻结基线。

已核对 episode/trial/submission 内容摘要、源码与当前停止后工作区一致、准确提示词、模型／权限、
双方受保护输入未变，知识包组未启动。纯产物 replay 返回 native_complete=false、evaluation=null、
artifact_error=null，未追加模型或 Java 执行。未给未运行组填零分，也未把无判题结果改成 fail。

## 下一步建议（本轮未实施／未重跑）

只修共同运行条件：向公开工作区交付控制侧已有的 Mockito subclass 配置，并让预检按公开说明
实际运行起始验收，而不仅是编译它。不增加领域提示、不更换业务题目、不靠引入新依赖或扩大权限解决。
修正并核验后，再决定是否另开一对试用；旧失败与未完成交付永久保留，不补跑覆盖成本或改写结果。
本次入口交叉审阅由 operator 明确撤回；这些结论是作者对原记录的诊断，不是独立领域效用证明。
