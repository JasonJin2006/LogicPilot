# LogicPilot 工程化路线计划（以建模仿真为核心）

状态：已定稿（2026-08-06）· 维护者：`/root` · 参考：`docs/roadmap.md`

## 0. 定位校准

LogicPilot 是**多方法建模仿真平台**（DSL → C++ 内核 → Web IDE + AI 建模闭环），
不是逻辑推理/规则引擎。外部评审提出的「AI Logic Agent Runtime / 逻辑规则 DSL /
知识推理」方向判定为**不适用，不纳入**；其建议按仿真平台的真实缺口重新翻译，
按 P0 → P3 分阶段推进。

## P0 核心闭环补齐（进行中）

### P0-1 Kernel 运行时稳定性与错误体系

- **结构化诊断**：新增 `kernel/runtime/runtime_diagnostics.h`
  （`RuntimeSeverity` / `RuntimeDiagnostic{severity, code, message}`），
  `SimulationKernel::run` 增加可选 `std::vector<RuntimeDiagnostic>*`
  输出；错误码 `KR1xxx` 起步（无模型 / 无方法 / 装配失败 / 初始化失败）。
- **调试事件**：`TraceRecorder` 之上增加可选 `DebugRecorder`（记录
  `(time, type, payload, handler)` 事件流），作为未来 debugger 的基座。
- **轻量 profiler**：`SimulationProfiler` 统计事件类型直方图 / 派发总数 /
  墙钟耗时，`SimulationKernel::run` 可选输出。
- **生命周期契约文档**：`docs/specs/method-runtime.md` 增补
  load → initialize → advance* → shutdown → metrics 的执行契约与错误约定。

### P0-2 测试与基准补齐

- 内核不变量测试：departures == arrivals 守恒、队列不溢出、多方法组合回归、
  profiler/诊断接线单测。
- 基准门禁：新增 `bench/process_flow_bench.cpp`（通用 ProcessFlowSim 吞吐），
  接入 CI bench job 冒烟。

### P0-3 DSL 定型确认

- 新增 `docs/specs/dsl-freeze.md`：冻结边界（永不添加：函数定义 / 模块导入 /
  pattern matching / 逻辑规则语法）与扩展点（库注册表、表达式、`instance`
  引用）；把 `dsl-spec.md` 的 out-of-scope 清单固化为冻结契约。

## P1 验证引擎 + AI 验证闭环（后续）

- 静态检查：在 semantic（LP2001–8002）上补仿真语义检查（不可达块、死锁、
  资源引用环、耦合完整性），产出新 LP 码。
- 运行时 verifier：把 `expect.json` 理论验收模式做成通用校验器，
  `ai-build` 末尾接入：生成 → 编译诊断修复 → 运行 → 与解析解/守恒不变量对拍。

## P2 开发者生态（后续）

- LSP/VSCode 扩展：复用 `dsl/compiler` 与 tree-sitter 抽 language-server
  （诊断/补全/悬停/跳转，JSON-RPC），再包 VSCode 扩展。
- 库包生态：`logicpkg` CLI（打包/安装 `.lplib` + palette JSON + 图标），
  `use <lib>` 已支持。

## P3 行业化与云（后续）

- 行业模型库（制造/物流/交通）以 `SemanticsRef` 注册表交付；lp-server
  云化部署；可视化增强。

## 验收纪律

- 每阶段保持 194+ ctest 全绿、docs 构建通过、CI 全绿。
- 每阶段独立可交付、可回退；P0 增量聚焦结构化诊断/调试/剖析 + 测试基准
  扩展 + DSL 冻结文档。
