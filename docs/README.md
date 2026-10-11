# 文档入口与维护规则

面向用户的使用说明从 [快速开始](guide/quickstart.md) 阅读。
接手开发前先看 [当前架构与能力边界](architecture/current-state.md) 和
[开发交接提示词](maintenance/handoff-next-ai.md)。

2026-09-21 新增的 DSH 人机共创建模路线，从
[实施总计划](architecture/dsh-modeling-cocreation-plan.md)、
[逐任务执行单](maintenance/dsh-coCreation-tasks.md) 和
[接手提示词](maintenance/dsh-coCreation-handoff.md) 阅读。
这是一份待实施计划：复用 DSH 宿主，以仓储搬运为首个场景，目标是从自然语言需求到模型、共创与实验的通用闭环。
执行该路线时，以新计划明确规定的 DSH 宿主接入方式为准；原执行会话计划中的模型版本、取消和证据语义继续适用。

下一项执行链路改造按 [统一执行会话与 Gateway 收口实施计划](architecture/execution-session-gateway-plan.md)
推进。该文档是待实施任务书，包含 G0～G9 的修改顺序、契约边界和验收标准，不代表已经完成。

| 文档层级                                          | 作用                           | 更新时机                         |
| ------------------------------------------------- | ------------------------------ | -------------------------------- |
| `guide/`                                          | 用户实际可以使用的操作         | 行为变化时同步                   |
| `architecture/current-state.md`                   | 当前实现、边界与缺口的权威入口 | 通过验收的切片完成后             |
| `architecture/next-generation-plugin-platform.md` | 目标架构与迁移计划             | 决策改变时；计划条目不等于已实现 |
| `specs/`                                          | 格式、协议、语义规范           | 契约变化时                       |
| `adr/`                                            | 当时做出的决策及理由           | 新决策新增记录，旧记录注明后继   |
| `maintenance/`                                    | 日期化验收、交接、维护报告     | 每次整理或交接                   |

执行证据优先级：当前源码与可复现测试 > 当前状态页 > 历史计划/ADR > 会话中的进度描述。
历史 ADR 保留原始语境，不能单凭 `Accepted` 推断功能已完整交付。

## 语言与格式约定

- **语言分层**：机器与 AI 读取的载荷（`AGENTS.md`、JSON Schema、机器消费的配置键、注入给
  agent 的 prompt）用**英文**；面向人的说明、路线与运维文档用**中文**。
- **英文文档（现状；新增同类照此）**：`adr/` 全部、`specs/dsl-spec.md`、
  `specs/ai-model-patch.md`、`specs/workspace.md`、`specs/des-anylogic-compatibility.md`、
  `performance-budget.md`、`maintenance/execution-session-progress.md` —— 它们是逐字段校验
  或对外引用的**规范正文**，与上游实现同一语言。ADR 记录当时的决策、备选与理由，同上。
- **中文文档（现状）**：其余全部 —— `guide/`、`architecture/`、`specs/` 多数、`maintenance/`
  多数、`docs/README.md`、根 `README.md`、`CONTRIBUTING.md`、`HANDOVER.md`。
  **不因本约定批量翻译既有文档**（历史记录保持原语境）。
- **状态头随文档语言**：英文文档写 `Status: <值>`（ADR 惯例，如 `Status: Accepted`）；
  中文文档写 `状态：<值>（<日期>）`，需要时可加 `；维护者：…`。
- **标点**：中文正文一律用**全角**标点（`，。；：（）「」`）；并列用 `、`，分句用 `；`。
  **不用 `·`（中点）当分隔符** —— 它是明显的机器排版痕迹。
- **日期**：`YYYY-MM-DD`。**标题**：层级不跳级。**表格**：必须有表头分隔行。

命令入口在根 `package.json`；JSON Schema 的源在 `schemas/contracts/`。
生成文件只用 `node scripts/gen-contracts.mjs` 更新，不手改 TS/C++ 生成物。
变更冻结 baseline 必须说明具体破坏性变化，不能为了让检查变绿而整目录覆盖。
