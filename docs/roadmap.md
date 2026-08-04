# LogicPilot 总计划（Roadmap）

状态：持续更新 · 维护者：`/root`（集成与发布） · 2026-08-04

本文档是**唯一的总计划入口**，汇总此前散落在各 spec/ADR 中的计划与状态
（`docs/specs/ir-v2.md`、`docs/specs/dsl-spec.md`、`docs/specs/ai-loop.md`、
`docs/performance-budget.md`、ADRs、用户手册）。开发按里程碑推进，每个
里程碑结束在 `main` 打 checkpoint commit；验收纪律：单元测试 / 理论验收 /
确定性三件套之一以上，且不破坏现有测试。

## 1. 产品目标

Simulation OS：AI 原生、Web 化、高性能、多尺度、多物理、多 Agent 的仿真平台。
核心资产：**Simulation IR（薄契约 + 引擎注册表）**、**DSL（人与 AI 共用）**、
**高性能仿真 Runtime**、**行业模型库**。

## 2. 现状总览（已完成）

| 域 | 状态 | 说明 |
|---|---|---|
| 理论设计（Phase 0） | ✅ | ADR-0001..0008、`dsl-spec`、F1/F2 契约冻结 |
| 内核基础（Phase 1） | ✅ | 二叉堆调度器、xoshiro256++、int64 定点时间、SlabPool/Arena |
| 多方法执行 | ✅ | process（M/M/1、M/M/c+故障）、DEVS atomic、agent tick、continuous ODE（RK4+耦合+RHS 函数）——五类模型全部可执行 |
| DSL（Phase 2） | 🔶 | v0 + atomic + agent + continuous + experiment 块、结构化诊断 JSON；**表达式未开始** |
| IR v2 迁移 | ✅ | A→B→C→D 全部阶段、原生 v2 发射（`LP2R` 默认）、F3 C++↔TS 互操作门禁；**v1 已全量退役** |
| AI Copilot（Phase 6 第一刀） | 🔶 | ai-build（规则/LLM 双 provider + 诊断修复闭环）、ai-optimize（模型声明实验 + grid/GA）、ai-explain（池级归因）；AI 面板含轨迹/优化曲线；**细粒度归因未开始** |
| Web IDE（Phase 3 切片） | 🔶 | 连接/运行控制、PixiJS 队列动画、uPlot 实时图表、统计面板、AI 面板；**拖拽建模未开始** |
| 工程与文档 | ✅ | CI（kernel 双平台 + web build/test + docs build + schema conform + interop）、VitePress 用户手册 |
| 测试基线 | ✅ | 131 ctest、renderer2d 5 vitest、interop 58 checks、浏览器 E2E |

## 3. 契约与工程纪律状态

| 契约 | 状态 |
|---|---|
| F1 `ir_v2.fbs`（Node/SemanticsRef） | ✅ 冻结（flatc conform + baseline SHA256 双门禁） |
| F2 `wire.fbs` 遥测帧 | ✅ 冻结 |
| F3 C++ ↔ TS 运行时互操作 | ✅ CI 逐字段校验（58 checks） |
| `performance-budget.md` 性能预算 | ✅ 契约 + bench 门禁（`>= 1M events/s`）已进 CI |

## 4. 待开发（按优先级）

### P0 — CI 门禁与测试缺口（补交付评审缺口，短里程碑）

1. ~~**Benchmark 门禁进 CI**~~ ✅ 已完成
   `ci.yml` 新增 `bench` job（release + `LOGICPILOT_BUILD_BENCH=ON`），跑
   `test_perf_baseline`（`>= 1M events/s`）与 `logicpilot_bench` /
   `mm1_event_bench` 冒烟。

2. **多客户端广播 + 慢客户端测试**
   现状：多客户端广播 ✅ 已测（3 客户端并发收到同一帧序列）；**慢客户端/写队列
   超限（`kMaxWriteQueue`）仍无专门测试**。
   验收：新增写队列超限丢弃最旧帧的集成测试。
   入口：`kernel/tests/test_lp_server_integration.cpp`、`kernel/apps/lp-server/server.cpp`。

3. **手写 JSON 控制解析器单元测试**
   现状：`json_string_field` 等仅由集成测试间接触及（转义、截断、数字格式）。
   验收：直接对 `server.cpp` 的 JSON 辅助函数做边界用例单测。
   入口：`kernel/apps/lp-server/server.cpp`。

4. **tree-sitter corpus 测试接入 CI**
   现状：`dsl/tree-sitter-logicpilot/test/corpus/` 需要 `tree-sitter test` CLI，
   CI 未安装；文法回归由 C++ 侧 `test_dsl_parser` 间接承担。
   验收：CI 增加一步运行 `tree-sitter test`（或等效的 corpus 校验）。
   入口：`dsl/tree-sitter-logicpilot/`、`.github/workflows/ci.yml`。

### P1 — 核心功能（下一个开发主战场）

5. **DSL v2 重设计（含表达式）**
   现状：DSL 语法与绑定混乱（grammar.js 与 parser.c 脱节、同名魔法绑定、行为三套
   写法、无表达式）；已按 AnyLogic 官方分层（核心原语 + 块库）重设计为
   **"薄核心文法 + 厚库注册表"**，见 `docs/specs/dsl-v2.md`（草案待评审）。
   范围：泛化文法（kind=identifier，块名全部进库注册表）+ `service { resource = R }`
   显式引用 + 类型化参数 + 表达式（常量折叠→参数引用）+ 行为统一 +
   `library`/`block` 库元层，按 `docs/specs/dsl-v2.md` §7 分 Phase B–E 落地。
   **Phase B（泛化文法）✅ 已完成**（`da2d80c` 落地）：`grammar.js` 重写为
   通用骨架（`kind`=任意 identifier），tree-sitter 0.26.11 重生成 parser；AST/
   parser/semantic/lowering 全部泛化；process 库块形状进编译器内建注册表
   （`LP2004` 未知/错位 kind、`LP2005` 未知字段）；corpus 40 用例、示例、
   AI provider、文档同步。行为语法统一为 `on_<trigger> { }`（`poisson` 保留为
   `rate` 的等价别名，Phase D 弃用）。
   **Phase C（显式引用）✅ 已完成**（2026-08-04）：`service { resource = R }`
   替代同名魔法绑定（`LP4001` 校验引用），缺省回退 v0 绑定；示例/AI provider/
   golden/CLI 夹具同步。
   **Phase D（表达式）✅ 已完成**（2026-08-04）：`value` 文法扩展为表达式
   （`+ - * /`、一元负、括号），常量折叠 + 参数引用（`arrival = rate(arrival_rate)`
   可编译），模型级 `param` 进 IR 根节点；新 `LP2006`（未声明标识符/非常量）。
   剩余：Phase E 行为统一+实验限定路径+`library`/`block` 库元层文件。
   验收：全部示例/测试/AI provider 同步，147 ctest 不回归。
   入口：`docs/specs/dsl-v2.md`、`dsl/tree-sitter-logicpilot/grammar.js`、
   `dsl/compiler/src/{parser,semantic,lowering}.cpp`。

6. **Web IDE 拖拽建模**
   现状：IDE 只有运行可视化切片；建模靠手写 DSL / AI 生成。
   范围：块面板（source/queue/service/atomic/agent/continuous）→ 画布拖拽 →
   属性编辑 → DSL 生成 → 编译诊断回显。
   验收：拖拽拼出 mm1 等价模型并 `lpcli compile` 通过；浏览器 E2E 覆盖。
   入口：`web/apps/ide/src/`、`web/packages/editor/`（预留包，已从仓库移除占位）。

7. **逐环节瓶颈归因**
   现状：`ai-explain` 只给池级指标（利用率/可用性/等待占比）。
   范围：内核按 stage 输出指标（服务台利用率、队列占用）→ 扩展 F2 或摘要 →
   `ai-explain` 升级为"Machine 3 利用率 98%、等待 40 分钟"级归因。
   注意：F2 为冻结契约，指标扩展需走冻结流程。
   入口：`kernel/src/devs/`、`kernel/apps/lp-server/wire_frames.cpp`、`scripts/ai-explain.mjs`。

8. ~~**v1 读取器/发射退役**~~ ✅ 已完成
   v1（`LPIR`）已全量移除：`schemas/ir.fbs`、v1↔v2 转换器、`--ir-version 1`、
   interop/TS 的 v1 绑定全部删除；loader/process 路径原生吃 v2。

### P2 — 扩展（远期）

9. **行业模型库**：制造（Machine/Robot/AGV/Warehouse）、物流（Truck/Route/Demand）、
   交通模板；以 `SemanticsRef` 库注册表形式交付（引擎注册表已就绪）。
10. **2D/3D 场景与可视化增强**：更多 2D 视图（人群/交通）、3D 数字孪生（Three.js/GLTF）。
11. **跨工具链确定性黄金值**：libm 超越函数跨 MSVC/clang 不保证逐位一致（评审 m4）；
    需自研位精确 log/sqrt 或把 bit-exact 限定为"同构建内"（文档已限定）。
12. **AI 自动优化增强**：多变量/GA 参数化、约束、目标组合；瓶颈归因深化。
13. **分布式/GPU/时间弯曲**：ADR-0006/0007 已明确推迟，接口预留（引擎注册表），不排期。

## 5. 推进方式

- 每里程碑以功能为单元，先改 `docs/roadmap.md` 状态再实现，实现后同 commit 更新。
- 涉及两个以上工作流的语义变更，先写契约规格（`docs/specs/`）再实现。
- 契约变更必须走冻结流程（F1/F2/F3，见 §3），不破坏 136 ctest 与前端测试。
- 服务端/CI 相关改动在本机验证：`cmake --build build/integration-dev` + `ctest`，
  前端 `pnpm build` / `pnpm test` / `pnpm docs:build`。
