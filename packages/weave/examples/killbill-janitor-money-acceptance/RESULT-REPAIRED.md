---
feature_ids: []
topics: [knowledge-consumption, budget-censoring, experiment-design]
doc_kind: experiment-result
created: 2026-09-11
status: stopped-budget-design-question
qualification: not_qualified
---

# 修复后结果：基座已能运行，但五分钟内没有新增交付

**这次不再是先前的 Mockito 环境故障。原始资料组成功运行了旧验收，随后继续查资料；
五分钟截止时源码仍是原样，没有 INFORMATION.md。知识包组因现有停止规则未启动。**
因此仍没有知识包效果的两组对照，也不能把“限时未交付”说成“领域知识无效”或“一般能力不行”。

## 已核对事实

| 项目 | 观察 |
| --- | --- |
| 执行 | gpt-5.6-sol / xhigh；300,005 ms 后因时间上限 SIGKILL；未触发输出上限 |
| 工具行为 | 11次顶层工具调用及11个对应输出；均为资料／目录查看或基座编译运行，没有源码补丁调用 |
| 环境修复 | call 9按公开的build/run命令运行，输出旧五场景和END；没有再报缺ByteBuddyAgent |
| 资料获取 | 查Janitor、DAO helper、Plugin接口和状态映射；call 3、5的较大输出被截断，之后继续定向读取 |
| 实际交付 | 停止后捕获的源码与冻结基线逐字相同，未产生INFORMATION.md，未正常结束会话 |
| 正式判题 | evaluation=null，没有新增Java判题；artifact replay保持原不完整结果 |
| 第二组 | 无attempt、invocation、process或episode；资料及起始源码均未改变 |

原始轨迹能说明“到截止时没有新增交付”，不能精确拆分每段时间属于模型计算、排队、网络延迟或
检索策略，也不足以证明“只要多给一点时间就会完成”。本轮没有追加模型或Java执行。
最后已记录用量为input 315787（cached input 267264）、output 7480、total 323267，
共11条usage记录；含重复上下文，不是材料字数，不代表中断请求的完整计费信息。
不拿它与上一轮用量差异估计修复收益：两次独立采样且上一轮环境受干扰，不是受控成本实验。

## 现在需要校准的是试验口径

1. **五分钟目前是控制侧预算，不是明确告知Agent的交付时限。**
   TASK.md并未说明五分钟截止，运行器也没有发送剩余时间。不能把这个临时预算擅自升级为产品能力门槛。
2. **当前实现把“未正常结束”与“观察面失效”放进同一停止分支。**
   `live-pair`在native_complete=false时break；第二组入口也要求第一组native_complete=true。
   时间用尽本来可以是有效的“预算内未交付”观察，却因此阻止收集另一组的结果。
3. **不能为了出正结果事后加时、重跑A，或悄悄改标签。**
   修订试验口径必须显式记录。此次保持原记录不变，未修改停止逻辑、启动B或追加预算。

作者建议：下一步以“同一预算内的交付程度／成本”作探索观察，两组独立运行；
超时记为未交付，环境／权限／身份证据失效才阻断测量。若采用该口径，可保留本次A，
只运行尚未启动的B，不给它新增提示或更多预算；必须公开这是看到A结果后修订了停止规则，
仍不作统计性或一般性收益结论。若五分钟确实是目标应用的真实交付要求，则后续应在两组共同
题面中明确告知，不能只在B中补充。

这不是新的业务规则争论，也不是再补一个依赖就能解决的问题；需要明确我们关心的是
“固定预算内的交付”还是“最终交付所需工作量”，再决定下一轮的结果解释和运行规则。

## 证据

根：`/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-knowledge-trial.5uXHdK`。

- pair：`control/knowledge-pair.json`，digest `10eced5424c713a8fbd161fa088968567b1348cd4a87d1ab7ce6d87a1d7139d0`。
- A episode：`control/verifier-run.UAJHiQ/consumer-episode.json`，
  digest `992532b165d6d2c647e4c77902efb9164758c479bd262763fcd096bff13c645b`。
- Session：`01a08e37-7d9e-7f70-b1e4-8bdccf958b9a`；transcript SHA-256
  `7d48857c6db59006d0de26d5d09eb9ff404067a2fc470fd8e063031e4876877b`。
- 捕获提交：`control/submissions/ca641add5c564130b8eb7535161e70052472d92f10aa2ae194ee81ec6a2d0e1c.json`；
  source SHA-256 `b37448e10f15130acda2708f181b5bb7072591b646ec25e6960f6f5ca7af2ec1`，与本轮起始源码相同。
- B运行槽：`control/verifier-run.0FO7dw`，只有launch.json。

已核对内容摘要、准确题面、模型／effort、文件和网络权限、调用输出配对、双方受保护输入不变及
纯产物replay。没有完成态native校验，不假称完整会话通过；静态核对与数据重放不是独立审阅。
此前交叉审阅按operator撤回，本轮仍为not_qualified。
