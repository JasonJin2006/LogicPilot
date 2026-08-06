# Agent-centric 模型结构迁移设计

状态：已完成（2026-08-06）· 维护者：`/root`

## 1. 目标

把当前"model → process 容器 → 子画布/子文件"的层级结构，迁移为
**agent 树 + 类型化成员** 的结构（AnyLogic / Godot 的组合）：

- **agent（Node）是唯一核心单元**：一棵树（`model` 根 + 嵌套 agent 种群）。
- **每个 agent 有一张画布（presentation）**，画布上**平铺它的全部成员**：
  参数、变量、资源、流程块（source/queue/service/...）、状态机、统计、装饰形状。
- **流程块是 agent 的成员**，不是另一个嵌套层级；块之间用 `couple` 连线。
- **`process` 不再是容器**：旧 `process Flow { }` 写法已完全舍弃（2026-08-06），
  新模型直接把流程块放在 model/agent 作用域。
- **复用**：嵌套 agent 通过 `instance` 引用独立文件（Godot scene / AnyLogic 种群）。
- **语义分发**：每种成员由 `semantics {library, block}` 交给引擎注册表
  （process 引擎 / statechart 引擎 / 方程引擎 ...），对应 IR v2 的
  `SemanticsRef`。

## 2. 目标 DSL 形态

```logicpilot
model CallCenter {
  use process
  param arrival_rate: float = 0.8
  param service_rate: float = 1.0

  // 资源：模型级元素，直接是根成员
  resource Agent { capacity = 2 }

  // 流程块：直接是根成员，不再包一层 process
  source Incoming { arrival = rate(arrival_rate) }
  queue Wait { capacity = 100 }
  service Handle { resource = Agent; time = exponential(service_rate) }
  sink Done { }
  couple Incoming.out -> Wait.in
  couple Wait.out -> Handle.in
  couple Handle.out -> Done.in

  // 嵌套 agent（种群）也是成员
  agent Caller { count = 50 }
}
```

根画布（= model 根的 presentation）直接显示以上全部成员与连线；
`agent Caller` 是一张可下钻的卡片。

## 3. 变更范围

### 3.1 DSL / 编译器（`dsl/compiler/src/semantic.cpp`、`lowering.cpp`）

- 允许注册的 process 库块（source/queue/service/sink/delay/...）作为
  `model` 根成员和 `agent` 成员（现状：LP2004 "must be declared inside a
  process"）。
- 同一作用域内的 `couple` 校验（端口存在/方向/条件）适用于 model 根、agent
  体、以及（兼容的）process 体。
- 作用域级流程结构校验：含流程成员的 model/agent 作用域必须有 source
  （沿用 LP2002），沿用 registry 端口校验。
- `check_agent` 递归校验子成员（流程块、嵌套 agent）。
- lowering 已支持：根/agent 的 process 库子成员按 `{process, block}` 发出，
  同作用域 `couple` 落到节点 couplings。`process` 容器路径已移除（LP2004）。

### 3.2 内核（`kernel/src/devs/ir_loader.cpp`）

- `build_replication_model` / `extract_flow_params`：在 model 根（以及 agent
  作用域）的**直接子成员**中查找 process 库成员，构造 QueueingFlowSim
  （M/M/1 链）或 ProcessFlowSim（通用拓扑）。

### 3.3 工程格式（`docs/specs/project-format-v2.md`）

- `model/main.lp` 承载 model 根的**全部成员**（参数、资源、流程块、couple、
  嵌套 agent 的 instance 引用）——不再为 `process` 生成 `model/scenes/*.lp`。
- 嵌套 agent 每个一个文件（`model/scenes/<Agent>.lp`），经 `instance` 引用。
- `presentation/*.canvas.json` 按作用域存布局（根 + 每个 agent）。
- 旧格式不再兼容：`model/scenes/<Process>.lp`（历史工程）中的 `process`
  容器无法编译（LP2004），文件成为孤立文件。

### 3.4 IDE（`web/apps/ide`）

- 根画布平铺：流程块、参数、资源、couple 连线、agent 卡片都在同一张画布；
  拖流程块不再自动建 `Flow` 容器并跳转（`insertBlockAt` 的自动 Flow 逻辑移除）。
- Project 树 = model → 成员（参数/资源/流程块/agent），agent 可展开子成员；
  点击任意 agent 打开其画布。
- 旧的 `process` 容器仍以下钻卡片呈现（兼容），但新建模型不产生该层级。

## 4. 兼容与迁移

- **旧格式完全舍弃**（2026-08-06）：`process Flow { ... }` 容器不再被 DSL
  编译器接受（LP2004 明确报错）、不再有 `{process, flow}` IR、不再产生
  `model/scenes/<Process>.lp` 工程文件；旧工程中的此类文件成为孤立/不可编译
  文件（可编辑但无法运行）。嵌套 agent 的 `instance` 引用与 scene 文件保留。
- 迁移顺序：编译器（A）→ 内核（B）→ 工程格式（C）→ IDE（D）→ 示例/测试/E2E（E）。
- 每个阶段保持 ctest / vitest / browser-verify 全绿。

## 5. 验收

- `model` 根直接写流程块 + `couple` 可编译、可运行（M/M/1 统计对拍）。
- agent 体内可写流程块 + `couple`，编译与内核可执行。
- 根画布平铺显示全部成员；拖 resource 与拖流程块行为一致（都在根作用域）。
- 旧 `process` 容器格式不再可编译（`process` kind → LP2004）。

## 6. 实施记录

- 阶段 A（编译器）✅：process 库块允许作为 model/agent 成员；作用域级
  source 与耦合校验；agent 递归校验子成员。
- 阶段 B（内核）✅：`build_replication_model` / `extract_flow_params`
  支持 model 根直接成员 + 根耦合（M/M/1 快路径 + ProcessFlowSim）；
  `ProcessFlowSim` 改为接收"阶段列表 + 耦合列表"。
- 阶段 C（工程格式）✅：`generateDsl` 平铺根级流程块 + 模型级 couple；
  `nodePath` 去掉 `Flow/` 前缀；嵌套 agent 仍按 instance/独立文件组织。
- 阶段 D（IDE）✅：`insertBlockAt` 不再自动建 `process Flow` 容器；
  根画布平铺 resource 与全部流程块。
- 阶段 E（内核·嵌套 agent 体）✅：`build_replication_model` /
  `extract_flow_params` 检测 agent 子节点体内的 process 库成员与其 couplings，
  将其作为流程作用域执行（M/M/1 快路径 + ProcessFlowSim）；与根级扁平放置
  bit-exact 对拍（同种子全指标一致，`test_ir_loader` "agent body flow"）；
  顺带修复 `extract_flow_params` 中 `node_block(root) != "model"` 的指针比较
  bug（此前流式驱动恒走 generic 路径）。
