# 快速开始

LogicPilot 是一个 AI 原生、Web 化的多方法仿真平台。一条典型的体验路径：
**写 DSL → 编译成 IR → C++ 内核运行 → 浏览器实时可视化 → AI 自动建模/优化**。

## 环境要求

- **C++ 工具链**：CMake ≥ 3.25、Ninja、MSVC（Windows）/ clang（Linux）
- **vcpkg**：`vcpkg.json` 声明依赖（fmt、spdlog、flatbuffers、boost-beast、entt、catch2、benchmark），由 `CMakePresets.json` 的 `VCPKG_ROOT` 自动接入
- **Node.js ≥ 20 + pnpm 9**：Web IDE 与 AI 脚本

## 构建内核

```powershell
cmake --preset windows-msvc-dev      # Linux 用 linux-clang-dev
cmake --build --preset windows-msvc-dev
ctest --preset windows-msvc-dev      # 212 个测试
```

产物位于 `build/<preset>/kernel/apps/lpcli/lpcli.exe`（`lp-server` 在同目录 `build/<preset>/kernel/lp-server.exe`）。

## 第一条仿真：命令行跑通 M/M/1

仓库自带示例 `examples/mm1.lp`（DSL v2：模型级 `param` + `rate(...)` 到达 +
`service { resource = R }` 显式资源引用；流程块直接是 model 根成员，由
`couple` 连线，无 `process` 容器）：

```logicpilot
model MM1 {
  use process
  param arrival_rate: float = 0.8
  param service_rate: float = 1.0

  resource Server {
    capacity = 1
  }

  source Arrivals { arrival = rate(arrival_rate) }
  queue WaitLine { capacity = 1000000 }
  service Handle { resource = Server; time = exponential(service_rate) }
  sink Done { }

  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in
}
```

```powershell
lpcli compile examples/mm1.lp -o build/mm1.ir.bin
lpcli run --model-file build/mm1.ir.bin --seed 42 --reps 3 --arrivals 500 --warmup 50
```

输出包含吞吐量、L/Lq/W/Wq 的均值、标准差与 95% 置信区间，以及资源利用率与可用性
（以下为示例数值，随种子与参数变化）：

```text
summary: 3 replications, 95% CI
  throughput   mean=0.8012 std=0.0341 CI=[0.7165, 0.8858] theory=0.8000 covered
  Wq           mean=2.8597 std=0.9148 CI=[0.5869, 5.1324] theory=4.0000 covered
  utilization  mean=0.7674 std=0.0275 CI=[0.6992, 0.8356] theory=0.8000 covered
  availability mean=1.0000 std=0.0000 CI=[1.0000, 1.0000]
```

每行末尾的 `theory=... covered` 表示该指标落在理论解析解的置信区间内
（验收纪律，见 [确定性复现与契约](./determinism)）。

也可以用内置模型快速体验：`lpcli run --model built-in:mm1`。

## 浏览器可视化

单命令启动 WebSocket 网关（编译 + 开服一步完成）：

```powershell
lpcli serve examples/mm1_failure.lp --port 8089
```

另开终端启动 Web IDE：

```powershell
pnpm install
pnpm dev      # http://localhost:5173
```

页面点 **Connect** → 设置参数 → **Start**，即可看到队列动画、实时图表与运行统计（详见 [Web IDE 使用](./web-ide)）。

## 下一步

- 想看语言能力：[DSL 语言速查](./dsl)
- 想让 AI 帮你建模型：[AI Copilot](./ai-copilot)
- 想了解如何保证可复现：[确定性复现与契约](./determinism)
