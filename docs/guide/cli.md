# lpcli 命令参考

`lpcli` 是 LogicPilot 的命令行入口，负责**编译**、**运行**与**服务**三类操作。

```text
usage: lpcli <command> [options]
commands:
  compile  compile a .lp DSL source to FlatBuffers IR
  run      run replications of a model (lpcli run --help)
  serve    compile a model and serve it over WebSocket
  help     show this message
```

## compile

```text
usage: lpcli compile <input.lp> [-o <output>]
                        [--project <path.lpproj>]
                        [--diagnostics-json <path>]
                        [--experiments-json <path>]
```

- `-o, --output <path>`：输出 IR 文件（默认 `<input>.ir.bin`）
- `--project <path.lpproj>`：编译工程包内打包的 DSL（`*.lpproj`，格式见
  [工程格式 v2](../specs/project-format-v2)），默认输出 `<工程名>.lpir`
- `--diagnostics-json <path>`：写结构化诊断 JSON（AI Copilot 的修复输入，含 span/行号/错误码）
- `--experiments-json <path>`：导出模型声明的 `experiment` 块（优化搜索规格）

示例：

```powershell
lpcli compile examples/two_servers.lp -o build/two_servers.ir.bin
# 对任意含编译错误的模型导出结构化诊断（编译失败也会写出 diag.json）
lpcli compile <含错误的模型>.lp --diagnostics-json diag.json
```

工程包（`.lpproj`，由 Web IDE / 桌面端保存）同样可以直接编译：
`lpcli compile --project demo.lpproj`。

## run

```text
usage: lpcli run [options]
  --model-file <path.lpir>   load model from FlatBuffers IR (or --project)
  --project <path.lpproj>    compile the bundled DSL and run it
  --output-ir <path>         write the compiled IR (with --project)
  --results-dir <path>       write run.json + metrics.json here
                             (default <project stem>.results/)
  --seed <n>                 run seed (default 42)
  --reps <n>                 replications (default 30)
  --threads <n>              parallel replication workers (default 1)
  --arrivals <n>             arrivals per replication (default 20000)
  --warmup <n>               warmup arrivals excluded from stats
  --confidence <x>           CI confidence level (default 0.95)
  --trajectory <path>        write continuous-model trajectory JSON
  --logical-trace <path>     write one-rep LPLT logical-step archive
```

- `--project <path.lpproj>`：直接运行 `*.lpproj` 工程包（读取 `model/main.lp`
  编译为 IR v2 后执行）；与 `--model` / `--model-file` 互斥
- `--results-dir <path>`：把运行配置（`run.json`）与汇总指标（`metrics.json`）
  落盘到该目录；使用 `--project` 时默认写到 `<工程名>.results/`
- `--threads <n>`：用 N 个工作线程并行跑 replications（每个线程持有独立的
  模型实例，逐位结果与串行一致，ADR-0009 阶段 A）；`--trajectory` 请求时
  回退顺序执行
- `--trajectory`：连续模型（`continuous` 块）输出采样轨迹 JSON，供 AI 面板/脚本绘制 ODE 曲线
- `--logical-trace`：单 replication 的 Agent/Continuous accepted-step 证据写成
  LPLT 归档；该选项要求 `--reps 1`，并自动回退到单线程执行。
- 同一种子 + 相同参数 → 逐位相同结果（见 [确定性复现](./determinism)）

## trace-compare

```text
lpcli trace-compare expected.lplt actual.lplt
```

相同归档返回 `identical`；不同归档返回非零退出码，并报告首个
logical-step 的时间、类型或 payload 差异，适合 CI replay 门禁。

## serve

```text
usage: lpcli serve <input.lp> [options]
  --model-file <path>   serve prebuilt IR instead of compiling
  --port <n>            listen port (default 8089)
  --seed <n>            default run seed (default 42)
  --reps <n>            default replications per run (default 1)
  --arrivals <n>        arrivals per replication (default 4000)
  --warmup <n>          warmup arrivals (default 400)
  --speed <x>           wall-clock pacing multiplier (default 1.0)
  --trace               mirror every binary frame as JSON
```

监听 `ws://127.0.0.1:<port>/sim`，向所有客户端广播 wire 帧（`LPWR`）；控制消息为 JSON 文本帧。`lpcli serve` 目前只接受单一方法模型；混合模型请使用 `lpcli run`，由 `SimulationKernel` 统一驱动。若模型包含 Queue、Delay、路由或其他非线性流程块，网关会自动放弃 M/M/c 快速路径，改走完整 Process 引擎。

## 退出码约定

- `0`：成功
- `2`：用法/参数错误
- 非零：编译失败或运行错误（配合 `--diagnostics-json` 可获得机器可读原因）
