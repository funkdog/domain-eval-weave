---
feature_ids: []
topics: [domain-representation, janitor, processed-money, preparation-evidence]
doc_kind: preparation-result
created: 2026-09-10
status: mechanical-materials-and-author-probe-observed
content_review: pending
qualification: not_qualified
---

# 准备结果：材料机械覆盖成立，新增金额检查能区分两个错误版本

**本次完成了两组知识材料的机械准备，以及无模型的作者参照校准。尚未运行消费者，
也没有证明领域表示的收益。** 实现提交为 `2561227`；约 3 秒的托管命令正常退出，
四个 Java 版本各产生 12 条完整观察。原任务、领域包与历史结果不变。

## 1. 真正执行到了什么

继续使用固定上游 Janitor 源码、真实状态／DAO helper、旧受控 Store、账户锁及 23 个已冻结二进制
依赖。新观察器调用旧 `JanitorProbe.run` 保留五场景，再增加七个金额／币种场景，不重写支付算法。

| 作者提供的版本 | 旧五场景 | 新七场景 | 实际区分 |
| --- | --- | --- | --- |
| 固定上游参照 | 全部通过 | 全部通过 | 指定实现的基准行为 |
| 作者等价写法 | 全部通过 | 全部通过 | 给默认金额表达式加括号，行为不变；不是独立算法样本 |
| 错用 requested amount 作默认值 | 全部通过 | 三项失败 | both_absent_existing、amount_absent、success_with_zero_default |
| 错用 requested currency 作默认值 | 全部通过 | 两项失败 | both_absent_existing、currency_absent |

由此新增的证据是：**这两个明确构造的错误能通过旧观察场景，但会被新增观察场景识别。**
不推广为所有金额错误都能检出，也不将作者构造的参照与反例称为独立验收。

## 2. 参照实际写入了哪些值

各场景的 requested 值都是 `10.00 EUR`。以下是实际 Java 输出，不是只复述预期表：

| 新场景 | 已有 processed 值／状态 | Plugin 结果 | 实际恢复结果 |
| --- | --- | --- | --- |
| 两字段缺失 | 3.00 USD／PENDING | PROCESSED，金额与币种 null | SUCCESS，3.00 USD，更新一次 |
| 金额缺失 | 3.00 USD／PENDING | PROCESSED，金额 null、币种 EUR | SUCCESS，3.00 EUR，更新一次 |
| 币种缺失 | 3.00 USD／PENDING | PROCESSED，4.00、币种 null | SUCCESS，4.00 USD，更新一次 |
| 两字段明确 | 3.00 USD／PENDING | PROCESSED，4.00 EUR | SUCCESS，4.00 EUR，更新一次 |
| 显式零 | 3.00 USD／PENDING | PROCESSED，0 EUR | SUCCESS，0 EUR，更新一次 |
| 零默认值 | 0 EUR／UNKNOWN | PROCESSED，两字段 null | SUCCESS，0 EUR，更新一次 |
| 同一未决状态 | 3.00 USD／PENDING | PENDING，9.00 EUR | 保持 PENDING、3.00 USD，不更新 |

这些不同金额／币种是用于区分**字段来源**的合成记录，不是换汇或跨币种业务流程的正确性证明。
目标仍是固定实现的组件级行为；这些前置记录是否符合未来使用者的业务政策，需要另外核验。
SUCCESS 与 processed amount 0 并存，不能被解释成完成了原请求的 10 EUR。
没有查询真实 Provider、执行资金操作、SQL 或分布式锁。

## 3. A/B 输入准备到了哪里

- 最终材料根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-money-materials.FqE5AD`。
- A 使用分节 Markdown 文档；B 使用原始固定 `module.yaml`，没有新写只给 B 的业务知识。
- 每组 13 个共同文件逐字一致：五份人读模型、七份 sources 文件和共同 TASK。
- 逐节点清单覆盖 1,640 个节点（**包含对象／数组容器，不是知识条目数或质量分**）。
- 清单保留路径、类型、标量值／容器数量和 A 文档字符区间。29 个输出文件摘要与控制回执一致；
  渲染器和准备脚本摘要也与当前实现一致。两个必要的渲染测试检查类型／关系保留及删改拒绝。
- 原包 README、Landscape 和 release lock 的操作／发现入口从双方消费面共同排除，来源摘要仍
  在控制回执中。对照的是静态 Module 呈现，不是整个 Domain-First 编译、查询或发现产品。

这只能称为**字段覆盖和字节一致性核对**。分节文档是否自然易用、两种组织方式是否真正语义等价、
公共资料是否让任务过于容易，都还需要独立审阅。不能仅凭节点清单宣布公平性已通过。
共同 TASK 是准备时的草案；本批材料没有依赖完整的消费者工作区，也没有启动许可。
未来正式运行须重新固定准确的题面、输入、可修改文件、工具和预算，不能把这个目录直接当 launch。
格式化之前生成的 `janitor-money-materials.6cl89k` 保留，但不作为最终材料选择。

## 4. 核对记录与边界

无模型运行根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-money-probe.EcmrHe`。

- `report.json` digest：`0bbc4d7d53ad430016e6f33316c6b587440b1f70cab1779e46a6b7efbb14fa91`。
- 材料 `control/materials.json` digest：`cb26c5c3f2caed181a988e31ce9522927282114144a093bacad320e76a315bbe`。
- 旧任务 digest：`6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8`。

回填前只读核对了 report／frozen-input 摘要及对应内容、脚本／两份观察器／四份候选源码摘要、
各版本单独 evidence 与总报告相等、八次编译／执行进程正常结束，以及 stdout 中 nonce 帧解析出的
48 条观察与记录相同、场景顺序完整、实际失败集合符合事前冻结预期。SLF4J 的 NOP logger 警告保留。
核对没有再次执行 Java、模型或测试套件，也没有改写旧报告。

## 5. 下一步的实际门槛

| 工作 | 当前状态 |
| --- | --- |
| A/B 材料机械覆盖与共同输入核对 | 已完成 |
| 作者参照／等价／两类错误样本的组件执行 | 已完成，仅开发校准 |
| 文档可读性、语义等价与判据适用性的独立核验 | 待完成 |
| 消费者验收代码的提交、受控执行与元评估入口 | 待完成；旧固定命令 broker 不能直接承接 |
| 对全通过／全拒绝等投机验收器的校准 | 待完成；目前执行的是作者业务代码变体，不是消费者验收代码 |
| 真实 A/B 消费者运行、成本与收益观察 | 未启动 |

按 `eval-design`，已有源码锚与作者校准不能代替独立校准，也不能代替真实消费者的价值证据。
本次观察器由作者提供并与目标同 JVM；它不是任意消费者验收代码的隔离或抗篡改证明。
因此保留 `not_qualified` 和 `content_review: pending`；本阶段只完成准备检查点。
