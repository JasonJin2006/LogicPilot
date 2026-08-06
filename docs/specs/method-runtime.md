# Method Runtime Layer（多方法仿真平台架构）

状态：Phase 1 + Phase 3 已落地（2026-08-06）· 维护者：`/root` · 参考：`docs/roadmap.md`

## 1. 为什么需要这一层

早期架构把 Process Flow 直接建在 kernel 内：

```
IR
 |
Kernel
 |
Process Flow
```

导致 kernel 被某一种建模方法绑架：`process_flow.cpp`、Queue/Service 语义、IR
中 process 库的解析逻辑全部散落在 kernel 内部，Agent / System Dynamics /
Statechart 无法作为同级插件接入。

目标架构是 **Modeling Method Operating System**：kernel 是仿真世界（只负责
时间、事件、调度、生命周期），每种建模方法是一个可插拔的 runtime：

```
                 Model IR
                    |
             Runtime Framework
                    |
        +-----------+-----------+
        |           |           |
    Process      Agent       SystemDynamics
    Runtime     Runtime        Runtime
        |           |           |
        +-----------+-----------+
                    |
              Simulation Kernel
```

## 2. 目标目录

```
LogicPilot
├── kernel/
│   ├── include/logicpilot/runtime/   # SimulationMethod / RuntimeContext /
│   │                                 # RuntimeManager / MethodRegistry
│   ├── include/logicpilot/state/     # VariableStore（跨方法共享状态）
│   ├── core/  time/scheduler/event   # kernel 只保留这些
│   └── src/devs/                     # 既有引擎（Phase 3 迁往 methods/）
├── methods/
│   ├── process/                      # ProcessRuntime（第一个方法插件）
│   ├── agent/                        # （后续）
│   ├── system_dynamics/              # （后续）
│   └── statechart/                   # （后续）
├── compiler/
├── ir/
├── libraries/
└── web/
```

## 3. 已落地（Phase 1：抽象隔离，不改变功能）

### 3.1 `kernel/runtime` — 方法运行层契约

`SimulationMethod`（`kernel/include/logicpilot/runtime/simulation_method.h`）
是每种建模方法的插件接口：

```cpp
class SimulationMethod {
 public:
  virtual std::string_view method_name() const = 0;          // "process" / "agent" / ...
  virtual bool initialize(RuntimeContext&, const IrModelFile&, std::string* error) = 0;
  virtual void advance(SimTime until) = 0;
  virtual void shutdown() = 0;
  virtual std::unique_ptr<ReplicationModel> to_replication_model(
      const IrModelFile&, std::string* error) = 0;           // 批量兼容适配
};
```

kernel 只通过这个接口驱动方法，完全不认识 Queue / Service / Stock / State。

- `RuntimeContext`：kernel 提供给方法运行时的设施（clock、scheduler、
  VariableStore）。Phase 1 的既有引擎仍在内部自建 scheduler/clock；引擎接入
  外部设施随 Phase 3 模块化一起完成。
- `RuntimeManager`：一次 replication 内持有多个方法 runtime，统一驱动
  initialize → advance* → shutdown。
- `MethodRegistry`：`method name -> factory` 的插件注册表。第三方法可直接
  `register_method("traffic", ...)` 接入，kernel 不改一行。

### 3.2 `kernel/state` — 跨方法共享状态

`VariableStore`（`kernel/include/logicpilot/state/variable_store.h`）提供跨方法
共享变量（bool / int64 / double / string），多方法模型的连接点：

```cpp
ProcessRuntime: inventory += produced;
AgentRuntime:   inventory -= consumed;
SDRuntime:      dInventory/dt = input - output;
```

### 3.3 `methods/process` — 第一个方法插件

`ProcessRuntime`（`methods/process/process_runtime.cpp`）把原
`kernel/src/devs/ir_loader.cpp::build_process_model` 的 lowering 逻辑原样搬出
（M/M/1 快路径 → `QueueingFlowSim`，通用拓扑 → `ProcessFlowSim`），并在
`register_process_method()` / `register_all_methods()` 中注册。驱动入口
（lpcli / lp-server）启动时调用 `register_all_methods()`。

Phase 1 生命周期语义（文档化约定）：`initialize()` 完成 lowering 与校验，
第一次 `advance()` 以驱动默认 `ReplicationConfig` 跑完整个 replication，
`shutdown()` 释放。**增量 advance（按仿真时间步进）随 Phase 3 的模块化
block runtime 落地。**

### 3.4 IR 解耦（Phase 2 的注册表驱动部分）

IR v2 的 `SemanticsRef{library, block}` 本身就表达 **method + component**：

```json
{ "method": "process", "component": "service", "parameters": { "time": "normal(10,2)" } }
```

`build_replication_model()`（`kernel/src/devs/ir_loader.cpp`）现在只做三件事：
按根节点语义解析 method 名 → 向 `MethodRegistry` 要 runtime → 委托
`to_replication_model()` 降级。kernel 不再包含 process 专属的解析/降级代码；
agent / devs / sd 以 kernel 原生方法注册（`kernel/src/runtime/builtin_methods.cpp`）。

## 4. 后续阶段

### Phase 3：Process 模块化 ✅ 已完成（2026-08-06）

`ProcessFlowSim` 的 742 行单体 Engine 已拆成方法内的模块化组件，并把引擎本体
从 `kernel/src/devs/process_flow.cpp` 迁入 `methods/process/`：

```
methods/process/
├── process_runtime.h/.cpp   # ProcessRuntime：生命周期 + 降级 + 注册
├── process_flow.h/.cpp      # 通用引擎（路由/调度/统计，增量 reset/advance/metrics）
├── process_block.h          # Entity / BlockContext / ProcessBlock 抽象
└── process_blocks.h         # SourceBlock / QueueBlock / DelayBlock /
                             # ServiceBlock / SinkBlock / GenericBlock
```

每个块通过 `ProcessBlock` 契约表达自己的行为（`can_accept` / `receive` /
`update` / `complete` / `retry_outgoing`），引擎只负责端口路由、调度与统计，
并通过 `BlockContext` 向块提供 `emit` / `schedule_depart` / RNG / 统计钩子。

两个引擎都改为增量执行：`reset(config)` 准备一次 replication，
`advance(until)` 只派发时间戳 <= until 的事件，`metrics()` 汇总当前统计；
`run()` = reset + advance(infinity) + metrics，与旧批量调用逐位一致
（184 ctest 全绿，含新增的增量/批量对等性测试）。因此
`SimulationMethod::advance(until)` 现在是**真正的按仿真时间步进**：
`ProcessRuntime::advance(until)` 直接驱动引擎切片推进。

lp-server 的流式驱动（SimRunner）与 QueueingFlowSim 的双实现合并列为后续
优化项：现在两个执行器均可增量推进，合并后 lp-server 可复用同一执行器。

### Phase 4：第二种方法接入

不继续优化 process，直接接入第二种方法（如 Statechart：kernel 已有
`statemachine/` 与 IR `Statechart` 表）验证架构；随后 agent / system
dynamics 各自拆成独立方法库。多方法模型通过 `VariableStore` + 同一
`RuntimeManager` 组合运行。

## 5. 验收与约定

- 变更不破坏 182 ctest 与前端测试。
- kernel 层禁止 include `methods/`（方向只能由方法库指向 kernel）。
- 新方法 = 新目录 `methods/<name>/` + 一个 `SimulationMethod` 子类 +
  `register_<name>_method()`；驱动通过 `register_all_methods()` 汇总注册。
- IR 契约冻结（F1），method/component 的语义映射用现有 `SemanticsRef`
  表达，不改 `schemas/ir_v2.fbs`。

## 6. 构建说明

本机的 MSVC+Ninja 配置（CMake 4.4）生成的编译规则**不追踪头文件依赖**
（`unscanned` 规则，无 depfile），因此改头文件后需要全量重建
（`cmake --build build/windows-msvc-dev -j 8` 前先清掉受影响对象，或直接
`cmake --build ... --target clean`）；否则会残留旧头文件编译的对象，导致
类布局 ABI 不一致（曾因此出现仅在测试二进制中复现的崩溃）。CI 全新检出，
不受此影响。
