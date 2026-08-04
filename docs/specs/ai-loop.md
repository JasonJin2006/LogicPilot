# AI Model Build Loop (Simulation Copilot 第一刀)

状态: Implemented（2026-08-04）。NL → DSL → 编译 → 结构化诊断 → 修复 → 运行
的闭环已落地并接入 CI（`ai_build_smoke`）。

## 入口

```powershell
node scripts/ai-build.mjs "2 machines with failure rate 0.05, arrival 1.5, service 2.0" --run
```

选项：`--out <path>`（保存最终 DSL）、`--max-iterations <n>`（修复预算，默认 3）、
`--lpcli <path>`、`--reps/--arrivals/--warmup`、`--json`（机器可读报告）、
`--test-sabotage-first`（CI 回归钩子：故意破坏第一次生成以验证修复路径）。

## 闭环语义

1. `provider(prompt, diagnostics, previousDsl)` 生成 DSL（见 `scripts/ai-provider.mjs`）。
2. `lpcli compile --diagnostics-json` 产生结构化诊断（`docs/specs/dsl-spec.md` §6）。
3. 有诊断 → 连同上次 DSL 喂回 provider 重试，直到编译通过或超出预算。
4. 编译通过 →（可选）`lpcli run --model-file` 出统计摘要。

## Provider 可插拔

- 默认（无 key）：`ruleBasedProvider` —— 关键词/数值抽取 + 诊断驱动的修复，
  离线、确定性，CI 与回归测试依赖它。
- 设置 `OPENAI_API_KEY` 后：`llmProvider`（OpenAI 兼容 `/chat/completions`，
  `OPENAI_BASE_URL` / `OPENAI_MODEL` 可覆盖），把 prompt + 上次 DSL + 诊断 JSON
  一并发给模型。两条路径共用同一个闭环。

## 验证

`scripts/test-ai-build.mjs`（CI：`ai_build_smoke` ctest）覆盖：干净 prompt 端到端、
蓄意破坏后 2 次迭代修复收敛、关键词抽取、诊断修复保持良构。

## 连续模型与轨迹

rule-based provider 识别 ODE prompt（decay / SIR）并生成 `continuous` 模型；
`lpcli run --trajectory <path>` 输出采样轨迹 JSON（变量 + 每步值）。AI 面板在
生成结果中渲染轨迹曲线（浏览器 E2E 覆盖）。
