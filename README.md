# LogicPilot

AI 原生 · Web 化 · 高性能的**多方法建模仿真平台**（Simulation OS）。

用一套薄 DSL 描述模型，C++ 内核高速执行，浏览器/Tauri 桌面端拖拽建模，并为
M/M/c 指数流程提供实时流式可视化（其他模型返回批量运行摘要）。AI 生成 → 编译
修复 → 运行校验闭环开箱即用。技术路线上与
AnyLogic / Simio 对齐，但采用更现代的 **DSL → IR → C++ Runtime → Web/Tauri
IDE** 分层，而不是 Java/生成代码。

> 定位声明：LogicPilot 是**建模仿真平台**（离散事件、DEVS 原子、Agent 群体、
> 连续 ODE，多方法在同一内核/事件队列中组合），不是通用编程语言，也不是
> 逻辑推理引擎。语言边界见 [DSL 冻结契约](docs/specs/dsl-freeze.md)。

## 架构总览

```mermaid
flowchart LR
    subgraph DSL[建模语言]
        A[.lp 模型] --> B[tree-sitter 解析]
        B --> C[语义分析 + 库注册表]
        C --> D[IR v2 降级 FlatBuffers]
    end
    subgraph Kernel[C++ 仿真内核]
        D --> E[SimulationKernel]
        E --> F[Method Runtime Layer]
        F --> G[Process / Statechart / Agent / SD]
        G --> H[共享事件队列 + 时钟]
    end
    subgraph IDE[Web / Tauri]
        H --> I[WebSocket wire 帧]
        I --> J[React + PixiJS 可视化]
        C -. 诊断 JSON .-> K[AI 闭环]
        K --> A
    end
```

分层原则：**C++ 内核负责全部编译与仿真步进**，浏览器只消费二进制状态快照
（`wire.fbs` 的 Tick/Counters 帧）与渲染指令；AI 闭环只读写 DSL 与结构化
诊断，不接触内核内部。

## 快速开始

### 环境要求

- CMake ≥ 3.25、Ninja、MSVC（Windows）/ clang（Linux）
- vcpkg（`vcpkg.json` 声明依赖，经 `CMakePresets.json` 自动接入）
- Node.js ≥ 20 + pnpm 9（Web IDE 与 AI 脚本）；Rust（可选，桌面端 Tauri）

### 构建内核

```powershell
.\scripts\windows-build.ps1 -Preset windows-msvc-dev -Test
```

普通 PowerShell 下请始终使用此入口。脚本会自动发现并加载匹配的
MSVC/Windows SDK 环境，不需要永久配置 `INCLUDE`/`LIB`。Linux 仍直接使用
`linux-clang-dev` CMake preset。

### 第一条仿真

```powershell
# 编译 + 运行 M/M/1 示例
lpcli compile examples/mm1.lp -o build/mm1.ir.bin
lpcli run --model-file build/mm1.ir.bin --seed 42 --reps 3 --arrivals 500 --warmup 50

# 或用内置模型 + 复现级并行
lpcli run --model built-in:mm1 --reps 30 --threads 8
```

### Web IDE 与 AI

```powershell
lpcli serve examples/mm1.lp --port 8089   # 启动仿真网关
pnpm install
pnpm --filter @logicpilot/ide dev          # http://localhost:5173
```

在 IDE 里可以：拖拽建模（39 个 process 块 + presentation/statechart/action
库）、DSL 编译诊断、M/M/c 流式运行可视化、通用模型批量运行摘要、AI 面板
生成/优化/归因。桌面客户端见
[desktop/README.md](desktop/README.md)。

### 离散事件（process）块语义

process 库 23 块中 22 块已有内核真语义（以 AnyLogic 官方文档为参考）：
`source/queue/wait/delay/service/sink`、`resource`（含故障/修复）、
`seize/release`（资源持有与归还）、`batch/unbatch`
（临时/永久批）、`combine`、`match`（纯同步或按属性配对）、
`selectOutput/hold`（运行时条件，支持 `==`/`!=`）、`exit`、`enter`、
`timeMeasureStart/End`、`assembler`、`moveTo`（tripTime/速度位移）；
实体属性（source `state` 声明）驱动条件路由、优先级排队与抢占
（`outTimeout`/`outPreempted`）。**process 库 23 块全部有内核语义**
（完整 node/path 空间建模为后续项）。组合模型见 `examples/des_shop.lp`。

流程契约：普通输出端口不允许隐式扇出（编译期 `LP5007`），复制实体使用
显式 `split`（副本为独立实体，arrivals/departures/in-system 计数一致；
副本继承原实体的统计资格，`--warmup N` 按外部 Source arrivals 判定，
不受副本数量影响）。资源池故障为整池忙时故障/修复时钟：`service` 消费者
在服任务被中断并在修复后抢占式重启；`seize`/`assembler` 消费者在故障期间
不放行新授权、已持有单元不中断（AnyLogic "No preemption" 默认），单元级
故障时钟为后续工作；池进入 idle 时未发生的故障时钟停止，但**已经发生的
故障必须完成 repair**（释放最后一个单元不会跳过维修，等待者直到 repair
事件真正触发才恢复）。**"业务结束"** 定义为：没有任何 Source 将来还能产生
外部 arrival（自身 `maxArrivals` 耗尽、`manual`/`maxArrivals=0`、采样器停止
产生有效正间隔、或全局 arrivals 上限已达成）且没有有效 pending Source
arrival、系统内实体归零；达到全局上限时其余 Source 已预调度的 arrival 会
被立即取消，不会推进时钟。业务真正结束后，尾部不再影响业务的维护事件被
清理，horizon 停在精确的业务结束时刻（generation 校验只是第二层防御，
不能阻止事件被弹出前 run_until 已发生的时钟推进——取消事件本身才是）。
实时流式执行区分 `executionMode`：
`fast`（默认，无 wall-clock 休眠、遥测帧预算限流且**预算含最终状态帧**，
最终帧使用精确的最后事件时间）与 `animated`（按 speed 节奏、支持
pause/step）。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `dsl/` | tree-sitter 文法（生成物入库，ADR-0005）、C++ 编译器（parser/semantic/lowering/registry）、lp-lsp 语言服务器 |
| `kernel/` | C++ 仿真内核：core（时钟/调度器/随机）、runtime（Method Runtime Layer + SimulationKernel）、devs（引擎）、agent（ECS）、state、apps（lpcli / lp-server） |
| `methods/` | 方法运行时插件库（`process`、`statechart`） |
| `libraries/` | DSL 库注册表（`process.lplib`、行业示例 `manufacturing.lplib`） |
| `schemas/` | 冻结契约 F1（IR v2）/ F2（wire 遥测），flatc 生成 |
| `web/` | Web IDE（React + zustand + PixiJS）、editor 图文档包、protocol/renderer2d |
| `desktop/` | Tauri 2 桌面壳（Rust），嵌入同一 Web IDE |
| `examples/` | 示例模型（mm1、制造线、call-center 工程等） |
| `bench/` | 性能门禁基准（scheduler/RNG/MM1/ProcessFlow） |
| `scripts/` | AI 闭环（ai-build/optimize/explain）、工具（logicpkg/verify-run）与 CI 冒烟测试 |

## 文档

- 在线手册（VitePress）：`docs/guide`（快速开始 / 桌面客户端 / CLI / DSL /
  Web IDE / AI / 确定性 / FAQ），构建：`pnpm docs:build`
- 总计划与现状：[docs/roadmap.md](docs/roadmap.md)
- 工程化路线（P0–P3 执行状态）：[docs/dev-plan.md](docs/dev-plan.md)
- 设计规范与 ADR：`docs/specs/`、`docs/adr/`

## 测试与门禁

- **kernel/DSL**：390 ctest（单元/集成/确定性/验收/规模冒烟/AI 闭环/LSP/包工具）
- **前端**：editor / renderer2d / protocol vitest + 浏览器 E2E
- **契约**：F1/F2 schema conform + 基线 SHA256 双门禁；C++↔TS 互操作逐字段校验
- **性能**：bench 门禁（≥ 1M events/s，`bench/`）
- **DSL 工具链**：tree-sitter corpus + 生成物同步门禁（`git diff --exit-code src/`）

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
