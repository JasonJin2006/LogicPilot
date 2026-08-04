# IR v2 迁移设计：薄契约 + 引擎注册表

状态: 设计定稿，Phase B 第一部分已实现（2026-08-04）。目标形态 = AnyLogic 的"基座 + 块库"骨架 × 我们的
工程纪律（类型化/版本化/冻结/确定性/span/诊断）。配套草案见 `schemas/ir_v2.fbs`
（尚未接入构建，仅作为迁移参照物）。

## 1. 结论（来自架构评审）

- AnyLogic 没有"多形式 IR"：它靠 **一个 Agent 基座 + 块库（palette Java 类）+ XML
  模型描述 + 生成代码** 统一方法；SD 编译成 ODE 由引擎积分器在事件间隙驱动。
- 我们不该抄"模型 = 生成代码"（不可验证、不可被 AI 可靠修复）与"无冻结纪律"；
  该抄的是"**薄容器 + 每方法引擎**"形态，并升级为 FMI 式的
  **薄契约 + 引擎注册表**。
- "Agent 统一"若理解为"一个万能运行时对象"，会把我们压回 AnyLogic 的范畴
  （丢掉多物理/宏观/GPU）；正确形态是 B：**Node 只承诺组合与时间对齐，方法内部
  进各自的引擎**。

## 2. 目标架构

```
Node（容器契约，故意薄）
  ├─ typed state / params（Var）
  ├─ typed ports（带事件类型）
  ├─ time / 事件接口
  ├─ couplings（结构化端口引用）
  ├─ behavior: Statechart（可选，可执行行为数据）
  ├─ continuous: [Equation]（可选，结构化方程，非字符串袋）
  └─ semantics: SemanticsRef { library, block, version, params }

引擎注册表（按 semantics 分发，各方法各一个引擎）：
  process → QueueingFlowSim（事件引擎，现状）
  devs    → DevsExecutor（DEVS-lite，现状）
  agent   → AgentRuntime tick（ECS，现状）
  sd/eqn  → ODE/DAE 求解器（未来，结构化方程）
  physics → PDE/FEM/SPH 引擎（未来）
  cluster → 分布式/GPU 内核（未来）
```

加一种新方法 = 注册一个新引擎 + 新库，schema 不动（FMI 思路）。

## 3. v1 → v2 差异（每条都有落点）

| v1 问题 | v2 修正 | 影响文件 |
|---|---|---|
| 五种模型 = union 五个互不相干的表 | 一个 `Node` + `SemanticsRef`（库注册表） | `schemas/ir_v2.fbs`、`lowering.cpp`、`ir_loader.cpp` |
| `TransitionSpec` = description/handler_ref/effects 魔法袋 | `Statechart` 数据（状态 + 类型化触发器转移 + 动作） | `ir_v2.fbs`、`ir_atomic.cpp`、`ir_agent.cpp` |
| `resource` 靠字符串名匹配 | `Resource` 级 `SemanticsRef`（块参数） | `ir_v2.fbs`、`lowering.cpp` |
| 端口无类型 | `Port.event_type` 类型化（复用 F2 类型名） | `ir_v2.fbs` |
| 实验散在 CLI/脚本（`--reps/--arrivals`、prompt 解析） | `Experiment` 进模型（simulation/optimization/MC） | `ir_v2.fbs`、DSL `experiment` 块、`ai-optimize.mjs` |
| `EquationModel` 字符串袋 | 结构化 `[Equation]` + ODE 引擎 | `ir_v2.fbs`（未来） |

## 4. 分阶段实施

- **Phase A（本轮）**: 本设计文档 + `schemas/ir_v2.fbs` 草案（flatc 可编译）+ DSL
  `experiment` 块（sidecar JSON，不碰冻结的 F1）+ `ai-optimize` 改为读模型声明的
  实验。运行时可执行路径行为不变。
- **Phase B 第一部分（已实现）**: `ir_v2.fbs` 接入 C++/TS codegen（F3 冻结门禁，
  file_identifier `LP2R` 与 v1 的 `LPIR` 区分）；`ir_v2_convert.cpp` 提供
  **v1↔v2 双向转换器**（process 路径：source/queue/service 块 + resource 块 +
  couplings）；`load_model_buffer` 按标识符自动识别 v2 并转回 v1 视图，所有现有
  引擎直接运行 v2 文件；`lpcli compile --ir-version 2` 支持 lowering 双写。
  迁移黄金用例：mm1_failure / two_servers 的 v1→v2→加载→运行 **bit-exact 对拍**
  （118/118 ctest）。
- **Phase B 第二部分（已实现）**: devs/agent 块接入转换器（`AtomicModel` ↔
  devs/atomic 节点 + 单状态 Statechart；`AgentModel` ↔ agent 节点 + 行为绑定）；
  CoupledModel 容器根统一为 `core/model`（子节点各自携带方法语义）。pulse_chain /
  agents 对拍 bit-exact，`--ir-version 2` 覆盖全部可执行模型（122/122 ctest）。
- **Phase C 第一步（已实现）**: `IrAtomicModelV2` 直接解释 v2 Statechart
  （Message 转移 = delta_ext、Timeout 转移 = delta_int + ta），`build_replication_model`
  对 v2 devs 树走**原生执行**（不再先转 v1）；转换层对 process/agent 仍是兼容路径。
  原生执行与 v1 基线 bit-exact（123/123 ctest）。
- **Phase C 第二步（已实现）**: `AgentReplicationModel` 支持 v2 原生（typed
  state + count 参数 + 行为绑定），v2 agent 树不再走 v1 往返；
  **`lpcli compile` 默认输出切到 v2**（`--ir-version 2`），全套 124 个测试与
  浏览器 E2E 都在 v2 契约路径上通过——v1 读取器从此是纯兼容层。
- **Phase D 第一步（已实现）**: `ContinuousReplicationModel`（固定步长 RK4 +
  v0 RHS 表达式求值器）执行结构化方程——v2-native（`{sd, equation}` 节点的
  `continuous` 方程）与 v1 `EquationModel` 兼容路径；`final_value` 指标入
  `lpcli run` 摘要；指数衰减与 logistic 的**解析解验收**（129/129 ctest）。
  **五种模型种类至此全部可执行**。
- **Lowering 原生 v2 发射（已实现）**: `lower_to_ir_v2` 让 DSL 编译器**直接发射
  v2 契约**（`LP2R`，含 `ModelFile.experiments`），编译主路径不再经过 v1→v2 转换器
  （转换器保留为迁移/兼容工具）。默认输出即 v2；`--ir-version 1` 走原生 v1 发射。
  四类模型的原生 v2 与 v1 运行逐位一致（131/131 ctest）。

## v1 读取器退役决策

**保留 v1 读取为纯兼容层**：旧 `.lpir` 文件与 `scripts/interop` 继续读 v1；
新编译默认发射 v2。v1 发射（`--ir-version 1`）与 v1 读取器不设退役期限，直到
外部工具链（interop/TS）整体切换到 v2 后另行决策。
- **Phase B**: `schema_version=2` 冻结升级（按 `scripts/check-schema-conform.ps1`
  纪律：同 commit 更新 `schemas/baseline/`）+ v1 兼容读取器（五种类 → Node +
  SemanticsRef 映射）+ lowering 双写。一次性迁移黄金用例（v1 `.lpir` 被 v2 读取器
  正确解释）。
- **Phase C**: `Statechart` 数据替换 `TransitionSpec`；`Var` 替换 `Param` 魔法袋；
  `Experiment` 从 sidecar 并入 `ModelFile.experiments`。
- **Phase D**: `EquationModel` 结构化方程 + ODE 引擎注册；interop/TS 生成随 schema
  升级走一次完整冻结流程（`writer.cpp` + `verify-interop.mjs` 双向校验）。

## 5. 迁移纪律（沿用并强化）

- 冻结流程不变：`flatc --conform` + `.bfbs` SHA256 双门禁，契约变更与 baseline
  更新同 commit（ADR-0004）。
- v2 读取器必须能读 v1（迁移测试固定种子逐位对拍）。
- span/诊断贯穿 Node/Experiment，AI 闭环不回归。
- 每个引擎独立验收（M/M/c 理论、DEVS 确定性、agent 轨迹、未来 ODE 解析解）。
