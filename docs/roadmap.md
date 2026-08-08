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

| 域                           | 状态 | 说明                                                                                                                                                                                                                                                                              |
| ---------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 理论设计（Phase 0）          | ✅   | ADR-0001..0008、`dsl-spec`、F1/F2 契约冻结                                                                                                                                                                                                                                        |
| 内核基础（Phase 1）          | ✅   | 二叉堆调度器、xoshiro256++、int64 定点时间、SlabPool/Arena                                                                                                                                                                                                                        |
| 多方法执行                   | ✅   | process（M/M/1、M/M/c+故障）、DEVS atomic、agent tick、continuous ODE（RK4+耦合+RHS 函数）——五类模型全部可执行                                                                                                                                                                    |
| DSL（Phase 2）               | ✅   | DSL v2 全量完成：薄核心文法 + process 库注册表（`.lplib`）、显式资源引用、表达式/参数引用、行为统一、实验限定路径；结构化诊断 JSON                                                                                                                                                |
| IR v2 迁移                   | ✅   | A→B→C→D 全部阶段、原生 v2 发射（`LP2R` 默认）、F3 C++↔TS 互操作门禁；**v1 已全量退役**                                                                                                                                                                                            |
| AI Copilot（Phase 6 第一刀） | 🔶   | ai-build（规则/LLM 双 provider + 诊断修复闭环）、ai-optimize（模型声明实验 + grid/GA）、ai-explain（池级归因）；AI 面板含轨迹/优化曲线；**细粒度归因未开始**                                                                                                                      |
| Web IDE（Phase 3 切片）      | 🔶   | WebSocket 连接/运行控制、拖拽建模画布（Palette 多库/端口连线/DSL 编译）、画布实时运行徽标、AI 面板；**前端已重构**（zustand 域 store、run/ai 目录、editor 包）；**自研面板系统 ✅ + 拖拽建模 ✅（P1-7 验收达成：拖拽拼出 mm1 等价模型并 `lpcli compile` 通过，浏览器 E2E 覆盖）** |
| 并行执行                     | ✅   | ADR-0009 阶段 A（reps 级线程池）与阶段 B（agent ECS 批量 tick，≥65536 agent 多核自动并行，10 万 agent 逐位确定）已落地；阶段 C（事件级保守并行）延后 |
| 工程与文档                   | ✅   | CI（kernel 双平台 + web build/test + docs build + schema conform + interop）、VitePress 用户手册                                                                                                                                                                                  |
| 测试基线                     | ✅   | 294 ctest、corpus 48/48、renderer2d 5 vitest、editor 57 vitest、IDE 71 vitest、interop 58 checks、浏览器 E2E                                                                                                                                                                    |

## 3. 契约与工程纪律状态

| 契约                                | 状态                                              |
| ----------------------------------- | ------------------------------------------------- |
| F1 `ir_v2.fbs`（Node/SemanticsRef） | ✅ 冻结（flatc conform + baseline SHA256 双门禁） |
| F2 `wire.fbs` 遥测帧                | ✅ 冻结                                           |
| F3 C++ ↔ TS 运行时互操作            | ✅ CI 逐字段校验（58 checks）                     |
| `performance-budget.md` 性能预算    | ✅ 契约 + bench 门禁（`>= 1M events/s`）已进 CI   |

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
   ✅ 已完成：写队列上限（丢弃最旧帧）与 JSON 解析器边界单测、tree-sitter
   corpus CI 一并补齐（`ca52e3f`）。

3. **手写 JSON 控制解析器单元测试**
   现状：`json_string_field` 等仅由集成测试间接触及（转义、截断、数字格式）。
   验收：直接对 `server.cpp` 的 JSON 辅助函数做边界用例单测。
   入口：`kernel/apps/lp-server/server.cpp`。
   ✅ 已完成（`ca52e3f`）。

4. **tree-sitter corpus 测试接入 CI**
   现状：`dsl/tree-sitter-logicpilot/test/corpus/` 需要 `tree-sitter test` CLI，
   CI 未安装；文法回归由 C++ 侧 `test_dsl_parser` 间接承担。
   验收：CI 增加一步运行 `tree-sitter test`（或等效的 corpus 校验）。
   入口：`dsl/tree-sitter-logicpilot/`、`.github/workflows/ci.yml`。
   ✅ 已完成（`ca52e3f`，dsl-grammar job 跑 `tree-sitter test`，现 48 用例）。

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
   （`LP2004` 未知/错位 kind、`LP2005` 未知字段）；corpus 48 用例、示例、
   AI provider、文档同步。行为语法统一为 `on_<trigger> { }`（`poisson` 保留为
   `rate` 的等价别名，Phase D 弃用）。
   **Phase C（显式引用）✅ 已完成**（2026-08-04）：`service { resource = R }`
   替代同名魔法绑定（`LP4001` 校验引用），缺省回退 v0 绑定；示例/AI provider/
   golden/CLI 夹具同步。
   **Phase D（表达式）✅ 已完成**（2026-08-04）：`value` 文法扩展为表达式
   （`+ - * /`、一元负、括号），常量折叠 + 参数引用（`arrival = rate(arrival_rate)`
   可编译），模型级 `param` 进 IR 根节点；新 `LP2006`（未声明标识符/非常量）。
   **Phase E（部分）✅**：行为统一已在 Phase B 落地；experiment `variable`
   限定路径（引用已声明模型参数，`LP7001` 校验）已完成。
   **Phase E（库元层）✅ 已完成**：块形状声明于 `libraries/process.lplib`
   （类型化字段、无默认值即必填），经 `scripts/gen-stdlib-header.mjs` 嵌入
   编译器；semantic 改为注册表驱动的形状校验（必填/未知字段/重复/类型），
   范围与引用语义保留在 C++。**P1-5 DSL v2 重设计全部完成**。
   验收：全部示例/测试/AI provider 同步，147 ctest 不回归。
   入口：`docs/specs/dsl-v2.md`、`dsl/tree-sitter-logicpilot/grammar.js`、
   `dsl/compiler/src/{parser,semantic,lowering}.cpp`。
   **2026-08-06 工具链审计整改 ✅：** CI `dsl-grammar` 新增生成同步门禁
   （`tree-sitter generate` + `git diff --exit-code -- src/` + 未跟踪文件
   检查，防止 grammar.js 与 parser.c 漂移）；compile 入口新增 16 MiB 输入
   上限（`LP0003`）；AST 提取加深度上限（表达式 256 层 / 声明 64 层，
   `LP0001`）且语法错误收集改为迭代遍历，对抗性深嵌套不再栈溢出；新增
   语义多错误聚合测试与健壮性测试。194 ctest 全绿。分层（parser /
   semantic / lowering / compile）与生成文件入库（ADR-0005）经核实为既有
   设计，不改动；Linux 构建由 CI 的 ubuntu job 覆盖。

6. **IDE 自研面板系统（P1-6 前置）**
   现状：IDE 是单页固定布局（header + 画布 + 右侧堆叠面板）；拖拽建模、多视图与
   属性/诊断面板需要一个多面板工作区。
   决策：**自研**（不引 FlexLayout / rc-dock 等 docking 库），零新依赖，复用 zustand
   域 store 模式。
   范围（渐进式，每阶段可交付）：
   - 阶段 1：CSS Grid 骨架（左/中/右 + 底栏 + 状态栏，`grid-template-areas`）、
     `layoutStore`（面板显隐/尺寸/活动标签，persist 到 localStorage）、
     `Panel`/`Splitter` 组件、面板注册表（布局与内容解耦）。
   - 阶段 2：递归分割树布局模型（`tabs`/`split` 节点）+ 标签页拖拽合并 +
     区域级停靠（拖面板到另一区域停靠为其标签页）。
   - 阶段 3（按需）：像素级分裂 + 浮动窗口；届时再评估自研 vs docking 库。
     验收：面板可折叠/调宽/标签切换，布局刷新后保持；浏览器 E2E 覆盖；
     typecheck/build/test 不回归。
     入口：`web/apps/ide/src/layout/`、`web/apps/ide/src/state/layoutStore.ts`、
     `web/apps/ide/src/styles/layout.css`。

7. **Web IDE 拖拽建模**
   现状：IDE 只有运行可视化切片；建模靠手写 DSL / AI 生成。
   **前端重构 ✅ 已完成**（`f7fe9a8`）：zustand 域 store（connection/run）、
   `src/run` `src/ai` `src/state` `src/styles` 目录、`@logicpilot/editor` 包
   （图文档模型 + DSL v2 生成器，8 vitest）。
   **拖拽建模 ✅ 已完成**（2026-08-04）：自研面板系统（多区布局/折叠/标签）、
   palette 宫格（图标 + 端口）、画布坐标体系（网格/缩放/平移/坐标轴）、
   块拖放与移动/选中、端口连线（out→in coupling，点击删除）、
   Properties 属性面板（名称 + `process.lplib` 字段编辑、Delete 删除块）、
   拖放即带默认参数。
   前置：**自研面板系统**（见上，阶段 1/2）提供左栏块库、中央建模画布、
   右栏属性编辑、底栏编译诊断的布局骨架。
   范围：块面板（source/queue/service/atomic/agent/continuous）→ 画布拖拽 →
   属性编辑 → DSL 生成 → 编译诊断回显。
   **生成 DSL + 编译诊断回显 ✅ 已完成**（2026-08-04）：lp-server 新增 `compile`
   控制命令（内嵌 DSL 编译器、base64 传输、返回 diagnostics JSON）；Console
   工具栏 Show DSL / Compile；`generateDsl` 按 coupling edges 拓扑序生成
   （x 序回退，修复 `poisson` 等 distribution 调用被加引号的问题）。
   验收：拖拽拼出 mm1 等价模型 → compile 通过；browser-verify E2E 覆盖
   画布→DSL→编译诊断回显。
   **画布模型 → 运行 → 实时可视化 ✅ 已完成**（2026-08-05）：lp-server `start`
   支持 per-run 参数覆盖（lambda/mu/servers/failure_rate/repair_rate，集成
   测试）；`@logicpilot/editor` 新增 `modelRunParams`（画布块图 → M/M/1 驱动
   参数或拒绝原因）；DSL 编辑区新增 Run（编译通过后自动 start）；运行中画布
   块实时显示队列长度徽标与 service 忙/闲/宕机状态点。browser-verify 覆盖
   完整闭环。局限：当前 streaming 驱动为 M/M/1 族，其他模型族需通用流程执行器（ProcessFlowSim）支持任意 process 拓扑，端口感知路由 + 工作队列驱动，M/M/1 统计对拍与确定性测试；lp-server 对非 M/M/1 模型走批量 ProcessFlowSim 并回 RunFinished 摘要。
   **编辑器补强 ✅ 已完成**（2026-08-05）：撤销/重做（600ms 合并窗口，
   Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z、Ctrl+Y，中心标签栏图标按钮）；
   Project 面板显示模型摘要 + "New model"。
   **会话态启动（2026-08-05）**：模型与工程不再跨会话恢复——客户端每次
   启动为空状态（空白画布、无打开工程），继续之前的工程经
   Open Recent / Open 重新打开；Open Recent 支持单项删除。
   **AI → 画布闭环 ✅ 已完成**（2026-08-05）：`@logicpilot/editor` 新增
   `parseDsl`（DSL v2 全量 → 图文档，自动布局）；AI 面板生成结果新增
   "Load to canvas"，加载为可撤销操作；browser-verify 覆盖 AI 生成 →
   画布加载。
   **DSL ⇄ 画布全量 round-trip ✅ 已完成**（2026-08-06）：任意合法 DSL
   子集满足 `parse(generate(parse(src))) == parse(src)`（成员/参数/边集
   一致）且 generate 幂等；比较表达式、typed state、ODE、多 behavior
   （含端口）、自定义块、couple 端口全部无损往返；editor 包 53 vitest
   覆盖（同名嵌套容器给 LP3103 警告并防递归）。
   **Palette 库选择栏 ✅ 已完成**（2026-08-05）：标题栏下新增库选择条
   （All / Recent / process / 导入的自定义库 + "+" 导入按钮，鼠标滚轮横向
   滚动）；Recent 追踪最近拖放的块（持久化）；自定义库 JSON 导入
   （`logicpilot.palette` 持久化），自定义块可拖入画布（DSL 会照常生成，
   编译器对未注册 kind 报 LP2004）。
   **设置重规划 ✅ 已完成**（2026-08-05）：设置弹层只保留 IDE 级外围偏好
   （外观置顶 + 连接）；运行配置与控制移出设置，改为画布悬浮 Run 按钮打开
   的 Run 对话框（seed/reps/arrivals/warmup/speed + Start/Pause/Resume/
   Step/Stop）——空画布跑网关内建模型，有画布模型时先编译再带参数运行。
   **Palette 多库 ✅ 已完成**（2026-08-05）：新增演示库（rect/roundedRect/
   oval/line/polyline/arc/curve/text/image/group，画布上渲染为真实 SVG 形状，
   可拖动/选中）、状态图库（state/initialState/finalState/transition/
   historyState/branch）、行动图库（action/decision/whileLoop/forLoop/
   doWhileLoop/break/return/localVariable），均配图标；节点带 `library`
   标记，非 process 库元素不进 DSL（`generateDsl` 只发射 process 流）。
   **流程库扩充 ✅ 已完成**（2026-08-05）：按 AnyLogic PML 补齐至 23 块——
   delay/split/combine/batch/unbatch/seize/release/wait/hold/match/
   selectOutput/enter/exit/moveTo/timeMeasureStart/timeMeasureEnd/
   assembler/count，均配图标与 in/out 端口；新增块的常用字段进 Properties
   （delay.time、seize/release.resource、split.copies、batch.size 等）；
   DSL 会照常生成（内核尚未注册的新块编译时报 LP2004）。
   **DES 块真语义 ✅ 已完成**（2026-08-06）：seize→release 引擎级资源池
   持有/归还、batch/unbatch（permanent/temporary）、combine（in1/in2）、
   match（双流同步 out1/out2）、timeMeasureStart/End（`measure` 指标）；
   内核测试 + `examples/{seize_release,batch_unbatch,combine_time}.lp`
   lpcli 冒烟全绿；enter/exit/moveTo/assembler 仍为直通占位。
   **实体属性 + 条件路由 ✅ 已完成**（2026-08-06）：source 的
   `state <name> = <值>` 声明实体属性，selectOutput/hold 条件可按属性
   路由（LP5006 同步放行），`examples/attribute_routing.lp` 冒烟全绿；
   match 按属性配对（agent1.attr == agent2.attr）与实体类型系统为后续。
   **通用引擎故障模型 ✅ 已完成**（2026-08-06）：service 在 ProcessFlowSim
   路径遵守 resource 的 failure_rate/repair_rate（忙时故障+修复，抢占式
   重启，availability 进 metrics.json）；depart 按实体 id 派发；新增
   M/G/1 理论验收（2 万 arrivals × 16 reps，CI 覆盖理论 Wq）与
   `examples/failure_line.lp` 冒烟；两条引擎路径的统计口径实测一致。
   **wait/seize 退出超时 ✅ 已完成**（2026-08-06）：enableTimeout+timeout
   驱动 outTimeout 条件端口（编译期 LP5003 门禁），内核差分测试 +
   `examples/wait_timeout.lp` 冒烟。
   **优先级排队与抢占 ✅ 已完成**（2026-08-06）：queue/wait 的 queuing
   （fifo/lifo/priority）+ 实体 priority 属性；enablePreemption 驱动
   outPreempted（queue 满队踢最弱、wait/seize 到达抢占最弱）；
   `examples/priority_preempt.lp` 冒烟；queuing_comparison 表达式回退
   FIFO，资源任务抢占（taskPriority/preemptionPolicy）为后续项。
   **等值比较与 match 属性配对 ✅ 已完成**（2026-08-06）：`==`/`!=` 进入
   表达式文法（tree-sitter 重生成 + 编译器/内核求值同步，corpus 49/49）；
   `matchCondition = <属性名>` 按实体属性等值配对；
   `examples/match_attr.lp` 冒烟。任意字段访问表达式
   （`agent1.attr == agent2.attr`）为后续项。
   **seize 池故障 ✅ 已完成**（2026-08-06）：被 seize 持有的单元服从池的
   failure/repair（忙周期代际计数防过期事件），availability 计入停机面积；
   `examples/seize_failure.lp` 冒烟；故障期已持有 agent 不中断为简化语义。
   **exit/enter ✅ 已完成**（2026-08-06）：exit 从流程移除 agent（sojourn
   保留）；enter 为无输入的入口点（无外部注入 API 时空闲）；
   `examples/flow_exit.lp` 冒烟；moveTo/assembler 仍为直通占位。
   **assembler ✅ 已完成**（2026-08-06）：in+p1 到齐（quantity125）→
   delayTime 装配 → 输出，多装配并行；`examples/assembler_line.lp` 冒烟；
   装配期资源占用为后续项。process 库仅剩 moveTo 为直通占位（依赖位置
   模型）。
   **全量验收 ✅ 已完成**（2026-08-06）：22/22 示例全部 lpcli 编译运行
   通过；新增 `examples/des_shop.lp`（属性+优先级队列+seize 池故障+
   batch/unbatch+条件路由+timeMeasure+exit 组合）与内核组合守恒测试
   （1000 进 1000 出）；README 更新 DES 块语义清单。
   **AI 模板适配 DES ✅ 已完成**（2026-08-07）：规则 provider 按关键词生成
   priority/measure/seize/batch/assembly/timeout 模板（8 种组合全部编译
   通过），`test-ai-build.mjs` 新增特征断言，`ai_build_smoke` ctest 覆盖。
   **Palette 属性编辑 ✅ 已完成**（2026-08-07）：Properties 面板为 source
   块新增 Entity attributes 编辑区（新增/重命名/删除 int/float/bool 属性，
   对应 DSL `state <name>: <type>`）；editor 包新增 removeParam/renameParam
   图操作，IDE modelStore 新增对应动作；editor 54 + IDE 69 vitest 全绿。
   **moveTo ✅ 已完成**（2026-08-07）：tripTime / speed+xYZ（距离/速度）/
   缺省零时跳转；Entity 增加位置字段；`examples/move_route.lp` 冒烟。
   **process 库 23 块全部有内核语义**（node/path 空间建模为后续项）。
   **字段访问表达式 ✅ 已完成**（2026-08-07）：文法成员访问
   （`agent1.kind`）+ 编译器 kField + matchCondition LP5006 + 内核
   `agent1.X == agent2.Y` 双作用域求值；corpus 50/50；
   `examples/match_attr.lp` 用标准 AnyLogic 写法。
   **queuing_comparison ✅ 已完成**（2026-08-07）：queue 的
   agent1IsPreferredToAgent2 / wait 的 agent1MayPreemptAgent2 表达式排序
   与准入；queuing 四种模式全部实现；`examples/comparison_queue.lp` 冒烟。
   **assembler 装配期资源 ✅ 已完成**（2026-08-07）：resourcePool +
   numberOfUnits 装配期占用/归还（随池故障联动），资源门控差分测试 +
   `examples/assembler_line.lp` 更新为带资源示例。
   **空间节点 ✅ 已完成**（2026-08-07）：核心块 `node { x; y }`（坐标
   常量校验 + core/node lowering + 内核收集），moveTo 支持 node 目标
   （2D 距离/速度）。
   **path 网络 ✅ 已完成**（2026-08-07）：`path { node1; node2 }` +
   Floyd-Warshall 全对最短路径，moveTo 沿网络位移（三角形差分测试）；
   `examples/move_route.lp` 为三段网络示例。
   **service 任务抢占 ✅ 已完成**（2026-08-07）：enablePreemption +
   taskMayPreempt + taskPreemptionPolicy 驱动高优先级打断运行任务
   （outPreempted 退出）；`examples/task_preempt.lp` 冒烟。
   **DES 计划所列全部项完成**：23 块内核语义 + 表达式/属性/排队四模式/
   抢占（队列与任务）/超时/测量/空间节点与网络/AI 模板/IDE 属性编辑。
   **Presentation 矢量编辑器 Phase 1–2 ✅ 已完成**（2026-08-06）：拖入的表现层
   形状升级为真正的矢量对象（`ModelNode.presentation`，几何/样式/旋转/缩放），
   支持选中框 + 8 向缩放 + 旋转手柄、Figma 式 Inspector（位置/尺寸/旋转/
   fill/stroke/strokeWidth/opacity/文字），全部走现有 undo/redo；画布文件升
   v3 持久化形状（`presentation/main.canvas.json` 的 `shapes`）。
   **Phase 3–4 ✅ 已完成**（2026-08-06）：文字双击内联编辑、图片嵌入
   （文件 → data URL 持久化）、Ctrl+C/V/D 复制粘贴、方向键微调、Esc 取消、
   Shift 多选 + Ctrl+G 分组 / Inspector Ungroup、对齐（Inspector 6 向）、
   置顶/置底（Ctrl+] / Ctrl+[ 与 Inspector）。待办：图层面板、动画绑定 API。
   **Phase 0：Vector Graphics Engine 数据模型 ✅ 已完成**（2026-08-06）：
   拆除「组件类型」抽象（rect/roundedRect/oval 不再是独立 kind 语义），
   对象模型统一为 `GraphicNode`（shape + geometry / text / image / group /
   path），圆角是 rectangle 的 `radius` 属性；transform 增加 skew；style
   升级为 fill（solid/渐变）/ stroke（dash/join/cap）/ shadow / blur；
   旧画布 v3 对象经 `normalizeGraphicNode` 自动迁移。渲染器支持渐变填充与
   阴影/模糊滤镜，Inspector 增加 radius/渐变/阴影/模糊编辑。
   **Phase 5：Simulation Binding ✅ 已完成**（2026-08-06）：图形对象的
   width/height/opacity/x/y/rotation 可绑定运行时表达式（安全算术求值器，
   变量 queueLength/busy/servers/downServers/tick），渲染时叠加、不改存储
   对象；Inspector 提供绑定编辑。绑定变量扩充（2026-08-06）：新增
   throughput / meanWait（来自 counters 帧）。
   **Phase 4：Frame + Auto Layout ✅ 已完成**（2026-08-06）：新增 `frame`
   容器节点（背景/裁剪/内边距/水平垂直自动排布，`computeFrameLayout` 纯函数
   可测），渲染时按 layout 摆放子对象并按内容自适应尺寸；Inspector 提供
   clip/padding/direction/gap 与增删子对象。
   **Phase 3（部分）：Boolean 运算 ✅ 已完成**（2026-08-06）：形状（矩形/
   椭圆/多边形）转多边形后用 polygon-clipping 求 Union/Subtract/Intersect/
   Exclude，结果落成 path 节点；多选 ≥2 时 Inspector 提供四个布尔按钮，
   可撤销（路径命令为局部坐标，渲染不双重平移）。
   **Phase 3（收尾）：Pen 工具 + 路径节点编辑 ✅ 已完成**（2026-08-06）：
   画布左上 Select/Pen 工具切换；Pen 模式下点击加锚点、Enter 结束、Esc
   取消，草稿实时预览；路径节点选中后可拖动/双击删除锚点（`path.ts` 提供
   可测的命令解析/改点/删点）。
   **Phase 4（收尾）：Constraints ✅ 已完成**（2026-08-06）：非自动布局的
   frame 子对象可设 left/right/center/scale × top/bottom/center/scale 约束，
   以 frame 的 baseSize 为基准随容器缩放/位移（`computeFrameLayout` 可测）；
   Inspector 的 Frame 区新增子对象列表（兼作基础图层）。
   **流程块语义字段 ✅ 已完成**（2026-08-05）：按 AnyLogic 属性表补全新块的
   Properties 与 DSL 字段——delay(time,capacity)、split(copies)、combine
   (agents)、batch(size,permanent)、seize/release(resource,quantity)、
   wait(capacity,maximumCapacity)、hold(freeze)、selectOutput(probability)、
   moveTo(node)、timeMeasureStart/End(measurement)、assembler(parts)；
   新增 `bool` 字段类型（Properties 复选框，DSL 输出 true/false）。内核
   五块保持 process.lplib 绑定以继续编译。
   **桌面客户端（Tauri）✅ 已完成**（2026-08-05）：新增 `app/server.mjs`
   生产后端（托管前端构建产物 + AI 端点 + 按需拉起 lp-server 空闲端口，
   与 vite dev 共用 ai-endpoint 处理器）；前端启动经 `/api/config` 解析
   网关地址（dev 回落 8089）；`desktop/src-tauri` Tauri 壳（Rust main 拉
   起 app server 并打开 WebView2 窗口，含 Windows 图标）；`desktop/README.md`
   含构建/运行说明。打包分发（`tauri build` 产物 + 捆绑 Node/lp-server
   二进制）为后续项。
   **桌面自定义标题栏 ✅ 已完成**（2026-08-05）：无边框窗口
   （`decorations: false`）+ 顶栏内嵌最小化/最大化/关闭按钮（Tauri 环境
   下渲染，`@tauri-apps/api` 控制窗口，capabilities 授予 window 权限）；
   顶栏空白区作 `data-tauri-drag-region` 拖动窗口；搜索框保持居中与可
   交互；浏览器模式不渲染这些控件（无回归）。修复 Rust 读完端口即关
   闭子进程 stdout 管道导致服务自毁的问题（改为后台线程排空 + 退出时
   kill 子进程）。
   **桌面窗口控制修复 ✅**（2026-08-05）：外部 URL（http://127.0.0.1）下
   Tauri ACL 按 URL 作用域拦截窗口 IPC（报错 `allowed on [URL: local]`）
   ——改为窗口加载**打包资产**（`tauri://localhost`，local 域放行 IPC），
   Rust 注册 `app_config` 命令把 app server 的 http 基址与网关 ws 地址交给
   页面；app server 的 /api 加 CORS；拖拽用显式 `startDragging()`。
   验收：拖拽拼出 mm1 等价模型并 `lpcli compile` 通过；浏览器 E2E 覆盖。
   入口：`web/apps/ide/src/`、`web/packages/editor/`（预留包，已从仓库移除占位）。

8. **逐环节瓶颈归因**
   现状：`ai-explain` 只给池级指标（利用率/可用性/等待占比）。
   范围：内核按 stage 输出指标（服务台利用率、队列占用）→ 扩展 F2 或摘要 →
   `ai-explain` 升级为"Machine 3 利用率 98%、等待 40 分钟"级归因。
   注意：F2 为冻结契约，指标扩展需走冻结流程。
   入口：`kernel/src/devs/`、`kernel/apps/lp-server/wire_frames.cpp`、`scripts/ai-explain.mjs`。

9. ~~**v1 读取器/发射退役**~~ ✅ 已完成
   v1（`LPIR`）已全量移除：`schemas/ir.fbs`、v1↔v2 转换器、`--ir-version 1`、
   interop/TS 的 v1 绑定全部删除；loader/process 路径原生吃 v2。

10. **Method Runtime Layer（多方法仿真平台架构）**
    现状：kernel 被 Process Flow 绑架——`process_flow.cpp`、Queue/Service
    语义、IR 中 process 库解析逻辑全部内建在 kernel。目标是把 kernel 降级为
    “仿真世界”（只负责时间/事件/调度/生命周期），Process / Agent /
    System Dynamics / Statechart 变成同级方法插件（`docs/specs/method-runtime.md`）。
    **Phase 1（抽象隔离）✅ 已完成（2026-08-06）：** 新增 `kernel/runtime`
    （`SimulationMethod` 生命周期接口、`RuntimeContext`、`RuntimeManager`、
    `MethodRegistry` 插件注册表）与 `kernel/state`（`VariableStore` 跨方法
    共享状态）；新增顶层 `methods/process`（`ProcessRuntime` 包装既有
    QueueingFlowSim / ProcessFlowSim，注册为第一个方法插件，功能不变）；
    `build_replication_model` 改为注册表驱动（按 IR `SemanticsRef{library,
    block}` = method+component 解析并委托），kernel 不再含 process 专属降级
    代码；lpcli / lp-server 启动时 `register_all_methods()`；182 ctest 全绿。
    **Phase 3（Process 模块化 + 增量执行）✅ 已完成（2026-08-06）：** 引擎
    从 `kernel/src/devs/process_flow.cpp` 迁入 `methods/process/`，拆成
    `ProcessBlock` 契约 + SourceBlock/QueueBlock/DelayBlock/ServiceBlock/
    SinkBlock/GenericBlock（`methods/process/process_block.h`、
    `process_blocks.h`）；QueueingFlowSim 与 ProcessFlowSim 均改为增量
    reset/advance/metrics，`ProcessRuntime::advance(until)` 真正按仿真时间
    步进（切片推进与批量运行指标/事件序列逐位一致，新增 2 个对等性测试）。
    184 ctest 全绿。**Phase 4（第二种方法：Statechart）✅ 已完成
    （2026-08-06）：** 新增 `methods/statechart/`（`StatechartRuntime` +
    `StatechartReplicationModel`），IR 根块 `{library: statechart, block:
    statechart}` + `behavior` 表经注册表降级到 kernel 表驱动状态机并按仿真
    时间运行（Timeout 驱动、arrivals 限步、final_value 报告终态）；新增
    3 个测试，187 ctest 全绿。**SimulationKernel 驱动 ✅ 已完成
    （2026-08-06）：** `kernel/runtime/simulation_kernel` 统一持有
    clock/scheduler/handler 注册表/VariableStore，`run(config)` 按
    `resolve_method_names` 装配方法并**用一条共享事件队列驱动多个方法**（
    Scheduler 事件 → 对应 runtime 处理）；ProcessFlowSim/QueueingFlowSim/
    Statechart 支持外部设施模式（attach RuntimeContext），批量路径不变；
    单方法 kernel 驱动与批量逐位一致，process+statechart 多方法组合在单次
    运行中共享同一时钟；新增 4 个测试，191 ctest 全绿。后续：agent/SD
    拆方法库、DSL 状态图语法与跨状态机 Message 耦合、共享变量显式写入、
    合并 lp-server 流式驱动。
    验收：kernel 层禁止 include `methods/`；新方法=新目录+`SimulationMethod`
    子类+注册函数；不破坏 F1/F2 冻结契约。

### P2 — 扩展（远期）

11. **行业模型库**：制造（Machine/Robot/AGV/Warehouse）、物流（Truck/Route/Demand）、
    交通模板；以 `SemanticsRef` 库注册表形式交付（引擎注册表已就绪）。
12. **2D/3D 场景与可视化增强**：更多 2D 视图（人群/交通）、3D 数字孪生（Three.js/GLTF）。
13. **跨工具链确定性黄金值**：libm 超越函数跨 MSVC/clang 不保证逐位一致（评审 m4）；
    需自研位精确 log/sqrt 或把 bit-exact 限定为"同构建内"（文档已限定）。
14. **AI 自动优化增强**：多变量/GA 参数化、约束、目标组合；瓶颈归因深化。
15. **分布式/GPU/时间弯曲**：ADR-0006/0007 已明确推迟，接口预留（引擎注册表），不排期。

## 5. 推进方式

- 每里程碑以功能为单元，先改 `docs/roadmap.md` 状态再实现，实现后同 commit 更新。
- 涉及两个以上工作流的语义变更，先写契约规格（`docs/specs/`）再实现。
- 契约变更必须走冻结流程（F1/F2/F3，见 §3），不破坏 212 ctest 与前端测试。
- 服务端/CI 相关改动在本机验证：`cmake --build build/integration-dev` + `ctest`，
  前端 `pnpm build` / `pnpm test` / `pnpm docs:build`。
