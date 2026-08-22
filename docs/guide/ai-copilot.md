# AI Copilot

AI Copilot 把“描述目标 → 检查当前模型 → 应用结构化修改 → 编译/仿真 → 基于指标回答”
串成闭环。IDE 使用工具型对话助手；命令行脚本仍提供确定、可回归的单项入口。

## 建模闭环：ai-build

```powershell
node scripts/ai-build.mjs "2 machines with failure rate 0.05, arrival 1.5, service 2.0" --run
```

规则 provider 除基础 M/M/1 外，会按提示词关键词生成 **DES 语义模板**：
`priority`（优先级队列 + 实体属性）、`measure`（timeMeasure 测量）、
`seize`（资源抢占/归还）、`batch`（临时批 + 还原）、`assembly`（assembler
装配线）、`timeout`（队列超时出口）；生成的 DSL 全部经编译器校验
（组合边界有回归测试，`ai_build_smoke` ctest 覆盖）。

流程：

```text
NL prompt → provider 生成 DSL
         → lpcli compile --diagnostics-json（结构化诊断）
         → 有错则把诊断 + 上次 DSL 回喂 provider 重试（默认最多 3 次）
         → 编译通过 →（可选）lpcli run 出统计摘要
```

常用选项：`--out <path>`（保存 DSL）、`--max-iterations <n>`（修复预算）、`--json`（机器可读报告）、`--test-sabotage-first`（CI 回归：故意破坏首轮生成以验证修复路径）。

## 自动优化：ai-optimize

```powershell
node scripts/ai-optimize.mjs "minimize Wq over servers 1..5 for an M/M/1 queue with arrival 0.8 service 1.0"
```

规则 provider 先构造参数化模板（`capacity = {{servers}}`），再把 `experiment` 块写入模型声明搜索规格；`lpcli compile --experiments-json` 读回后，用 grid/GA 策略在预算内评估，返回最优值与全部评估点。

## 瓶颈归因：ai-explain

```powershell
node scripts/ai-explain.mjs "build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0"
```

运行固定种子模型并读取 `metrics.json`，**基于逐块证据**给出归因：利用
率最高的块（饱和时明确建议扩容）、最大平均队列占用的排队块、宕机主导
（可用性 < 97%）、等待占比（Wq/W > 60%）。无逐块遥测时回退到池级
汇总。
拓扑路径会标记为 `topology + measured metrics` 观测证据；单次运行不会被宣称为
干预因果证明。

## 局部修改：ai-patch（ModelPatch v1）

```powershell
node scripts/ai-model-patch.mjs "add queue Buffer between Patients and Waiting"
node scripts/ai-model-patch.mjs "replace queue Waiting with delay"
```

结构性意图直接产出最小操作序列（原子应用、可预览、可撤销）：
`add/remove/update/connect/disconnect/rename`，以及**插入**（在两块之间
或某块之前/之后拼入新块，保留连线）与**类型替换**（换块类型并保留
进出拓扑）。目标按稳定 id 或唯一名称解析；名称歧义会返回显式诊断而非
猜测。

## 参数变化：parameter-variation

声明式 `experiment`（范围轴）默认做笛卡尔网格；可切换
`sampling: "monte_carlo"`（种子化确定性采样，值按步长就近对齐）或传入
`axes` 自由值列表（`values: [...]` 取代 range/step）。所有点共享固定种子
（公共随机数），固定/精度复制策略与置信区间一致。

网格与 Monte Carlo 共用同一套轴校验（`scripts/parameter-variation.mjs`）：
`values` 必须是非空有限数字列表；`variable` 必须是有效标识符；range 模式
要求有限 `min <= max`；`step` 若存在必须为正有限数。采样种子必须是
`[0, 4294967295]` 内的整数（采样状态是 32 位 mulberry32 生成器，更大的
种子会被静默截断而碰撞）。参数校验失败时 HTTP API 返回带明确消息的 4xx，
不会把内部 TypeError 暴露成 500。

## Provider 切换

桌面端和 Web IDE 可在 **Settings → AI provider** 中配置。配置采用“Provider 预设 + 协议适配器”两层结构：预设覆盖 OpenAI、Anthropic、Google Gemini、OpenRouter、xAI、Mistral、Groq、Cerebras、Together、Fireworks 等海外服务，以及 DeepSeek、Kimi、Qwen、GLM、SiliconFlow、MiniMax、豆包（火山方舟）、百度千帆 ERNIE、腾讯混元、讯飞星火、阶跃星辰、百川、零一万物等国内服务，本地还有 Ollama、LM Studio、vLLM 和自定义端点；模型 ID 与 Base URL 始终允许手工修改。

当前协议包括 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Gemini `generateContent` 和 Codex `app-server`。OpenAI-compatible 网关若不支持 JSON mode，会自动移除 `response_format` 重试一次。设置页输入的 API Key 只保存在本地 Node 后端进程内，不写入浏览器、工程文件或 Git；关闭后端即清除。Codex 模式复用现有登录，不读取或复制 Codex 凭据文件。

自动化部署仍可使用环境变量；新变量优先，旧的 OpenAI-compatible 变量继续兼容：

```powershell
$env:LOGICPILOT_AI_PROVIDER="custom"
$env:LOGICPILOT_AI_PROTOCOL="openai-chat" # 也可为 openai-responses / anthropic-messages / google-gemini
$env:LOGICPILOT_AI_API_KEY="..."
$env:LOGICPILOT_AI_BASE_URL="https://.../v1"
$env:LOGICPILOT_AI_MODEL="..."
```

本地 Ollama 不需要 API Key：

```powershell
$env:LOGICPILOT_AI_PROVIDER="ollama"
$env:LOGICPILOT_AI_BASE_URL="http://127.0.0.1:11434/v1"
$env:LOGICPILOT_AI_MODEL="qwen2.5-coder:latest"
```

兼容变量：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`。Codex 仍可设置 `LOGICPILOT_AI_PROVIDER=codex`。

```powershell
$env:OPENAI_API_KEY="sk-..."          # 启用 LLM provider
$env:OPENAI_BASE_URL="https://..."    # 可选，兼容端点
$env:OPENAI_MODEL="gpt-..."           # 可选，模型名
```

命令行的规则与 LLM provider 共用同一个“生成 → 诊断 → 修复 → 运行”闭环。

也可以复用 Codex CLI 已有的 ChatGPT 登录，不需要给 LogicPilot 配置 OpenAI API Key：

```powershell
codex login status
$env:LOGICPILOT_AI_PROVIDER="codex"
$env:LOGICPILOT_CODEX_MODEL="..." # 可选；不设置则使用 Codex CLI 默认模型
pnpm dev
```

LogicPilot 通过官方 `codex app-server` 的本地 stdio/JSONL 协议复用一个 CLI 进程；
每个助手推理步骤使用独立的只读线程和结构化输出约束，步骤结束后删除该临时线程。
认证完全交给 Codex 管理，不读取或复制 `~/.codex/auth.json`。API Key 和 Codex
两种模式显式隔离：
默认 `auto` 在存在 `OPENAI_API_KEY` 时走 API；要使用 ChatGPT 订阅登录，需设置
`LOGICPILOT_AI_PROVIDER=codex`。可用 `LOGICPILOT_CODEX_PATH` 指定 CLI/`codex.js`，
`LOGICPILOT_CODEX_TIMEOUT_MS` 调整单步超时。

持久进程消除了同一轮多步工具调用的重复 CLI 冷启动；LogicPilot 仍自行保存 IDE
对话和执行工具，Codex 线程之间不会共享隐藏上下文。若需要诊断 app-server 兼容性，
可以临时设置 `LOGICPILOT_CODEX_TRANSPORT=exec` 回退到逐步 `codex exec`；允许值仅为
`app-server`（默认）或 `exec`。

## IDE 工具型助手

### 工作区边界

LogicPilot 使用 VS Code 式工作区语义：工作区是一个或多个文件夹，
`logicpilot.json` / `.lpproj` 只是工作区中的模型项目文件，不是 AI 写入权限的唯一依据。

- 没有工作区：画布是临时 scratch，AI 只能回答和检查，不能修改模型。
- 已打开普通文件夹：这是可写工作区，即使还没有 `logicpilot.json`，AI 也可以创建模型；首次保存会初始化项目文件。
- 已打开 LogicPilot 项目：AI 修改当前模型，修改进入 dirty 状态，用户保存后才写入磁盘。

File 菜单提供 `Open Folder...`、`Open Workspace from File...`、`Save Workspace As...`
和 `Close Workspace`。工作区文件使用 `.lpworkspace` 扩展名，保存的是工作区根目录，
不包含 API Key、模型内容或运行结果。

### 源代码编辑能力

默认情况下 Agent 只使用结构化 ModelPatch。需要修改 DSL、presentation 或 experiment
源文件时，可在 `Configure` 中显式开启 **Source editing**。该能力仅允许 Workspace
下的 `model/`、`presentation/` 和 `experiments/` 源文件，并要求 checksum + oldText
精确匹配后再审批；IR、build、results 和 Workspace 外部文件不会被修改。源文件变更会
重新同步模型并进入 dirty 状态，编译失败或取消时由事务层回滚。

### 通用 Agent 与能力挂载

AI 输入框采用 Agent 工作台布局：`+` 用于插入上下文，Agent/Ask/Plan 用于切换
对话模式，权限可选 Full access、Workspace、Read only，模型和工具配置集中在输入框右侧，
麦克风按钮用于浏览器语音输入。输入 `/` 可选择 `/build`、`/optimize`、`/sweep`、
`/explain`、`/clear`；输入 `@` 可附加 `@model`、`@selection`、`@diagnostics` 或 `@run`。

IDE 的 Agent 不是建模专用循环。通用 Agent 只负责 session、turn/step、LLM 请求、工具调度、
取消、重试、事件和检查点；专业能力由宿主按 Profile 挂载：

```text
General Agent Core
        ↓ capability registry
logicpilot-modeling / filesystem / web / MCP / future skills
        ↓ host context
canvas / selection / diagnostics / run metrics
```

当前实现提供 `general` 与 `logicpilot-modeling` 两个 Profile，以及
`AgentCapabilityRegistry`、`AgentSkillRegistry` 和 `AgentMcpRegistry` 契约。
IDE 工作区显式挂载 `logicpilot-modeling`，所以模型检查、ModelPatch、编译和仿真都是能力包提供的
工具，而不是 Agent 内核的分支。没有挂载能力时，General Agent 可以直接回答普通对话，不会被迫调用
模型检查工具。

没有配置 Provider 时，Agent 模式的模型构建请求会回退到本地确定性 rule-based 快速路径；
连续多步助手、Ask/Plan 模式和真实 LLM 工具调用仍需要在 Settings 中配置 Provider。

工具调用结果按通用事件协议记录；同一状态下的完全重复调用会被 Runtime 抑制，避免本地模型在只读
检查上活锁。后续 Skill 将以可渐进加载的说明、脚本和资源提供工作流，MCP 则把外部 Prompts、Resources
和 Tools 统一适配到 capability registry。

内置和项目 Skill 使用 `SKILL.md`：服务端按请求的 Skill id 加载，单个文件限制 128 KiB，最多发现
64 个 Skill；项目目录支持 `.agents/skills`、`.github/skills`、`.claude/skills`，用户目录使用同名
Skill 根目录。Skill 只贡献说明和工作流，不直接执行工具，工具仍必须经过 Agent Tool Runtime。

MCP Host 当前支持本地 stdio JSON-RPC 服务器。通过 `LOGICPILOT_MCP_SERVERS` 配置 JSON 数组：

```powershell
$env:LOGICPILOT_MCP_SERVERS='[{"id":"my-tools","transport":"stdio","command":"npx","args":["-y","my-mcp-server"]}]'
```

服务端启动后会执行 initialize 协商，并发现 `tools/list`、`resources/list` 和 `prompts/list`；工具以
`mcp.<server>.<tool>` 命名空间挂载，非只读工具需要 IDE 的通用审批。MCP 进程不由模型启动，且由本地
Host 统一负责超时、退出和 JSON-RPC 错误处理。

IDE 通过 `/api/assistant` 请求下一步计划，工具仍在本地、受控地执行。当前工具包括：

- 检查模型、选中对象、编译诊断和最近运行指标；
- 以 `ModelPatch v1` 原子修改模型；
- 编译当前 DSL、运行当前模型并读取结构化指标；
- 安全撤销最近一笔 AI 修改。

模型修改不会直接落到画布：助手提出 `apply_model_patch` 后，面板会暂停并展示操作数、
具体变更及破坏性操作提示。只有用户选择 **Apply and continue** 才会原子应用、继续编译
和仿真；选择 **Keep current model** 会保留当前画布，并结束该轮修改尝试。已完成的工具
轨迹默认折叠，仍可展开检查；本轮产生的模型事务可用 **Undo** 一次性撤销。

服务端会验证模型返回的工具名、调用 id 和各工具参数；未知字段、缺失必填参数或
非法补丁会在执行前拒绝。API Key 只存在于 Node 服务进程中。客户端发送当前模型
上下文和有限的最近对话，不会把密钥保存到浏览器或工程文件。

取消信号贯穿助手请求、编译与运行。若取消发生在补丁已经应用之后，运行时会先
校验模型版本并自动回滚该轮事务；用户后续编辑不会被跨版本撤销。

### 真实模型基准

助手协议单测只能证明工具链可执行，不能证明当前配置的 LLM 会稳定地产生正确调用。
配置 provider 后可运行首个产品基准：

```powershell
$env:OPENAI_API_KEY="..."
$env:OPENAI_BASE_URL="https://.../v1" # 非 OpenAI provider 时设置
$env:OPENAI_MODEL="..."
pnpm benchmark:assistant -- --trials 3
```

每轮从空白画布开始，要求模型用一次原子补丁建立参数正确、拓扑完整的 M/M/1，
调用仿真，并在最终回答中引用工具返回的 `Wq=4.0` 和利用率 `0.8`。报告分别评分
完整补丁、参数、拓扑、运行调用、指标落地和解释一致性；任一轮失败都会返回非零退出码。未配置
`OPENAI_API_KEY` 时命令明确输出 `SKIP`，不会用规则回复冒充真实模型成绩。
该基准使用固定工具结果隔离 LLM 编排能力；编译器和仿真内核正确性仍由独立的
端点与原生测试负责，避免随机仿真噪声污染模型评分。

## Web / 桌面面板

### Assistant Kernel

助手运行时采用 `web/apps/ide/src/ai/assistantKernel.ts` 的轻量事件内核。一次用户请求是一个
`turn`，每次模型请求和工具处理是一个 `step`。内核按顺序记录 `turn/start`、`step/start`、
`assistant/message`、`tool/call`、`tool/result`、`step/end` 和 `turn/end`，下一次请求的消息由
事件投影生成，不再由循环临时拼接数组。

工具调用和结果必须按调用 id 配对；取消或审批拒绝导致未执行的调用会记录标准化的失败结果，
因此后续步骤和重放不会出现悬空 tool call。客户端对 408、425、429、500、502、503、504
以及传输错误进行有限、可取消的重试，模型输出格式错误不会重试或伪造结果。

只读检查工具可以在同一个 step 内有界并行执行，结果仍按模型声明顺序写回 transcript；模型
修改、编译、仿真和撤销保持串行屏障。历史超过请求预算时，内核生成确定性的 context checkpoint，
保留最近消息和完整的工具调用/结果对，不会通过简单截断制造悬空调用。

该内核借鉴 deepseek-harness 的 turn/step、事件投影、工具结果配对和请求恢复原则，但不引入
Cordis 依赖；LogicPilot 的 ModelPatch 审批、编辑器状态和仿真工具仍由本地 IDE 工具层负责。

当前回合的 Kernel 事件会随项目范围的 AI 对话记录保存；重新打开同一项目时，优先从事件日志
重新投影模型历史，旧版本只保存普通文本的对话仍保留兼容回退。

支持流式响应的 OpenAI-compatible Provider（包括 Ollama）通过 `/api/assistant/stream` 转发
SSE 文本和 reasoning delta，面板会实时显示模型文本；Anthropic、Gemini、Responses 或不支持
SSE 的自定义网关自动回退到完整响应。最终的结构化 assistant response 仍必须通过同一套 schema
校验，流式过程不会绕过工具审批或 ModelPatch 验证。

支持原生工具调用的 Provider 会直接提交工具 schema，并把 Chat/Responses、Anthropic、Gemini
和 Ollama 的函数调用归一化为同一套 `AssistantToolCall`；不支持原生工具的自定义端点继续使用
严格 JSON 回退。ModelPatch、AI build 和助手运行时共用 Provider 注册表，不再分别读取旧的
`OPENAI_*` 配置。

对 OpenAI-compatible native tool 路由，后续 step 会将 assistant tool call 和 tool result
转换为原生 `assistant.tool_calls` / `tool` 消息；旧兼容网关仍使用文本投影。这样多步模型编辑
不会把工具结果误当成普通用户文本。

主助手还可直接调用 `run_parameter_study`、`optimize_model`、`explain_results` 和
`compare_runs`。优化会携带当前模型 DSL，结果解释和运行对比只引用真实工具返回的指标，
不会把示例数字当成仿真证据。

IDE 右侧 **AI** 面板是连续对话入口，自动选择建模、运行、优化或解释路径；高级
快速操作仍保留在输入区的折叠菜单中。轨迹曲线、参数搜索和指标比较继续使用相同
的结构化运行结果。桌面客户端会通过 `/api/config` 自动解析本地服务地址。

闭环协议细节见 [AI 建模闭环](/specs/ai-loop)。
