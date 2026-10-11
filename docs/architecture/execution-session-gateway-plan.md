# 统一执行会话与 Gateway 收口实施计划

日期：2026-09-05  
状态：实施中（G0/G1 已完成，G2/G3/G4/G5/G6/G7 部分完成）。本文是持续执行任务书，不是已完成报告。  
核对基点：HEAD `debbac2` 加当前未提交工作树；只看该提交无法得到本文描述的全部实现。  
范围：画布运行、AI 实验、插件执行、原生实时会话、通信、运行设置、桌面打包与验收。

## 1. 给接手模型的任务指令

请按本文 G0～G9 顺序实施。每一步完成实现和对应验收，再更新进度，不要仅修改文案或增加接口占位就宣称完成。允许破坏性架构调整，迁移结束应删除被替代的生产执行路径，不要求长期兼容旧协议。

先读仓库 `AGENTS.md`、`docs/README.md`、`docs/architecture/current-state.md`，再核对本文引用的源码。当前工作树含大量未提交改动，必须保留；禁止 reset、checkout、覆盖整个文件恢复旧提交或无差别暂存全部改动。本文生成时没有实施运行时改造，也没有重新执行运行时全量测试；历史通过数字不能充当本次证据。

本任务目标：用户、AI 和自动实验通过同一个执行边界运行明确的模型版本。仿真使用统一的原生会话语义；WebSocket 承担实时传输，设置界面自动管理本地运行环境。

不要扩展到远程集群、云调度、协同编辑、插件商城、全新 Agent SDK、GPU 计算、全部范式编辑器重写。不要为了此任务另建四套按 WebSocket/Worker/批量/本地分类的会话系统。

## 2. 已核实的起点与必须注意的差异

| 当前入口/文件                                               | 当前职责                                                                      | 本次处理                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `web/apps/ide/src/client/simClient.ts`                      | 浏览器直接连接 `/sim`；JSON 命令、LPWR 二进制遥测                             | 由统一执行客户端接替；编码器可复用                |
| `web/apps/ide/src/state/connectionStore.ts`                 | 全局连接、compile→start 续接、运行状态、日志、多个方法遥测映射                | 拆分执行状态/订阅/日志/插件投影                   |
| `web/apps/ide/src/run/RunDialog.tsx`                        | 直接依赖上述 store；空画布可运行 served model                                 | 改为明确模型/实验目标及能力驱动控件               |
| `kernel/apps/lp-server/server.cpp`                          | 控制、编译、模型替换、原生运行、广播混合在一起                                | 抽出会话执行，删除重复业务分支                    |
| `kernel/apps/lp-server/sim_runner.*`                        | 旧流式运行驱动                                                                | 经等价性验证后退役；有价值优化下沉 runtime        |
| `kernel/include/logicpilot/runtime/simulation_session.h`    | 单 replication 持久世界，start/advance/finish/checkpoint                      | 复用并补齐有界推进与取消                          |
| `web/packages/plugin-host/src/execution-target-registry.ts` | 注册 target/provider，execute 返回最终 run/evidence，cancel 可选              | 保留权威注册表，补 admission/lease/session 能力   |
| `web/apps/ide/scripts/execution-endpoint.mjs`               | `/api/execution`；绑定 artifact 后等待最终结果；连接断开会取消 kernel request | 迁移成短请求创建和独立查询/订阅                   |
| `web/apps/ide/scripts/execution-artifacts.mjs`              | 从版本物化 DSL，保存 run/evidence 到 Artifact Store/outbox                    | 扩展成按编译器解析版本闭包；复用持久化机制        |
| `web/apps/ide/scripts/plugin-catalog-bridge.mjs`            | 可选启动 Node runtime，kernel service 桥接，kernelRuns AbortController 表     | 提取执行组合根，运行管理不继续堆入此文件          |
| `scripts/runtime-adapters.mjs`、`scripts/ai-build.mjs`      | 方法约束、DSL→CLI、结果检查、预算和取消                                       | 将业务入口汇入执行服务，底层编译/运行函数仍可复用 |
| `scripts/subprocess-supervisor.mjs`                         | 异步子进程、超时与进程树回收                                                  | 复用/扩展持久 sidecar 生命周期，不能退回同步执行  |
| `plugins/runtime/`、`scripts/build-runtime-plugins.mjs`     | 单方法及 generic mixed-method runtime 包及受约束打包                           | 补默认发行组合、Statechart/组合目标支持           |
| `app/server.mjs`、`desktop/src-tauri/src/main.rs`           | Node 服务启动独立 WS gateway，向前端注入地址/token                            | 统一应用连接；按需求启动执行进程                  |

已经确认的缺口：

1. `lp-server/server.cpp` 的 compile 分支明确拒绝混合方法模型，不能声称画布实时路径已完全统一。
2. `ExecutionTargetRegistry.execute()` 是等待结果的 Promise；没有完整实时会话 API。
3. `PluginRuntimeSession` 是绑定插件 generation 的权限凭证，绝不能拿来表示一次仿真运行。
4. 原生 `SimulationSession` 是一个 replication 的世界，不是一组重复实验的总任务；上层必须管理 replication 数量、seed 派生和汇总。
5. `SimulationSession.finish()` 会先 `advance(infinity)` 排空事件。取消时调用它会把“停止”变成“继续算完”，必须增加专门取消/中止清理路径。
6. `advance(until)` 返回前可能处理很多同时间戳事件；不能假设小时间片必然响应及时，也不能用改 horizon 伪装精确单步。
7. Node runtime 当前依赖 `LOGICPILOT_ENABLE_NODE_PLUGINS=1`、store/roots/lockfile 等配置。只把 Run 接到 registry 会导致默认安装没有 target。
8. 现有 ExecutionEvidence 把方法限制为 process/devs/continuous/agent，缺少正式 Statechart 和多方法 evidence 表达。
9. 当前 run 的模型版本、runtime 版本和实时帧关联还不足以承载并发、重连和热更新。

## 3. 目标分层与选定通信方案

```text
画布 Run / AI tools / 后台实验
                 │ 同一 ExecutionService
                 ▼
Node ExecutionService：准入、幂等、任务状态、结果归档、订阅
                 │ 从唯一 ExecutionTargetRegistry 获取 provider lease
                 ▼
执行 provider（声明能力；受插件权限及隔离约束）
                 │ native provider 通过受监督的私有 IPC
                 ▼
原生执行 sidecar → SimulationSession → 共享 clock/scheduler + 各 method runtime
                 │
                 └─ 遥测/诊断/终态 → ExecutionService → 画布投影、AI、Artifact Store
```

明确选型，避免接手者自己拼出另一套系统：

- 浏览器→Node：HTTP 创建、查询和控制；同一个 app-server origin 下的 WebSocket 订阅状态与遥测。HTTP/WS 使用同一鉴权边界。WebSocket 不必承载控制命令。
- Node→原生：受监督子进程的 stdin/stdout 分帧 IPC；stderr 为受限日志。原生实时引擎最终不需要自己暴露第二个网络端口。
- 优先给现有 `lp-server` 增加无网络的 session-host 模式并抽离 engine，避免同时造两套二进制；旧 `/sim` 仅在迁移期间保留。最终是否重命名可按 G8 清理。
- 首版每个活动原生 run 一个进程，replications 在进程内顺序执行；并发由服务端配额控制。先获得隔离和明确清理，暂不实现进程池。
- HTTP 以结构化 JSON 为主；遥测可保留 LPWR/FlatBuffers，但必须有明确版本与 run/replication/seq 封装。不要手改冻结 wire.fbs 后仍称旧 F2 兼容。
- 一次 run 可以 batch 或 animated；两者使用同一模型、算法与种子语义，只改变推进节奏和遥测采样。
- 不把执行搬进 React/UI 线程，不因“本地”而移除已有 Worker/WASM/native 隔离。

ExecutionService 是新增的任务管理职责，不是第二个 target registry，也不是插件业务解释器。Native provider 的 IPC 是私有实现；其他 ESM/WASM provider 不必经过原生 sidecar。

## 4. 必须冻结的语义

### 4.1 身份、模型版本和目标

- `requestId`：客户端幂等键，作用域为调用者/工作区；同键同规范化请求返回原 run，不再次执行；同键不同内容返回冲突。校验与占位必须在 provider 副作用之前完成。
- `runId`：服务端生成，贯穿命令、状态、遥测、取消和 evidence。
- `replicationId`：同一 run 下独立世界，遥测必须携带，不能跨 replication 复用动画基线。
- `artifactRef`：实际执行的明确 revision。Run 前由标准事务创建不可变执行快照；未保存编辑允许作为运行快照，不能暗中保存/覆盖用户文件。
- 对多文件模型冻结依赖文件和 imported artifacts 的版本闭包与摘要。禁止只取入口 DSL 字符串却读取磁盘上其他最新文件。
- 在 run 创建时冻结 target 定义摘要、provider/plugin id、版本、包 digest、generation、编译器版本、IR digest、有效参数及解析后的 seed。
- 缺目标时返回明确诊断，不能悄悄回退到通用 CLI 或网关示例模型。
- 当前 registry 将 provider 与 artifactRef 绑定。G1 必须明确“provider 可支持什么”和“本次具体模型 target”的关系：运行时不能被固定成只接受包 manifest 中一个演示 artifact；也不能删掉所有绑定校验。由可信目标解析器为当前模型生成并校验具体目标，复用唯一 registry 的 provider 身份。
- 静态 SysML/C4 文档没有执行 lowering 时不显示可运行；有明确 lowering/实验定义时才产生 target。

### 4.2 状态机与命令

公共状态建议固定为 `queued → preparing → running ↔ paused → finalizing → completed`，非终态可经 `cancelling → cancelled` 或进入 `failed`。资源释放前不得报告已取消；结果可靠记录前不得报告完整 completed。终态不可复活。

- `preparing` 包含版本物化、编译和 runtime 初始化。编译失败产生结构化诊断，无活动仿真世界。
- 命令包含 `commandId/runId/expectedStateVersion`；服务端按 run 串行处理，返回 accepted/rejected 与当前 stateVersion。重复 commandId 不得执行两次。
- UI 可显示“暂停中”，但只有 ack/状态事件确认后才标 paused。断线本身不是 failed/cancelled。
- pause 在有界推进结束后确认；resume 不重新初始化世界；stop 为取消，绝不排空全部事件。
- 首版 step 明确定义为一个共享 scheduler 事件；不能一个时间戳全部事件却标“一步”。若支持 advance-to-time，另设命令。声明不支持 event-step 的 provider 隐藏按钮。
- 仿真速度只影响 wall-clock pacing。批量速度不改变 replication 数、随机调用顺序、积分步长或结果。
- 预算明确区分调度事件数、模型逻辑步数、仿真时间范围、墙钟期限、内存与输出字节数。禁止把 arrivals 当所有范式统一步数。
- 墙钟期限从准入计时，包含排队/编译/暂停/运行/归档；各阶段只使用剩余预算，不重置。超期能回收子进程树。
- 一个 run 管理多次 replication；只在全部需要的 replication 和精度条件完成后 completed。保存实际使用的各 seed 和停止条件以便 replay。

### 4.3 持久化、连接、热更新

- 创建请求应迅速返回 runId；关闭 HTTP 响应或遥测连接只取消等待/订阅。AI 停止当前任务应显式取消其拥有的 run；不能取消同一项目所有运行。
- 将“创建 run”和“等待 run 完成”分离，现有断线自动 cancel 行为必须随迁移删除。相同鉴权主体重连可继续查询；断线不放宽访问权限。
- 服务启动恢复未终结记录时，先清理/确认旧进程；无法恢复世界则记录 failed/interrupted。绝不自动重新运行，checkpoint 自动恢复不在首版范围。
- 结果归档使用已有 outbox 幂等机制；计算完成而写盘失败保持 finalizing/归档失败可重试状态，不能重复执行仿真来重试归档。
- 活动 run 持有 provider generation lease。现有 beginDrain 目前统计 execute Promise，迁移后必须覆盖会话真正终结，否则 start 返回 runId 后更新会卸掉仍运行的 provider。
- 首版有活动 run（包含 paused）时普通更新/卸载返回 runtime-busy，拒绝应发生在改 lockfile 之前，不无限等待 drain。任务结束后允许重试。权限撤销/强制终止按明确授权先取消并回收，再切换；不得为旧 generation 自动延长失效权限。
- 暂不实现多个 generation 并存。回滚不能恢复已终结 run 或重复注册订阅。

### 4.4 遥测

- 帧封装至少关联协议版本、runId、replicationId、单调 sequence 和仿真时间；nanoseconds/大整数用无损表示，不能无条件转 JS Number。
- 会话状态/诊断/最终结果与可丢弃展示帧分开。订阅者缓慢时可合并 snapshot，但不能丢终态，也不能静默丢依赖前帧的 delta。
- 服务端保留有上限的重连窗口。客户端带 cursor 订阅；超出窗口发送 gap + 当前完整 snapshot + 对应 cursor，再接后续帧，避免快照和订阅之间漏帧。
- UI 丢弃旧 run、旧 replication 和已处理 seq；新 run 清理投影缓存。
- 高频遥测不逐帧写 Artifact Graph；运行记录、结果、必要 trace/evidence 才持久化。输出与缓存均有字节/条数上限。
- Shell 处理通用 run 事件；Process/Statechart/Agent/Continuous/DEVS 特定字段由插件的 telemetry projector 解释。禁止继续在通用 connectionStore 中扩充各范式分支。
- 保留现有队列徽标、实体动画、状态高亮、连续值和 DEVS 指标。不能用“协议统一”把这些功能丢掉。

## 5. 实施步骤与每步完成条件

每一步产生独立可审查切片；未通过只记录失败及证据。某步遇到缺失原生能力，补齐依赖后继续，不能以 stub 返回成功。新增路径命名是建议；如已存在同责模块，应复用并在进度记录写明实际路径。

### G0：基线盘点与差异清单

1. 执行 git status/diff，记录实际 HEAD、脏文件、现有可用构建入口，不擅自提交已有工作树。
2. 阅读第 2 节所有入口，追踪画布、AI run/optimize/sweep/explain、插件调用、CLI、桌面启动和清理。
3. 列出每种方法现有 batch/live 支持、暂停/步进/指标来源；单独列 Statechart、混合方法、native C ABI、WASM method 支持限制。
4. 运行与本任务相关的已有门禁，保留真实日志/退出码，区分基线问题与新增回归。
5. 建立 `docs/maintenance/execution-session-progress.md`，填本文末尾模板；先写一份目标协议 ADR，编号通过现有索引取下一个空号。

完成条件：每条旧执行入口都有去向；已识别测试和环境缺口；不把旧报告中的通过状态当新证据。

### G1：正式契约和 provider 协议

1. 在 `schemas/contracts/` 演进 execution 契约，补 run 状态、能力、命令/ack、订阅事件、模型版本闭包、provider pin、方法级 evidence。
2. RuntimeRef.kind 的 native/wasm 等实现类型与 process/agent 等建模方法分开；多方法 evidence 用 methods 列表/按方法命名空间，不能编造 runtimeKind=process。
3. 明确定义 run/execution-session 与 PluginRuntimeSession 的关联和区别，避免 sessionId 意义混用。
4. Provider 新接口建议 `start(context) → handle`；handle 提供 snapshot、subscribe、control、cancel、closed。closed 只在终态且资源释放后完成，便于 lease 计数。
5. 保留 execute 的短期兼容包装时，只允许它调用 start 并等待 closed/result。禁止 start 与 execute 分别跑两套算法。
6. 对破坏性字段改动进行版本提升与显式迁移，记录 `$id/schema/contractVersion` 及 consumers；按生成器支持子集使用命名 `$defs`。不手写重复 TS/C++ 类型。
7. 执行 `node scripts/gen-contracts.mjs`；逐项更新授权变更的 baseline 并记录差异。禁止整目录覆盖 baseline 或弱化检查只为变绿。

完成条件：TS/C++ 可解析并往返；未知版本/缺关键绑定/跨实体错配会拒绝；已有 schema consumers 已同步。

### G2：统一 Node ExecutionService

1. 在 Node 可用模块增加 ExecutionService 和 RunStore，模块位置建议 `web/packages/plugin-catalog/src/`；通用 provider 契约继续放 plugin-host/contracts。
2. 服务从唯一 registry 取 provider，执行准入、资源配额、幂等占位、run 状态持久化和 generation lease；不得另建静态 method→executor 旁路。
3. 将 execution-artifacts 的版本物化/结果归档接入服务；按文档编译器/lowering 贡献物化完整输入，不在 shell 统一调用 generateDsl 解释所有范式。
4. queued/preparing/cancel 竞态通过每 run 的串行队列与 stateVersion 处理；promise 拒绝、同步异常、超时都释放计数/lease。
5. 改 NodePluginRuntime 的 drain、更新、卸载：运行期间明确 busy，终结后才允许切换。按第 4.3 节处理权限撤销。
6. 批量 provider 可先桥接现有 runRuntimeModel 并将暂停/单步能力设 false。不要虚假暴露实时能力。

完成条件：同请求重试只执行一次；不同 run 隔离；取消排队任务无子进程；创建返回后仍保持 lease；重启对未完成任务给真实状态；归档重试不重算。

### G3：原生 SimulationSession 补齐实时执行语义

1. 修改 `simulation_session.h/.cpp`，加入有界 event-count 推进/单步及无排空的 abort/shutdown。
2. 时间片和事件数双重限界；同时间戳事件风暴仍能让控制层获得执行机会。单个 method 回调挂死由进程监督期限兜底。
3. 构建共享 run driver：一个 run 内创建/结束多个 replication 世界，使用统一 seed 派生、warmup、precision stopping、汇总/evidence 逻辑。
4. `SimulationKernel::run`、CLI 和实时 driver 尽可能复用同一 session/replication 驱动。不能只改 live 却继续留下不同 batch 语义。
5. 支持混合方法共享 scheduler；补 Statechart evidence 和 telemetry。把旧 SimRunner 中仍必要的数值/性能优化迁到对应方法实现。
6. 保留预算、trace、checkpoint 与方法异常传播。取消不调用 finish 排空；取消后的指标标记 partial，不能等同成功实验结果。

完成条件：分片推进与一次运行在相同种子/参数下等价；pause 后世界不前进；一步恰好一个定义的事件；resume 保持世界；stop 快速结束；多方法实时 run 成功；零时延事件风暴受限。

### G4：私有原生 IPC 与监督

1. 从 lp-server 提取运行服务，增加无网络 session-host 模式；先保留旧 serve 作为迁移入口，不再给旧路径加业务功能。
2. 冻结 IPC 的 handshake/version、初始化输入、控制、ack、遥测、终态。首版可用长度前缀 JSON；若复用二进制遥测，明确帧类型/编码。不得把 stdout 混用为普通日志。
3. 解析器处理半包、粘包、非法长度、未知类型、超限和 EOF；在分配大 buffer 前检查长度。编码/解码用两端一致的 schema 与 fixture。
4. 使用现有 supervisor 思路扩展持久进程控制，异步读取、有界输出、启动期限、总期限、取消宽限后 kill 整树。保留 Windows Job Object 或同等现有兜底。
5. 进程异常退出转换为该 run 的结构化失败，其他 run 和应用仍可用。cleanup 幂等，确认子进程退出后才释放运行配额。

完成条件：真实 Node→原生→session→遥测往返通过；协议不匹配 fail-fast；挂死/崩溃/取消树回收测试通过；输出压力不阻塞 Node 事件循环。

### G5：应用 HTTP/WS 适配器

建议路由：`GET /api/execution/targets`、`POST /api/execution/runs`、`GET /api/execution/runs/:id`、`POST /api/execution/runs/:id/commands`、WS `/api/execution/events`。若保留旧 `/api/execution`，只作为委托包装并在 G8 删除。

1. HTTP handler 仅校验、鉴权、调用服务和映射响应；业务不写进路由。
2. 创建返回 202 和 runId/snapshot；查询不存在/无权限/非法状态/预算不允许给稳定错误码。
3. HTTP 与 WS upgrade 都沿用 app-server 的 Host/Origin/session 校验；对 run/workspace 做访问校验。协议版本未知拒绝，错误不泄漏路径或 token。
4. 订阅实现第 4.4 节的 snapshot/cursor/gap/有界缓存；不要把所有 run 广播给所有页面。
5. HTTP 请求 deadline 只限制创建/控制操作；run 的 deadline 由 ExecutionService 负责。订阅断开不 cancel。
6. Vite 与 production 挂同一组 handler。生产用同源连接发现；不能新增默认 8089 fallback 绕开服务。

完成条件：命令失败不改状态；断网重连能恢复；重复 seq 不重放动画；慢客户端不造成无界内存；未授权订阅无数据；运行仍可被显式取消。

### G6：画布、AI 与可视化接入

1. 新建/复用中性 ExecutionClient、按 runId 存储的 executionStore。拆出 Console 通用事件存储，迁移其他 import，避免改一个连接模块牵扯全部功能。
2. RunDialog 从当前文档/实验解析 target，提交不可变版本快照，显示真实可用能力和参数 schema；消除 conn===connected 对所有执行操作的全局门控。
3. 删除“空画布跑 served model”；示例模型只有显式打开/选择后才可运行。不可执行范式给清晰原因。
4. 插件注册 telemetry projector，把现有 connectionStore 的方法字段解释迁出；共享 run store 不出现 mm1、continuous.value、state.active 等分支。
5. AIPanel 的 run/optimize/sweep 和需要执行的 explain 分析调用同一 ExecutionService；已有结果解释可只读。实验优化每个 evaluation 有自己的 run 和版本/seed 记录。
6. AI tool 可等待结果并显示进度；用户停止该 tool/实验组时显式取消其拥有的 run。多个工具同 requestId 重试必须幂等。
7. 复查 AI 错误/取消时的模型事务回滚：不得覆盖运行期间用户的后续修改；执行快照与当前编辑版本独立。

完成条件：真实画布和 AI 创建的 run 均可在统一列表/状态查询中找到；同输入结果对拍；不同模型并行不串帧；实时徽标/动画/高亮保留；旧 run 不污染当前模型。

### G7：默认本地运行环境与设置

1. 正常桌面启动配置应用数据目录内 PackageStore/ArtifactStore/RunStore，以及受信任 system runtime 包。缺配置返回明确不可用原因，不能要求普通用户填写 env 才能 Run。
2. 修改 runtime 包构建/安装流程，幂等追加/升级正式系统包；当前 buildRuntimePlugins 可写整份 lockfile，不得直接对用户 store 执行并覆盖已装插件。保留签名/摘要/权限审批边界。
3. 默认安装需具备 Process、Statechart、Agent、Continuous、DEVS 和已支持混合模型的目标解析能力；不能靠扩大 shell switch 实现。
4. 零插件模式仍有效：Shell 可编辑普通文件，运行环境显示无执行 provider；禁止悄悄启动内置模型补位。
5. Settings 的 Simulation gateway 改成“运行环境”，默认本机自动管理，展示就绪/正在启动/失败与诊断。高级信息才显示连接细节，远程尚未实现时不提供假选项。
6. 保留用户已经确认的 Settings 整体尺寸：桌面 `min(590px, calc(100vh - 48px))`，标题行 44px；Plugin Drafts 保留在 Settings→Extensions。
7. 本地运行启动动作按需拉起原生 sidecar；打开 IDE/纯建模不强制启动一个预置仿真世界。健康检查与仿真状态分开。

完成条件：干净应用数据目录、不配置开发 env，正式桌面与对应 Web 启动命令都能执行示例；第二次启动不覆盖用户插件/lockfile；无运行任务时没有多余 gateway 原生进程。

### G8：删除旧路径、同步文档与发行

1. 前述入口通过后删除旧 SimClient 控制接口、全局 pendingRunContinuation、网关 URL 用户配置、独立 native WS 服务业务分支和无用 SimRunner。保留被其他功能使用的日志/decoder/原生算法。
2. CLI serve 若仍是公开命令，明确迁移为统一服务入口或删除命令并给迁移说明；不能表面保留但继续走第二套运行引擎。CLI batch 可直接链接共享 native driver，不要求 CLI 经 HTTP。
3. 清理 LOGICPILOT_WS_URL/WS_PORT、Tauri app_config 字段、硬编码 8089、启动解析、旧 WS fixtures 与测试。只删实际退役内容，迁移后的订阅 WebSocket 仍需测试。
4. 更新 desktop stage 的文件清单、sidecar 构建、依赖 DLL/Node bundle 与 manifest hash；验证脱离仓库 node_modules 可运行。
5. 更新 docs/guide/web-ide、desktop、quickstart、cli、FAQ、current-state、IDE README、desktop README、性能预算和 ADR 索引。历史 ADR 注明后继，不能改成假历史。

完成条件：静态引用扫描没有生产旧执行旁路；官方启动命令与文档一致；stage 验收通过；保留的兼容包装每个有删除日期/阶段，最终不再承载业务。

### G9：最终验收及交接

按第 6 节完成真实集成验证，更新 current-state 与进度记录。若用户未明确要求提交，不替用户提交此前大批改动；交接列出本任务文件和基线文件，便于选择性审查。

完成条件：所有 MUST 验收有可复现命令、时间、退出码和日志；未测平台、未支持 provider 能力明确列出；没有把“测试进程消失”认作 PASS。

## 6. 验收矩阵（MUST）

| 类别           | 必测行为                                                             | 失败表现                              |
| -------------- | -------------------------------------------------------------------- | ------------------------------------- |
| 准入与幂等     | 同 key 重试、并发同 key、不同 payload 冲突、跨工作区隔离             | 多次启动或取到他人 run                |
| 版本           | 执行中修改模型/import、切 target、runtime 升级                       | run 引用/结果漂移                     |
| 会话控制       | preparing cancel、pause/resume、连续 step、终态 stop、重复 command   | 状态虚报、重复事件、死锁              |
| 原生一致性     | batch 与不同分片大小 animated 对拍                                   | seed/事件顺序/终态指标不同            |
| 方法覆盖       | Process/Statechart/Agent/Continuous/DEVS，至少一个真正耦合的混合模型 | 仅能独立跑不同方法，不能耦合          |
| 多 replication | fixed/random seed、precision stopping、取消中间 replication          | 种子丢失、计数错、partial 伪装完成    |
| 实时表现       | 队列徽标、实体动画、状态高亮、连续变量、DEVS counters                | 输出仅终态或渲染错误                  |
| 重连           | 断开/刷新→query snapshot→续订，超过缓存 window                       | 误取消、漏终态、delta 失配            |
| 并发           | 两个不同模型 run；只取消其中一个                                     | 全局 served model 替换、串帧          |
| 隔离与预算     | 同时间戳风暴、method 挂死、输出洪泛、进程崩溃                        | Node/UI 卡死、孤儿进程、无限缓存      |
| 插件生命周期   | 活动/paused run 时更新卸载、取消后更新、权限撤销                     | 提前写 lockfile、永远 drain、运行失联 |
| 持久化         | 结果写盘故障/重试、服务重启、runId 再查询                            | 重算副作用、假 completed、记录不一致  |
| 默认组合       | 干净安装、重启保留用户插件、无 provider 模式                         | 靠隐藏 env 或 demo fallback 才能运行  |
| 发行           | 独立 staged runtime、退出/强杀父进程                                 | 缺 DLL/模块，残留进程                 |

确定性对拍不能比较 runId、墙钟时间、遥测帧数和协议序列。比较模型/IR、有效参数和 seed、事件/evidence、最终方法状态与指标；浮点容差应按求解器和既有预算预先声明，不能失败后随意放宽。混合模型必须有实际跨方法变量或消息交互，不能用两个互不影响的孤立模型冒充。

命令入口以执行时 package.json 为准。现有应保留并按迁移更新的门禁包括：

```powershell
node scripts/gen-contracts.mjs
node scripts/check-contract-conform.mjs
./scripts/windows-build.ps1 -Preset windows-msvc-dev -Configure -Test
pnpm test:kernel-supervisor
pnpm test:execution
pnpm test:runtime-adapters
pnpm test:runtime-conformance
pnpm test:node-runtime-e2e
pnpm test:app-server
pnpm test:browser
pnpm test:paradigm-lifecycle
pnpm test:zero-paradigm
pnpm test:plugin-lifecycle
pnpm typecheck
pnpm lint:ci
pnpm format:check
pnpm build
pnpm test
pnpm desktop:stage
pnpm desktop:test-staged
pnpm docs:build
```

按切片选相关检查；最终跑完整门禁。Windows 原生构建必须用仓库脚本加载 MSVC 环境。Release/staged 所需构建预置按 stage 脚本核对，不能拿旧 Debug 产物冒充发行验证。运行服务器用动态端口和明确进程所有权；退出清理自己启动的进程，不按进程名杀全部 node。

建议新增 `test:execution-session` 与 `test:execution-session-e2e` 覆盖新的生命周期和端到端矩阵；命名与实现一同添加 package.json。不要为 CSS/文案增加镜像实现的单元测试，测试预算用于状态、版本、协议和真实执行。

## 7. 接手模型最容易犯的错误

1. 只把 Settings 改名，旧执行链路完全没动。
2. 新建第二个全局 registry，AI 走旧 CLI、画布走新接口，两边照样割裂。
3. 把 PluginRuntimeSession 权限令牌当仿真 session，或把一个 replication 当整次实验。
4. 创建了 runId 就释放 provider lease，热更新时把活动执行宿主卸掉。
5. stop 调用 finish，实际把模型算完；暂停通过 kill/restart 伪装。
6. 用 setTimeout 或小时间 horizon 声称能限制同时间戳无限事件。
7. “状态统一”仅映射几个字符串，没有处理取消/完成/超时/归档竞态。
8. 重连补帧无限缓存，或丢 delta 后仍在错误基线上播放动画。
9. model revision 固定了，但 imported 文件/runtime generation 没固定。
10. 为多方法在壳层新增 switch；把 phase-2 的结构化能力又写死回 UI。
11. 删除旧实时路径时把现有 Process 快速性能、Statechart 和实时徽标一并丢掉。
12. 为让默认 runtime 可用覆盖用户 lockfile、自动扩大权限，或仅在开发机配置 env。
13. 原生公开端口关掉了，但 AI/优化仍绕过统一 run 管理，无法查询和取消。
14. 让浏览器断线等于 stop，AI 取消却只 abort fetch，真正计算继续跑。
15. 生造新错误代码未入诊断契约，或吞掉根因只回 execution failed。
16. 直接改生成的 TS/C++，或者覆盖全部 baseline 把破坏性变更藏起来。
17. 重用历史测试数字；没取到退出码就写 PASS；把 headless 部分日志当完整 E2E。

## 8. 持续推进记录模板

本文计划步骤初始均为 TODO。实现进度单独写入 `docs/maintenance/execution-session-progress.md`，避免计划与实现状态混写。

```text
本轮阶段：Gx / 具体子项
起点：HEAD、已有脏改动摘要
已完成行为：用户或调用者现在能做什么
实际改动文件：相对路径 + 职责
契约变化：版本、字段、消费者、baseline 依据
验证：命令、时间、退出码、日志路径；说明 stub/真实原生/真实浏览器
失败与未测：失败原因、是否基线问题；不能隐藏跳过
待删除路径：剩余调用者与清理阶段
进程状态：自己启动的 server/worker 是否已清理；体验实例另列
下一步：准确文件入口、前置条件、验收条件
阶段状态：TODO / IN_PROGRESS / DONE / BLOCKED（需明确阻塞条件）
```

下一模型首个动作应是 G0 的基线核对，再实施 G1 的契约。不要从隐藏 Simulation 设置或删除 WebSocket 开始。
