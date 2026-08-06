# AI Copilot

AI Copilot 把"人描述问题 → AI 生成模型 → 自动仿真 → 自动优化 → 给出决策"串成闭环。默认使用**离线规则 provider**（确定性、可回归），设置 `OPENAI_API_KEY` 后可切换 LLM provider。

## 建模闭环：ai-build

```powershell
node scripts/ai-build.mjs "2 machines with failure rate 0.05, arrival 1.5, service 2.0" --run
```

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

运行固定种子模型，基于池级指标给出归因：宕机主导（可用性 < 97%）、容量饱和（利用率 > 90%）、排队环节（Wq/W > 60%），并输出吞吐/等待/利用率/可用性汇总。

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
