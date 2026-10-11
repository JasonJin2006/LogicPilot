# LogicPilot 工程化路线计划（工程建模与仿真 Workbench）

状态：已定稿（2026-08-06）；维护者：`/root`；参考：`docs/roadmap.md`

## 0. 定位校准

LogicPilot 是**可扩展工程建模与仿真 Workbench**：统一文档、编辑器、模型树、
画布、属性、诊断、命令、AI、实验与可信运行基础设施。时间推进是可选能力，
不是进入 Workbench 的前提；SysML/C4 等工程模型与 DEVS/Process/Agent/SD 等
仿真模型均是一等文档。SysML v2 的 behavior、calculation、analysis/verification
case 可以选择成为执行目标，但纯结构/需求模型不需要 runtime。平台不发展为通用逻辑推理引擎，也不把所有语言塞入同一
DSL、同一 `ModelDocument` 或同一 runtime。

统一 Workbench 迁移、运行时层级修正和 SysML v2 高优先级垂直切片见
[`workbench-architecture-plan.md`](./workbench-architecture-plan.md)。该计划自
2026-08-23 起是新增编辑器、模型类型和 AI 建模能力的架构入口；既有 P0-P3 条目
保留为历史交付与兼容基线。

## P1-Next 大一统 Workbench + SysML v2（最高优先级，已批准）

- **先建立最小扩展 seam**：DocumentType、Outline、Diagnostic、Command、AI
  contribution、稳定 ElementRef、ExecutionTarget 和跨工件关系；没有选定执行目标
  的编辑/诊断流程不得创建 runtime/clock/scheduler。
- **紧接着交付 SysML v2 文本建模 MVP**：`.sysml` 编辑、parser/语义索引、
  稳定诊断、Outline、completion/hover/引用/重命名，以及面向 requirement、part、
  port、connection、trace、action/state、analysis/verification case 的 AI 建模工具。
- **随后交付 SysML 语义执行 MVP**：calculation/constraint、action succession、
  state/event/time trigger 形成显式 execution target，可解释执行或 lowering 到
  Statechart/DEVS/continuous backend，并产生可重复 trace/evidence。
- **再扩展 SysML 多视图和数字线程**：结构/连接/需求追踪/行为视图，对齐 OMG
  machine-readable schema 与 Systems Modeling API，并将 requirement → experiment
  → simulation → result/evidence 串联起来。
- **现有前端渐进迁移**：保留视觉和交互，把 Model tree、Palette、Properties、
  Process/Statechart 画布和全局校验分别迁为 provider；C4 作为 SysML MVP 后的
  第二个非仿真扩展。
- **运行时只服务可执行工件**：`SimulationMethod` 逐步收敛为 runtime adapter；
  Process 是离散事件建模前端/库，现有 ProcessFlow runtime 是兼容与优化路径，
  不再充当平台顶层方法分类。

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
- **零容量死锁检查 ✅（LP5008）**：`wait` 或非抢占 `queue` 的字面量
  `capacity = 0` 在语义阶段直接诊断；启用 Queue preemption 的溢出路由保留为
  合法例外，避免把运行时永久阻塞推迟到仿真阶段。
- **条件字段标识符校验 ✅（LP5006）**：`selectOutput.condition` /
  `hold.blockingCondition` 只允许 `t`/`time` 与块自身数值字段，未知标识符
  报 LP5006（此前静默按 0.0 处理）。
- **端口类型兼容检查 ✅（LP5009）**：Process library 与 Atomic coupling
  的静态端口声明现在在编译期校验；普通类型要求精确匹配，空类型与显式
  `any`/`message` 保留为通配契约，避免不兼容消息进入 IR/运行时。

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
  `examples/flow_exit.lp` 冒烟；moveTo/assembler 的完整语义已在后续条目补齐。
- **assembler 语义已落地（2026-08-06）**：等待 in（主件）+ p1（部件，
  quantity125 数量）到齐后装配 delayTime 秒输出主件（多装配并行）；
  新增内核测试（正常装配/部件不足）与 `examples/assembler_line.lp` 冒烟；
  装配期资源占用为后续项。
- **assembler 装配期资源已落地（2026-08-07）**：`resourcePool` +
  `numberOfUnits` 在装配期间占用资源单元（不足时等待、完成后归还，随池
  故障模型联动）；新增资源门控差分测试（cap 0 全阻塞 vs cap 1 放行）。
- **moveTo 语义已落地（2026-08-07）**：`tripTime` 显式行程时间、
  `speed`+`xYZ` 沿轴位移（距离/速度）、缺省零时跳转；Entity 增加位置
  字段；新增内核测试与 `examples/move_route.lp` 冒烟。
- **空间节点已落地（2026-08-07）**：新增核心块 `node { x; y }`（语义
  校验数值常量、lowering 为 core/node、内核收集坐标），`moveTo` 支持
  `node = <Name>` 目标（2D 距离/速度）。
- **path 网络已落地（2026-08-07）**：`path { node1; node2 }` 核心块连接
  节点（边长 = 欧氏距离），内核构建全对最短路径（Floyd-Warshall），
  `moveTo` 沿网络最短路径位移（无 path 回退直线）；新增三角形网络差分
  测试（网络 20 vs 直线 14.14），`examples/move_route.lp` 改为三段节点
  网络。
- **service 任务抢占已落地（2026-08-07）**：`enablePreemption` +
  `taskMayPreempt` + `taskPreemptionPolicy`（非 pp_no_preemption）时，
  高优先级新任务（属性 priority 或 taskPriority）打断最弱运行任务，
  后者经 outPreempted 退出；新增内核差分测试（抢占拉低 mean_sojourn）
  与 `examples/task_preempt.lp` 冒烟。

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

- 每阶段保持当前 ctest 基线全绿、docs 构建通过、CI 全绿。
- 每阶段独立可交付、可回退；P0 增量聚焦结构化诊断/调试/剖析 + 测试基准
  扩展 + DSL 冻结文档。

## 深核实施增量（2026-08-22 起）

以下能力已在现有路线之上落地，并以 clean Windows CTest 作为持续门禁：

- **DEVS/PDEVS 执行内核**：运行时路由计划、PDEVS bag/confluent 语义、因果
  evidence hash、版本化 atom checkpoint，以及固定分区的保守时间戳屏障并行。
- **流程引擎状态完整性**：Process 的 Seize/Wait/Assembler/MoveTo/Combine/Match/
  Split/Select/Batch 等私有队列、资源持有、timeout、抢占和空间旅行状态均显式
  编解码；不支持的块组合保持显式拒绝。
- **跨分区恢复基础设施**：确定性 partition transport、版本化事件帧、固定容量
  原子 ring、peer epoch/heartbeat、replay window、checkpoint recovery epoch。
- **持久化与演进**：LPCD/LPAE/LPMC archive、append-only journal 与 compaction、
  RLE reference transform、原子 blob store、混合方法 shared variable/message
  快照，以及显式单跳/多跳 method schema migration registry。
- **多方法协调**：Process、Statechart（含 composite network）、Agent、SD/DEVS
  的 session bundle 在共享 clock/scheduler 上进行一致性 replay；模型 fingerprint
  防止跨模型误恢复。
- **DEVS 运行时端口类型防线 ✅**：LP5009 的静态 coupling 检查之外，IR v2
  `Port.event_type` 现在保存在 `AtomicModel`，`DevsRuntimePlan` 装载时对最终
  output→input 路由执行二次类型校验，防止手工 IR/原生插件绕过 DSL 契约。
- **跨方法消息契约 ✅**：`MessageStore` 支持注册 URI/schema/encoding 契约；已知
  类型在 publish 与 session checkpoint restore 时拒绝版本或编码漂移，未注册 URI
  保留为旧插件兼容扩展点。
- **连续时间误差控制 ✅**：SD 默认固定 RK4 保持黄金值兼容；连续节点可通过
  `adaptive`、容差、步长和 `horizon` 参数启用确定性的 step-doubling RK4，
  checkpoint 保存控制器状态，shared scheduler 按预检后的实际接受步长调度。
- **DEVS evidence 归档 ✅**：新增版本化 LPEV 编解码、FNV 校验和、记录/事件/字节
  上限及 recorder restore 校验，可将因果 evidence 从内存安全地交给离线复盘工具。
- **连续零交叉观测 ✅**：连续节点设置 `detect_zero_crossings` 后记录每个状态的
  过零方向、步内线性定位时间与前后值，并纳入 checkpoint；离散回调接入仍保留
  为后续混合仿真边界；新增 cold-path observer hook 供方法适配器消费。
- **零交叉步长裁剪 ✅**：adaptive SD 可用 `stop_at_zero_crossings` 在预检阶段把
  下一步裁到首个 crossing，使 shared scheduler 停在边界时间；完整 rollback/event
  语义仍保持明确边界。
- **事务式 session restore ✅**：恢复前保存方法/变量/消息/时钟 rollback image，
  通过方法 token 取消保持事件序列确定性；任一方法失败即回滚完整共享世界并返回 KR1016。
- **插件 artifact 完整性 pin ✅**：method manifest 可选 `artifactSha256`，C ABI/WASM
  loader 在加载前执行 SHA-256 比对并拒绝 MP1108/MP1211 mismatch；未提供时保持旧版
  兼容，数字签名/信任链仍不在此层伪造。
- **DEVS evidence 文件存储 ✅**：`FileEvidenceArchiveStore` 以临时文件/备份/替换
  方式持久化 LPEV，并在 load 时执行大小、checksum、序列和因果 cardinality 校验。
- **共享 scheduler event budget ✅**：`ReplicationConfig.max_events` 默认 5000 万，
  `SimulationKernel`/`SimulationSession` 超限返回 KR1017，避免零时刻事件风暴挂死宿主。
- **流式 gateway 预算对齐 ✅**：`lp-server` 的 `SimRunner` 现在共享同一事件预算，
  `start.maxEvents` / `--max-events` 可按 replication 限制 dispatch；耗尽以
  `RunFinished{Failed, KR1017}` 暴露，不再误报为取消。
- **泛型流引擎预算对齐 ✅**：增量 `QueueingFlowSim`/`ProcessFlowSim` 热循环现在
  累计 dispatch 计数并返回同一 KR1017 诊断；Process/Queueing checkpoint 同时保存
  budget 配置与累计计数，恢复不会悄悄重置安全边界。
- **Statechart 预算对齐 ✅**：定时器、条件轮询和即时 branch/history transition
  共享累计预算；复合网络按子图确定性分配上限，checkpoint 与 live gateway 均传播
  `Failed/KR1017`，避免零时刻状态循环吞噬 worker。
- **Agent/Continuous 计算预算对齐 ✅**：Agent 将 `max_events` 映射为 accepted
  tick 上限，Continuous 映射为 accepted RK4 step 上限（不干扰 adaptive trial
  retry）；两者 checkpoint 恢复预算/失败状态，Agent gateway 与 Continuous
  runtime 均可区分 `KR1017` 和普通数值错误。
- **跨方法 logical-step trace ✅**：`TraceRecorder` 新增独立 logical-step 通道，
  Agent tick 与 Continuous accepted RK4 step 进入确定性 hash，同时保持旧
  scheduler `event_count()` 兼容，支持跨方法同 seed 差异定位。
- **bounded trace 差异诊断 ✅**：logical-step 可选有界可读记录，截断不影响完整
  hash；`LogicalTraceComparator` 输出首个时间/type/payload 差异，避免调试捕获本身
  成为长仿真的内存风险。
- **logical trace 便携归档 ✅**：新增 LPLT 版本化编解码、archive byte/record 限额和
  FNV 校验，Agent/Continuous step 证据可安全交给 CI 或离线 replay 工具。
- **logical trace 文件存储 ✅**：`FileLogicalTraceArchiveStore` 复用 evidence 的
  temp/backup/atomic replace 契约，提供可恢复的跨进程 trace 工件安装与加载。
- **DebugRecorder 有界捕获 ✅**：调试事件流支持显式 max-events、保留前缀和
  `truncated()` 标志，profile 仍记录完整 dispatch 数，长仿真不会因调试捕获无界增长。
- **SimulationSession 累计预算 ✅**：跨多次 `advance(until)` 的 shared scheduler
  dispatch 计数不再被切片重置；checkpoint/portable codec 保存累计计数，pause/step
  无法绕过 KR1017。
- **方法族/形式化元数据 ✅**：MethodRegistry Descriptor 增加 family/formalism，
  明确 `discrete_event/{devs,process,statechart}`、`agent/agent`、
  `system_dynamics/sd` 映射；旧 IR library 名称与无 metadata 的插件保持兼容，
  Session 的 DEVS checkpoint 判断不再硬编码 method name。
- **Evidence causal graph ✅**：`DevsEvidenceGraph` 从 PDEVS input_sources 聚合稳定
  atom→atom 边、消息/转移计数和路径 hash，供离线复盘与 AI 解释复用；不把观测图伪装成干预因果。
- **分区 replay gap 诊断 ✅**：`PartitionReplayWindow` 按 epoch/source 追踪最高序号，
  Ring transport 检出跳号并保留 expected/observed 诊断，同时向 `PartitionPeerControl`
  发布固定宽度 replay request，供 checkpoint replay 协调器触发补发。
- **分区 bounded replay history ✅**：可选 `PartitionReplayHistory<Capacity>` 保留最近
  帧并按 request 提取有序完整范围；窗口不足时明确返回 unavailable，回退到 checkpoint replay。
- **Evidence first-divergence 诊断 ✅**：`DevsEvidenceComparator` 在 hash mismatch 后按记录/字段
  给出第一处差异及 expected/actual，支持并行 barrier 与 checkpoint replay 调试。

当前阶段仍保留明确边界：可信加密、对象存储 SDK、进程间映射、分布式故障恢复和
Time Warp 不在内核中伪造实现，均通过 transform/transport/migration 接口预留。
