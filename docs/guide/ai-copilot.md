# AI Copilot

AI Copilot 把"人描述问题 → AI 生成模型 → 自动仿真 → 自动优化 → 给出决策"串成闭环。默认使用**离线规则 provider**（确定性、可回归），设置 `OPENAI_API_KEY` 后可切换 LLM provider。

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

## Provider 切换

```powershell
$env:OPENAI_API_KEY="sk-..."          # 启用 LLM provider
$env:OPENAI_BASE_URL="https://..."    # 可选，兼容端点
$env:OPENAI_MODEL="gpt-..."           # 可选，模型名
```

两条路径共用同一个"生成 → 诊断 → 修复 → 运行"闭环，LLM 只替换"下一步 DSL"的生成者。

## Web 面板

IDE 右侧 **AI model** 面板即上述三个脚本的可视化入口（build / optimize / explain），支持轨迹曲线与优化曲线渲染。浏览器端到端验证覆盖全部四个场景。

闭环协议细节见 [AI 建模闭环](/specs/ai-loop)。
