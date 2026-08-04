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
                        [--ir-version 1|2]
                        [--diagnostics-json <path>]
                        [--experiments-json <path>]
```

- `-o, --output <path>`：输出 IR 文件（默认 `<input>.ir.bin`）
- `--ir-version <n>`：发射契约版本。默认 **2**（`LP2R`，Node/SemanticsRef）；`1` 走冻结的 v1 契约（`LPIR`）
- `--diagnostics-json <path>`：写结构化诊断 JSON（AI Copilot 的修复输入，含 span/行号/错误码）
- `--experiments-json <path>`：导出模型声明的 `experiment` 块（优化搜索规格）

示例：

```powershell
lpcli compile examples/two_servers.lp -o build/two_servers.ir.bin
lpcli compile examples/bad.lp --diagnostics-json diag.json
```

## run

```text
usage: lpcli run [options]
  --model <built-in:NAME>    built-in model (default built-in:mm1)
  --model-file <path.lpir>   load model from FlatBuffers IR instead
  --seed <n>                 run seed (default 42)
  --reps <n>                 replications (default 30)
  --arrivals <n>             arrivals per replication (default 20000)
  --warmup <n>               warmup arrivals excluded from stats
  --lambda <x>               arrival rate for built-in:mm1 (default 0.8)
  --mu <x>                   service rate for built-in:mm1 (default 1.0)
  --confidence <x>           CI confidence level (default 0.95)
  --trajectory <path>        write continuous-model trajectory JSON
```

- `--trajectory`：连续模型（`continuous` 块）输出采样轨迹 JSON，供 AI 面板/脚本绘制 ODE 曲线
- 同一种子 + 相同参数 → 逐位相同结果（见 [确定性复现](./06-determinism)）

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

监听 `ws://127.0.0.1:<port>/sim`，向所有客户端广播 wire 帧（`LPWR`）；控制消息为 JSON 文本帧。

## 退出码约定

- `0`：成功
- `2`：用法/参数错误
- 非零：编译失败或运行错误（配合 `--diagnostics-json` 可获得机器可读原因）
