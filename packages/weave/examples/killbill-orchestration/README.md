---
feature_ids: []
topics: [kill-bill, payments, domain-module, candidate]
doc_kind: domain-module-guide
created: 2026-09-06
---

# Kill Bill 支付编排与恢复：候选领域包

本包回答：一次支付操作进入 Kill Bill 后，会产生哪些对象和状态，接下来能做什么，结果不确定时
怎样恢复。范围固定为 Kill Bill 0.24.21 的直接 Payment API 与默认状态机。

当前状态为 **0.1.0-candidate.4**。领域模型与行为模型 v0.2 已有 operator 确认；场景推演形成
行为说明 v0.5 与 Claim v0.3 候选，并加入 Stripe Plugin 分析及应用侧恢复决策契约草案。
Claim 保留 12 条 grounded、4 条 unknown、0 条 confirmed。
打包和编译不提升真值，也不代表真实支付、结算或对账已经验证。

## 一页交付核对结论与完整消费示例

**本轮结论：可作为限定范围内的候选知识基线，用于解释支付编排、分析集成风险和设计后续契约。**
金融结果判定、自动扣款与自动评分仍未就绪。这是作者的交付核对结论；不是独立使用者验证，也
不替代 operator 的正式验收或 Claim 真值确认。

| 检查面 | 已有内容 | 使用限制 |
| --- | --- | --- |
| 范围 | Kill Bill 0.24.21 直接支付与未决恢复，六类操作均有模型位置 | 中国监管、资金清结算、对账等仍在边界外 |
| 模型与流程 | 对象描述、字段/可空性/所有权、状态转换、六条流程及失败恢复说明 | 字段/流程被保留为定义，尚非支付执行器 |
| 核心知识 | 12 条 grounded、4 条 unknown；精确来源与版本有记录 | grounded 表示有来源支撑，不等于无条件正确或已获 Provider 确认 |
| 实现边界 | Stripe Plugin 8.0.4 的查询副作用、Search 推断和幂等路径 | 适配器限定分析；新增外部资料使用精确链接/当前官方说明 |
| 应用策略 | E3 提出查询、等待、原请求重放等六种决策 | 候选策略；没有混入 Kill Bill 原生规则或新增 confirmed Claim |
| 交付 | 固定来源、机器 Module、完整说明与一致性校验入口 | 包完整性校验不证明真实支付成功或消费效果 |

### 一个下游使用者怎样消费这个包

**输入问题（假设案例）。**同一账户/环境内，100 CNY 的 PURCHASE 曾是 UNKNOWN。Stripe Plugin
8.0.4 搜索不到 Charge 后把本地结果改成 CANCELED，core 随之记录 PLUGIN_FAILURE。现在只有
原 Transaction T 和 external key K，没有保存实际 Stripe 幂等键 J 或可靠的 PaymentIntent ID。
能否判定支付没发生，再换一个 key 发起 PURCHASE？

**先检查适用性。**问题使用 core 0.24.21、默认状态机、Plugin 8.0.4；核心 Claim 按这些版本和
调用路径选用。对于 Plugin/Provider 行为，继续读取 E2，而不是把 core 规则外推到资金结果。

| 选用材料 | 它支持的判断 | 不能据此推断 |
| --- | --- | --- |
| PaymentTransaction / TransactionStatus / ProviderTransactionObservation | 区分 core 状态、Plugin 报告与外部事实 | 同名“失败”就代表没有扣款 |
| CL-04 `plugin-result-mapping` | CANCELED 可以映射为 core PLUGIN_FAILURE | 映射后的状态成为“未支付”的独立证据 |
| CL-08 `failed-operation-new-retry` | 满足 guards 时 core 可以接受后续新 Transaction | core 允许操作就等于业务有权安全重扣 |
| CL-09 `success-key-reuse-rejected` | 已成功交易的重复 key 有拒绝路径 | 失败状态、新 key 或 Provider 端也有同等保护 |
| 行为文档 E2 | 该插件 Search 空结果会推断本地 CANCELED；本地重复保护不保证稳定 J 复用 | 搜索结果即时完整、J 等于 K/T、所有 Plugin 都如此 |
| 行为文档 E3 | 候选策略要求证据不足时等待或转人工 | 这份建议已经部署，或是 Provider 制定的商户政策 |

CL-04/08/09 的逐条原文、状态、适用性和 source_ids 均可从 [机器 Module](module.yaml) 读取，
对应的人读内容见 [Claim 清单](docs/killbill-payment-orchestration-claim-ledger.md)；模型定义见
[Semantic Model](docs/killbill-payment-orchestration-semantic-model.md)，E2/E3 见
[Behavioral Model](docs/killbill-payment-orchestration-behavioral-model.md)。

**形成回答。**不能据此确认支付未发生。PLUGIN_FAILURE 是由插件推断经过 core 映射而来，现有
信息没有独立证明资金结果。按 E3 的候选策略，应保持 `WAIT_FOR_EVIDENCE`；没有安全补证路径时
返回 `RECONCILE_REQUIRED`。这不授权换 key 新扣款，也不证明原支付已经成功或已经重复扣款。

**明确尚缺什么。**可靠关联的 Provider 对象及结果，或第一次真实请求的 J/原参数/上下文，以及
相应查询或重放能力和产品策略。只有 core 已有的 T/K 不能替代这些信息。四条 unknown 继续显示，
但本例不能用它们作真值前提；现有事实已经足以拒绝“本地失败必然意味着未支付”的推断。

**消费示例的完成边界。**以上展示了“问题→适用范围→选用材料→有条件回答→证据缺口”的完整
作者示例。它不需要先补齐所有未知项，也不要求把恢复执行器实现出来。本轮未新建测试或测量
指标，没有宣称独立使用者仅凭本包就一定能够正确完成任务。

本轮只更新阅读入口及其文件摘要，核心 Module 与 Claim 内容保持 `0.1.0-candidate.4`。原有
包校验程序仍可用于复核固定资产；本示例没有升级任何知识状态。

## 从一笔支付理解核心模型

假设调用方请求支付 100 元，以下只是模型说明例子：

1. `PaymentMethod` 告诉 Kill Bill 应使用哪个支付 Plugin。
2. `Payment` 保存这笔支付编排的身份、账户引用和交易历史。
3. 发起 PURCHASE 时，core 先建立一条 `PaymentTransaction`，初始为 UNKNOWN，再调用插件。
4. 插件返回 PROCESSED 后，core 把交易记为 SUCCESS；如果调用超时，交易保持结果未知。
5. 对结果未知的交易，Janitor 用 `getPaymentInfo` 重新查询；恢复查询与再次发起支付是不同动作。

| 对象 | 描述 | 边界 |
| --- | --- | --- |
| Payment | 一次编排的中心记录，组合交易历史、状态和派生金额 | 聚合候选；不是账本余额 |
| PaymentTransaction | 一次授权、扣款、购买、CREDIT、退款或撤销 | 归属于一个 Payment，具有自己的身份 |
| PaymentMethod | 账户与 Plugin 注册名的路由记录 | 独立实体，Plugin 细节保持不透明 |
| RequestedMoney / ProcessedMoney | 请求金额与处理金额，均包含金额和币种 | 原始列可能不完整，不能随意补成金额 |
| ProviderTransactionObservation | Plugin 回报的交易身份、金额、状态、时间和引用 | 报告内容不自动成为 Provider/银行真相 |
| JanitorRecovery | 重新查询已有未决或未知交易的过程 | core 不自动重提支付操作 |

字段定义、可空性、数据角色和聚合边界见 [完整领域模型](docs/killbill-payment-orchestration-semantic-model.md)。

## 支付流程

| 主路径 | 含义 |
| --- | --- |
| AUTHORIZE → CAPTURE → CAPTURE… | 授权成功后可进行一次或多次扣款 |
| AUTHORIZE → VOID | 撤销授权；默认配置不允许 CAPTURE_SUCCESS 后再 VOID |
| PURCHASE → REFUND → REFUND… | 购买成功后的退款路径；CAPTURE_SUCCESS 也可进入 REFUND |
| CREDIT | 独立起始操作，默认 CREDIT_SUCCESS 没有活动后继 |
| PENDING → 显式完成 | 可信调用方提交结果，复用原交易，操作插件不再调用 |
| PENDING / UNKNOWN → Janitor 查询 | 根据后续观测修正已有记录或继续保留不确定性 |

正常路径、失败、事件、时间与执行顺序见 [完整行为模型](docs/killbill-payment-orchestration-behavioral-model.md)。
对已有 Payment，Janitor 查询可能先于 key 或币种检查；“校验失败不发起支付”不等于完全没有查询调用。

## 哪些结论可以使用

12 条 grounded Claim 覆盖默认起始操作、跨操作链接、先建记录再调用插件、结果映射、金额归一化、
PENDING 完成、Janitor 查询、失败后的新交易、key 冲突、币种检查、事件类别和账户锁。

4 条 unknown 保留缺失插件路径的覆盖、重复 PENDING 对外行为、多节点顺序和事件流完整性的疑问。
它们不应作为硬性失败判据。逐条原文及适用范围见 [Claim 清单](docs/killbill-payment-orchestration-claim-ledger.md)。

本模块未覆盖金额上限、原路退款、Provider 支持能力、中国法律规则、清算结算和对账。其真相源
属于其他领域或产品。软件维护者的证据分类只描述精确实现，类型配对检查不认证自然语言 Claim 真伪。

## 具体场景：支付超时后，该查、等还是重试

以“请求购买 100 CNY，已经找到原交易 T，core 状态为 UNKNOWN”为起点。这是静态源码推演，
没有发起支付或执行新的测试。客户端超时本身不足以证明 T 存在、失败或未扣款。

| 已知情况 | 能得出的结论 |
| --- | --- |
| 读取 T，没有请求 Plugin 信息 | 只能看到 core 已记录的结果，不能据此认定 Provider 没有新结果 |
| 查询得到匹配 T 的 PROCESSED | core 可把同一 T 改为 SUCCESS，仍需核对恢复后的金额与币种 |
| 仍是 UNKNOWN 或没有匹配结果 | 保留不确定性；不能当成支付失败再盲目发起一笔新支付 |
| 变成 PENDING | 表示未决；继续查询与调用专门的显式完成入口是不同动作 |
| 使用原 key 再发 PURCHASE | UNKNOWN 会被拒绝，SUCCESS 会触发重复 key 拒绝，PENDING 则可能复用 T 并再次调用操作 Plugin |

这次查到两个必须保留的条件：

1. **同 key、同一条交易，不等于只查询。**普通 PURCHASE 与专门的 PENDING 显式完成入口行为不同，
   后者才通过 override 绕过支付操作 Plugin。
2. **恢复为 SUCCESS，不保证恢复了请求金额。**新的直接操作在 Plugin 缺少金额时可以使用请求值；
   Janitor 的默认值却是已有 processed amount。假设 UNKNOWN 时已记为 0，后来 Plugin 只报告成功，
   没报金额，恢复后可能仍为 0。这是源码推导，尚无运行时观测。

因此，候选模型可以支持“识别原交易、解释 core 状态、选择查询入口”的判断；要决定自动重试或
认定 100 CNY 已付，仍需具体 Plugin 的查询/幂等契约及产品的重试规则。
[完整分支和精确方法位置](docs/killbill-payment-orchestration-behavioral-model.md#e1-purchase-超时后的场景推演静态来源分析)
已补进原行为文档；CL-05 已修正过宽的默认金额描述。四个 unknown 继续保留。

## 具体适配器：Stripe Plugin 的恢复查询与幂等边界

对照 Kill Bill Stripe Plugin **8.0.4** 及其 stripe-java **21.15.0** 依赖后，查清了三件事：

1. **查询方法可能执行写操作。**`getPaymentInfo` 对 PENDING PaymentIntent 可能调用 confirm，
   特定 3DS 失败配置下也可能 cancel；不能把调用这个方法当作纯读取。
2. **搜索不到不等于未扣款。**UNKNOWN/UNDEFINED 分支会搜索 Charge，空结果时将本地记录标为
   CANCELED。Stripe 官方说明 Search 存在传播延迟，因此这个本地标记不足以授权再次扣款。
3. **本地重复保护没有贯通为稳定的 Stripe 幂等键。**插件有同一个 Transaction 的本地 response
   就短路返回；没有记录才创建 PaymentIntent。它未显式把 Kill Bill 的 key/Transaction ID 设成
   Stripe 幂等键，SDK 则为未指定键的 POST 生成随机键。另一次 SDK 请求不保证复用原键。

对应的使用建议是：已知 PaymentIntent ID 时，核对该对象及金额/账号/环境；只有本地失败标记、
Search 空结果或查询异常时，保留业务“结果待查”。只有掌握第一次真实 Stripe 请求的幂等键、相同
参数和适用窗口，且适配器能够复用它们，才能援引 Stripe 的重试契约设计自动重试。

[完整版本、调用路径、来源与决策表](docs/killbill-payment-orchestration-behavioral-model.md#e2-stripe-plugin-804-的具体边界与重试决策)
集中在现有行为文档 E2。此处是精确源码与当前官方说明的对照，未运行支付或复现重复扣款；新增
Stripe 资料采用链接，未纳入下面的六份核心源码快照。不能把它们当作历史 API 的已验证行为。

## 恢复决策契约：结果待查之后如何行动

现在已有一份[恢复决策契约草案](docs/killbill-payment-orchestration-behavioral-model.md#e3-purchase-超时恢复决策契约候选)，
规定必须提交的输入、六种决策、执行前核对及四个可读例子。它是应用侧策略建议，尚未成为执行引擎。

| 掌握的事实 | 下一步 |
| --- | --- |
| 原对象可靠关联且已成功，金额/币种/账号匹配 | 记录原支付成功，结束恢复，不再扣款 |
| 有可靠对象 ID 和明确只读方法 | 核对原对象 |
| 只有 UNKNOWN、Search 空结果、本地 CANCELED 或不完整信息 | 保留结果待查；没有安全补证路径时转人工核对 |
| 原 Provider 幂等键 J、原参数、上下文、适用窗口、预算与并发协调均具备，适配器能复用 J | 可以重发同一 Provider 请求 |
| 身份、金额或观测冲突 | 暂停自动动作，核对冲突 |
| 想换新 key 或新 Payment 再付一次 | 转交独立业务决定，本恢复契约不授权新扣款 |

这里的“重试许可”是有条件、要在执行前重新核对的决策。它不会凭空补齐第一次请求的 J，也不把
may-confirm/may-cancel 的插件调用当作读取。具体等待时限和次数预算仍由适用的产品策略决定。

当前 Stripe Plugin 8.0.4 尚缺贯通的稳定 J 复用与明确只读查询能力，不能只调整重试次数就认为
恢复已安全。下一步落地应围绕这两项能力和原始请求留存展开。

## 机器资产与离线验证

- [module.yaml](module.yaml)：24 个概念、15 条关系、7 份对象结构（58 个字段）、31 个状态、
  51 条转换（42 条操作结果转换 + 9 条跨操作链接）、6 条流程、11 条定义不变量、16 条 Claim。
- [sources/index.yaml](sources/index.yaml)：6 个精确版本来源包，包含 42 个上游原始文件及许可证；
  每份快照都有 SHA-256，每个上游文件附 Git blob 身份和字节数。
- [release.lock.json](release.lock.json)：候选包全部文件、模型摘要和编译内容的固定身份。
- [landscape.yaml](landscape.yaml)：现有内部编译器所需的单模块加载入口，没有跨模块 Mapping。

在仓库根目录运行（依赖已安装后无需网络）：

```sh
node --import tsx scripts/verify-killbill-module.mjs
```

也可把本目录原样复制到别处，再把目录作为参数传入相同命令。验证器检查所有文件摘要、模型与
来源引用、上游文件身份和两次编译的一致性，输出 `verified-candidate`。`--print-lock` 仅输出拟议
锁定内容供审阅，不会覆盖现有锁文件。

结构化字段/状态/流程以及完整的人读文档都会进入内部编译结果。字段 type 表达式与流程描述是
数据定义，不是新的支付运行时、类型检查语言或可执行工作流。内部 Domain-First 接口尚未作为
公开 npm API 发布。

## 适用性与剩余缺口

本包首次固定了可重放的来源快照；之前 R1 runtime preflight 没有保留原始观测，不能用于本包
运行时验证。源码阅读和内部契约测试都不能替代真实 Provider 的行为验证。

Claim 的 valid_time 下界沿用 core commit 时间作为版本查询约定；实际使用必须同时匹配精确
版本，不能解释成某个商户部署时间。新的快照与 Claim 修订另记 recorded_at。

进一步使用前应审阅 Claim 的限定条件和 4 条 unknown；需要金融结论或自动评分时，再选择具体
场景和对应的 Provider/Observation Contract。候选包本身尚未发布，也没有完成外部支付资格验证。

迁移说明：原 `project-research/2026-09-01-public-domain-landscape/` 的五份 Kill Bill 文档现位于
本包 `docs/`；四份通用调研材料位于仓库 `docs/research/2026-09-01-public-domain-landscape/`。
旧提交仍能用于历史追溯。

## 来源与许可证

`sources/*.json` 保存所列上游文件的 UTF-8 原文；JSON 容器是本项目新增的包装，未改写原文件。
各包包含原仓库 LICENSE，源文件版权和 Apache-2.0 声明原样保留。Git blob 校验对照了上游固定
revision 的 tree；离线校验检测相对于本次固定记录的漂移，不执行新的上游身份认证。
核心快照仍属于一个 Kill Bill 维护者生态；E2 另行对照 Stripe SDK 与 Provider 官方说明，各自的
权威范围保持独立，不构成多个支付实现对全部命题的共识。
