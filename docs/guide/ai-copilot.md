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

IDE 通过 `/api/assistant` 请求下一步计划，工具仍在本地、受控地执行。当前工具包括：

- 检查模型、选中对象、编译诊断和最近运行指标；
- 以 `ModelPatch v1` 原子修改模型；
- 编译当前 DSL、运行当前模型并读取结构化指标；
- 安全撤销最近一笔 AI 修改。

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

IDE 右侧 **AI** 面板是连续对话入口，自动选择建模、运行、优化或解释路径；高级
快速操作仍保留在输入区的折叠菜单中。轨迹曲线、参数搜索和指标比较继续使用相同
的结构化运行结果。桌面客户端会通过 `/api/config` 自动解析本地服务地址。

闭环协议细节见 [AI 建模闭环](/specs/ai-loop)。
