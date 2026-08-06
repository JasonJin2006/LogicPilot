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
- **实体属性 + 条件路由已落地（2026-08-06）**：`source` 块内
  `state <name> = <值>` 声明实体属性默认值（降级进 IR Node.state），
  `selectOutput`/`hold` 条件可引用属性名（LP5006 校验同步放行）并按属性
  路由；split 拷贝、combine/batch 保留首个原件属性；新增内核路由测试、
  语义测试与 `examples/attribute_routing.lp` 冒烟。
- **通用引擎故障模型已落地（2026-08-06）**：`failure_rate`/`repair_rate`
  接入 `ProcessFlowSim` 的 `service`（忙时故障 + 修复，抢占式重启，
  与 QueueingFlowSim 专用路径同一套语义）；`availability` 指标随
  metrics.json 输出；depart 事件改为按实体 id 派发（顺带修正多单元
  delay/service 的完成顺序）；新增 M/G/1 理论验收测试（2 万 arrivals ×
  16 reps，CI 覆盖理论 Wq=8.73，同 test_mm1_failure 验收规则）与
  `examples/failure_line.lp` 冒烟。统计口径经实测与理论一致
  （此前小样本读数属方差噪声，非系统性偏差）。
- **wait/seize 退出超时已落地（2026-08-06）**：`enableTimeout`+`timeout`
  字段驱动 `outTimeout` 条件端口——等待超过 `timeout` 的 agent 从
  `outTimeout` 离开（AnyLogic 语义；couple 到 outTimeout 时编译期要求
  enableTimeout=true，LP5003）；新增 wait/seize 超时内核测试（含无超时
  差分）与 `examples/wait_timeout.lp` 冒烟。
- **优先级排队与抢占已落地（2026-08-06）**：`queue`/`wait` 的 `queuing`
  （fifo/lifo/priority）+ 实体 `priority` 属性（回退 `agentPriority`）；
  `enablePreemption` 驱动 `outPreempted`：queue 满队踢最弱、wait/seize
  到达抢占最弱；`can_accept` 升级为按实体判断；新增 queue/wait/seize 抢占
  差分测试与 `examples/priority_preempt.lp` 冒烟。`queuing_comparison`
  （表达式比较）暂回退 FIFO。
- **等值比较与 match 属性配对已落地（2026-08-06）**：表达式语言新增
  `==` / `!=`（tree-sitter 文法 + 编译器折叠 + 内核 ExpressionEvaluator
  同步，corpus 49/49）；`matchCondition = <属性名>` 让 match 按实体属性
  等值配对（新到达者与对侧队列从前到后找首个同值配对）；新增内核
  match 配对/等值路由测试与 `examples/match_attr.lp` 冒烟。
- **字段访问表达式已落地（2026-08-07）**：文法新增成员访问
  （`agent1.kind`），编译器提取为 kField，语义层对 matchCondition 做
  LP5006 校验（agent1/agent2 + 属性名/t/time）；内核 match 支持
  `agent1.X == agent2.Y` 双作用域求值（重写为 agent1_X 后经
  ExpressionEvaluator 计算）；corpus 50/50，`examples/match_attr.lp`
  改用标准写法。
- **queuing_comparison 已落地（2026-08-07）**：queue 的
  `agent1IsPreferredToAgent2` / wait 的 `agent1MayPreemptAgent2` 表达式
  驱动比较式排序与满队准入（复用双作用域求值）；新增内核差分测试与
  `examples/comparison_queue.lp` 冒烟。至此 queuing 四种模式
  （fifo/lifo/priority/comparison）全部实现。
- **seize 池故障已落地（2026-08-06）**：被 seize 持有的资源单元服从池的
  忙时故障/修复律（引擎级忙周期跟踪 + 代际计数防止过期 TTF 误触发）；
  故障期新 seize 不放行，`availability` 计入池停机面积；新增内核测试
  （无丢件/可用性带/无故障 availability==1/逐位确定）与
  `examples/seize_failure.lp` 冒烟（availability≈0.955）。
- **exit/enter 语义已落地（2026-08-06）**：`exit` 从流程移除 agent
  （sojourn 保留，AnyLogic Exit）；`enter` 为无输入的入口点，无外部注入
  API 时空闲（AnyLogic 需程序化 enter() 触发）；新增内核测试与
  `examples/flow_exit.lp` 冒烟。moveTo/assembler 仍为直通占位。
- **assembler 语义已落地（2026-08-06）**：等待 in（主件）+ p1（部件，
  quantity125 数量）到齐后装配 delayTime 秒输出主件（多装配并行）；
  新增内核测试（正常装配/部件不足）与 `examples/assembler_line.lp` 冒烟；
  装配期资源占用为后续项。
- **assembler 装配期资源已落地（2026-08-07）**：`resourcePool` +
  `numberOfUnits` 在装配期间占用资源单元（不足时等待、完成后归还，随池
  故障模型联动）；新增资源门控差分测试（cap 0 全阻塞 vs cap 1 放行）。
- **moveTo 语义已落地（2026-08-07）**：`tripTime` 显式行程时间、
  `speed`+`xYZ` 沿轴位移（距离/速度）、缺省零时跳转；Entity 增加位置
  字段；新增内核测试与 `examples/move_route.lp` 冒烟。至此 process 库
  23 块全部有内核语义（完整 node/path 空间建模为后续项）。

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
