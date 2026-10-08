---
feature_ids: []
topics: [coding, consumer, delivery, integrity]
doc_kind: consumer-delivery-receipt
created: 2026-09-09
status: supplied-after-first-consumer-trial-not-retested
qualification: not_qualified
---

# Janitor 本地消费包交付回执

这份回执应由交付方通过消费者已确认的交付渠道，**与包分开发送**。它是项目交付声明，
不是数字签名或独立来源认证；若不信任发送者，仅有摘要一致并不能建立信任。

| 项目 | 交付方声明 |
| --- | --- |
| 交付单元 | Janitor local consumer kit，导出实现版本 949dcd1 |
| 原包位置 | `/Users/slipshod/AIBuild/dsh-eval-lab-runtime/janitor-consumer-kit.kS2fXp` |
| 校验对象 | **kit.json 原始字节的 SHA-256**，不是目录整体或任务 canonical digest |
| 预期 kit digest | `f653cf46a8637c5dccae897802532486546b88e90353590edf88b216239fc9f6` |
| 预期 task digest | `6b5115da3541484581ff2a9b9fe5d38b569072684532447aebc7e41664645db8` |
| 负载 | 66 个固定文件，15,760,029 字节，另有 kit.json 与 kit.sha256 |
| 支持边界 | 同宿主、Node 24、固定 macOS/JDK 指纹；非跨机发行版 |
| 用途 | 本地组件任务消费；不包含模型执行或新增权限授权 |
| 排除 | 登录凭据、原生会话、参考修复源码、此前 Agent 答案、生产数据 |

收到后，先确认发送者与渠道，再用可信校验工具计算 kit.json 的摘要，与本回执预期值比较。
相符后才按包内 README 启动 doctor；其 kit_digest 与 task_digest 也应分别匹配上表。
缺少回执、摘要不符或环境不支持时，停止并向交付方核实，不从包自身返回值猜测外部预期值。

整个包是评测控制端资产，只有 prepare 返回的公开 workspace 可以交给被测编码 Agent。
独立上下文消费者可在获准的固定命令适配器下操作，但不能因此获得任意宿主执行、外部文件
或网络权限。此回执不授权新模型会话，也不批准公开发布或再分发。

本回执在首次消费者反馈后补充；原包、原会话和原判定未改变。它尚未经过新的消费者核对，
不得据此把上一轮来源核验标为完成。整体继续保留 `not_qualified`。
