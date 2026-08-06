# LogicPilot 工程化路线计划（以建模仿真为核心）

状态：已定稿（2026-08-06）· 维护者：`/root` · 参考：`docs/roadmap.md`

## 0. 定位校准

LogicPilot 是**多方法建模仿真平台**（DSL → C++ 内核 → Web IDE + AI 建模闭环），
不是逻辑推理/规则引擎。外部评审提出的「AI Logic Agent Runtime / 逻辑规则 DSL /
知识推理」方向判定为**不适用，不纳入**；其建议按仿真平台的真实缺口重新翻译，
按 P0 → P3 分阶段推进。

## P0 核心闭环补齐（✅ 已落地 2026-08-06）

### P0-1 Kernel 运行时稳定性与错误体系 ✅

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

### P0-2 测试与基准补齐 ✅

- 内核不变量测试：departures == arrivals 守恒、队列不溢出、多方法组合回归、
  profiler/诊断接线单测。
- 基准门禁：新增 `bench/process_flow_bench.cpp`（通用 ProcessFlowSim 吞吐），
  接入 CI bench job 冒烟。

### P0-3 DSL 定型确认 ✅

- 新增 `docs/specs/dsl-freeze.md`：冻结边界（永不添加：函数定义 / 模块导入 /
  pattern matching / 逻辑规则语法）与扩展点（库注册表、表达式、`instance`
  引用）；把 `dsl-spec.md` 的 out-of-scope 清单固化为冻结契约。

## P1 验证引擎 + AI 验证闭环（进行中）

- **静态检查 ✅（LP5004）**：`semantic.cpp` 新增「流程 stage 无入边耦合
  （不可达）」检查（LP5004），显式耦合图中非 source 且无入边的 stage 报错；
  耦合完整性（LP5002/5003）与缺 source（LP2002）此前已有。
- **运行时 verifier ✅**：新增 `scripts/verify-run.mjs`（守恒 / 有限性 /
  吞吐为正 + 可选 expect.json 理论契约：CI 覆盖或点估计容差，对齐
  examples/*.expect.json 验收规则）；`ai-build.mjs` 运行后自动校验并把
  `verification` 报告并入输出；新增 `verify_run_smoke` ctest。
- 后续：死锁（服务前无源/队列容量 0 语义）等更深静态检查。
- **条件字段标识符校验 ✅（LP5006）**：`selectOutput.condition` /
  `hold.blockingCondition` 只允许 `t`/`time` 与块自身数值字段，未知标识符
  报 LP5006（此前静默按 0.0 处理）。

## 运行时执行策略决策（✅ 已落地 2026-08-06）

- **ADR-0009**：并行模型按三阶段落地（A 复现级线程池 → B agent ECS 批量
  tick 并行 → C 事件级保守并行，ADR-0007 延后）；脚本策略为「表达式优先、
  暂不上 VM」——复用内核 `ExpressionEvaluator` 在有限决策位（selectOutput/
  hold/match/agent 守卫）执行运行时 `condition_text`，纯求值无副作用；
  用户自定义脚本语言仅在出现具体需求时再设计（沙箱 VM 边界）。
- **阶段 A 已落地（2026-08-06）**：`run_replications_parallel`（内核
  replication API）+ `lpcli run --threads N`——每个 worker 持有独立模型
  实例，按 rep 派生种子，结果与串行逐位一致；`--trajectory` 时回退顺序
  路径（保持主模型 per-run 状态可见）；新增并行确定性测试与 CLI 冒烟。
- **阶段 B 已落地（2026-08-06）**：agent ECS 批量 tick 并行——flip/bounce
  等逐实体独立行为在 ≥ 65536 agent 且多核时按原子分区并行执行，每实体计算
  与串行逐位一致；新增 10 万 agent 两次运行逐位相同的确定性测试。
- **脚本 Phase 1 已落地（2026-08-06）**：内核 `ExpressionEvaluator` 支持
  比较运算（`< > <= >=`），`selectOutput` 按 `condition` 路由、`hold` 按
  `blockingCondition` 阻塞，条件原文随 IR 传递（编译时折叠常量比较，非折叠
  字段降级为字符串参数），运行时按 `t`/`time` + 块数值参数求值。
- **DES 块真语义已落地（2026-08-06）**：通用流程引擎按 AnyLogic 语义补齐
  `seize→release`（引擎级资源池持有/归还，不足时排队）、`batch/unbatch`
  （permanent/temporary）、`combine`（in1/in2 合成）、`match`（双流同步，
  out1/out2 原子输出）、`timeMeasureStart/End`（`measure` 指标进
  metrics.json）；新增 6 个内核测试 + 3 个示例（seize_release / batch_unbatch
  / combine_time）经 lpcli 编译运行冒烟。hold 的 `initiallyBlocked`/`freeze`
  布尔字段此前读取失效，随 `node_bool_param` 一并修复。

## P2 开发者生态（✅ 已落地 2026-08-06）

- **lp-lsp ✅**：`dsl/lsp/` 语言服务器（stdio JSON-RPC）——复用进程内 DSL
  编译器与 tree-sitter，didOpen/didChange → `publishDiagnostics`（LP 码、
  0 基 span）、completion（核心种类 + process 库块及字段）、hover（块
  摘要）；stdin/stdout 二进制模式保证 framing 逐字节正确；`lsp_smoke`
  ctest 覆盖有效/损坏模型与补全。
- **VSCode 扩展 ✅**：`extensions/logicpilot-vscode/`——自包含 LSP 客户端
  （无 npm 依赖）+ TextMate 语法 + 语言配置，诊断/补全/悬停接线。
- **logicpkg ✅**：`scripts/logicpkg.mjs`——`init` / `pack`（单文件 .lpkg
  包）/ `install`（防路径穿越）/ `list`；`logicpkg_smoke` ctest 覆盖
  init→pack→install→list 往返。

## P3 行业化与云（✅ 部分落地 2026-08-06）

- **自定义库块闭环 ✅**：`.lplib` 块可用 `extends: ref = <内置块>` 映射到
  内核已有语义；`use <library>` 按搜索路径加载 `<library>.lplib`，编译/
  语义/降级全链路打通（LP2010 找不到库 / LP2011 库名或映射错误），
  `lpcli compile --lib-path` 支持自定义库目录。`libraries/manufacturing.lplib`
  示例（Machine→service、Station→queue、WorkCell→delay），e2e 实测编译降级
  为 `{process, service}` 并运行。行业库从此「可发布、可编译、可运行」。
- **行业示例模型 ✅**：`examples/industry/manufacturing_line.lp`（制造线：
  原料到达 → 钻床池（2 台含故障）→ 装配 → 成品），`lpcli compile/run`
  实测通过；`examples/industry/README.md` 说明如何以 `.lpkg` 分发。
- **行业库发布闭环 ✅**：新增 `scripts/test-library-publish.mjs` +
  `library_publish_smoke` ctest——logicpkg pack → install → compile → run
  制造库模型的端到端冒烟，库分发「可发布、可安装、可运行」受 CI 保护。
- **容器化部署 ✅（基建）**：`docker/Dockerfile` 多阶段构建（vcpkg 固定
  基线编译 lp-server + lpcli）+ `.dockerignore` + `docker/README.md`
  （构建/运行/健康检查/TLS 建议）。
- 后续：行业模型库扩展为独立 `.lpkg` 包分发；自定义块纯新语义（无 extends）
  需在内核注册新引擎；可视化增强。

## 验收纪律

- 每阶段保持 212 ctest 全绿、docs 构建通过、CI 全绿。
- 每阶段独立可交付、可回退；P0 增量聚焦结构化诊断/调试/剖析 + 测试基准
  扩展 + DSL 冻结文档。
