# DSH 共创建模：逐任务执行单

日期：2026-09-21  
依据：[实施总计划](../architecture/dsh-modeling-cocreation-plan.md)。  
状态：所有正式任务尚未验收。原型存在不代表其中任一任务通过。

## 使用方法

1. 每轮只领取一个任务。先核实依赖的**验收证据**，再读该任务指定文件。
2. 把任务内的“实现”和“验收”分别做到位。遇到失败先修本任务，不跳去开发下一阶段界面。
3. 所有新增路径是计划位置；如已有相同职责，复用而非复制。包路径调整必须同步总计划与本清单。
4. 对外回复包含：完成了什么、测试了什么、哪些未验证。不可仅回复“基础框架完成”。
5. 当前任务通过后写入交接记录，下轮继续下一任务。一个任务可跨多轮，不为结束对话而把它标记完成。
6. 所有运行从 Windows 仓库根开始。原生修改必须使用根 AGENTS.md 指定的 Windows build 脚本。

### 测试入口约定

T01 建立 `integrations/dsh/scripts/verify.mjs`。命令形状为：

```powershell
node integrations/dsh/scripts/verify.mjs --task T01
```

**该命令目前尚不存在。** 实现后必须枚举支持的 task；未知或尚未实现任务返回非零并说明，不得空跑返回成功。逐任务命令实际运行对应测试套件，不能只打印 PASS。浏览器与真实 provider 验收另保存证据，不伪装为离线测试。

其他已存在的入口，执行时核对 package scripts 后使用：

```powershell
node scripts/gen-contracts.mjs
node scripts/check-contract-conform.mjs
./scripts/windows-build.ps1 -Preset windows-msvc-dev -Test
```

变更 CMake 时按 AGENTS.md 增加 `-Configure`。不要因纯文档或纯 DSH client 修改运行整套 C++ 清理构建。

## 任务状态表

验收证据用相对链接指向日期化记录；不能只勾选。

| 任务 | 依赖 | 实现 | 验收 | 证据 |
|---|---|---|---|---|
| T00 现状与能力盘点 | 无 | 未开始 | 未验证 | — |
| T01 宿主适配最小切片 | T00 | 未开始 | 未验证 | — |
| T02 项目、模型与事务 | T01 | 未开始 | 未验证 | — |
| T03 原生执行接入 | T02 | 未开始 | 未验证 | — |
| T04 从空项目生成 | T03 | 未开始 | 未验证 | — |
| T05 人机共创基本闭环 | T04 | 未开始 | 未验证 | — |
| T06 仓储领域与搬运语义 | T05 | 未开始 | 未验证 | — |
| T07 空间共创与运行投影 | T06 | 未开始 | 未验证 | — |
| T08 规则调度与对照实验 | T07 | 未开始 | 未验证 | — |
| T09 决策边界与记录 | T08 | 未开始 | 未验证 | — |
| T10 Jev 提供方 | T09 | 未开始 | 未验证 | — |
| T11 决策检查、重放与反事实 | T09；真实 Jev 案例需 T10 | 未开始 | 未验证 | — |
| T12 非模板化与第二领域 | T11 | 未开始 | 未验证 | — |
| T13 打包、安装与迁移验收 | T12 | 未开始 | 未验证 | — |
| T14 专用模型训练闭环 | T13、可用标签数据 | 未开始 | 未验证 | — |
| T15 真实资产替换 | T13 | 未开始 | 未验证 | — |

T10 真实 API 缺权限时，可先完成 T11 的规则提供方分支，但不得标记 T10 真实验收完成。

## T00 — 现状与能力盘点

**目的**：确定哪些是真能力、哪些是计划或原型，避免接手者误用不存在接口。

读：根 `AGENTS.md`、`docs/README.md`、`docs/architecture/current-state.md`、`docs/architecture/execution-session-gateway-plan.md`；再读总计划 §2 的实际文件。

执行：

1. 记录 git HEAD、工作树差异摘要及禁止覆盖的改动。不把所有变更归为本任务。
2. 读取本机 `dsh --version`、实际可执行路径与当前包解析关系；记录测试 profile 名，不复制 API keys。
3. 用代码和小型运行探测列出能力：批量原生运行、流式运行、pause/resume、eventStep、cancel、checkpoint、fork、navigation、shared resource、decision barrier。
4. 对每项标记 supported / partial / absent，并附文件、测试和限制。声明字段不是支持证据。
5. 对 Artifact Store、ModelPatch、场景投影列出可直接复用和需提取的依赖。

产物：`docs/maintenance/dsh-coCreation-baseline.md`；记录 native 缺口进入后续任务，不编造“全支持”。

验收：另一个执行者能凭该文件找到二进制、跑一个小模型、辨识未实现能力；不得修改用户模型或安装新版本。

## T01 — 宿主适配最小切片与契约冻结

**目的**：证明外部包能以 DSH 正常机制挂载真实领域服务，建立后续可验证的路径。

改动范围：`integrations/dsh/packages/bundle`、`project` 的最小骨架、测试/构建脚本；必要的增量 Schema。

实现：

1. 建立可独立构建的包配置，显式依赖和 lockfile；不扫描工作区 `.pnpm` 目录寻找构建器。
2. 用 Cordis 注册一个真实的项目读取服务；通过公开的 Host/Client 通信在 DSH slot 显示实际 fixture 项目名称。
3. 查明并验证外部包的严格 Remote codec 生成/注册路径；记录版本。若外部 generator 不可用，先通过公开 exact Fetch 路由加严格 schema 验证完成试验，记录待迁移，不伪造 Typert 装饰器。
4. 测试 dispose、重装、配置更新；客户端失去服务时显示缺失状态，不能保留可写的过期按钮。
5. 冻结总计划 §4 最小字段和服务名。只定义接下来 T02/T03 使用的部分，其余为明确后续扩展。
6. 建立 `verify.mjs --task` 入口和本机安装审计，不向产品 UI 输出内部构建细节。

验收：干净测试 profile 安装/卸载真实外部包；服务读取与页面一致；宿主官方包版本未变化；缺依赖给明确信息；没有改 DSH 源码。

禁止：只做一个 hello-world 文本就认为架构完成；把旧面板全复制后改包名；在所有测试里 mock DSH。

## T02 — 项目拥有模型；统一变更事务

依赖：T01。改动入口：Artifact Store、ModelPatch、`packages/project`、必要 schema。

实现：

1. 映射 DSH workspace 到稳定 Project；创建空项目和 artifact。一个模型可被两个会话引用。
2. 提供 query/propose/validate/commit/undo；复用已有 Artifact Graph/CAS/锁/原子写，不另建 JSON 模型库。
3. 操作最低支持 add/remove、typed parameter、connect/disconnect、transform；对象使用稳定 ID。
4. 记录假设 provenance；需要运行的参数缺失时返回结构化诊断。
5. 重复 requestId 返回原提交；同 ID 不同内容冲突；base revision 过期冲突。
6. UI 命令和 AI 工具调用同一命令入口；一次批量操作只创建一个逻辑事务。

验收：跨两会话修改同一对象触发 409/结构化冲突；重启后同一 revision 可读；删除被引用资源失败且未部分提交；撤销产生新 revision；无绝对路径逃逸。

小型 fixture：空模型→source/queue/service/sink→修改 service time→撤销。此处无需仓储完整实现。

## T03 — DSH 接入已有原生执行服务

依赖：T02。入口：`execution-service.ts`、target registry、native provider、session-host、supervisor。

实现：

1. 用 Cordis 包装同一个 ExecutionService，注册真实 native provider。
2. 从 artifact revision 闭包物化/编译，不接受与 pin 无关的旁路模型字符串。
3. DSH 通过统一 start/status/command/subscription 操作；Agent 与面板得到同一 runId。
4. 保存终态、指标和 trace 引用；运行重连使用 seq/gap/baseline。
5. 实现有界取消、错误归档、进程退出检测。能力未支持时隐藏对应控制并给出原因。
6. 至少一个手算模型通过原生内核运行，验证 JS 原型没有被调用。

验收：模型改版不污染已启动 run；同请求幂等；编译失败返回 diagnostics；cancel 不排空全部未来事件；刷新网页能继续观察；进程崩溃不显示 completed。

停止条件：原生接口缺乏所需状态时，先补 provider/runtime 和相应测试；禁止换回 `integrations/dsh-des/src/simulation.mjs`。

## T04 — 从空项目与自然语言生成可运行模型

依赖：T03。入口：`packages/modeling`、能力描述、RequirementsBrief 和假设契约。

实现：

1. 注册需求理解、capabilities 查询、局部建模和实验工具；上下文按任务提供。
2. 按总计划 §5 的状态机保存进度和中间 artifact。
3. 引导 DSH LLM 生成 brief→组合方案→局部操作→校验→编译→试跑。不要另写一套通用 Agent loop。
4. 自动修复上限 3 轮；取消/冲突/缺能力保留草案并返回具体诊断。
5. 对必要缺失信息提出简短问题；可逆参数先记录假设。明确给定值不得被模板默认值覆盖。
6. 不支持“多楼层电梯、机械臂动力学”等要求时说明缺失，不能降成普通 delay 后隐瞒。

验收：

- 空工程输入两种不同规模的简单产线需求，生成不同对象数/参数/拓扑并真实运行。
- 已给定值、未确认值、默认值能区分；保存并重启后仍保留来源。
- 至少一次真实 DSH LLM 工具调用链有会话与 run 证据；离线 fixture 单测不能替代真实生成验收。
- 没有凭据时明确标注 live 验收未完成，不影响离线测试通过与诊断。

## T05 — 首个人机共创闭环

依赖：T04。入口：`packages/workbench`、modeling 上下文、现有 canvas/scene3d。

实现：

1. DSH 右侧模型文档打开/关闭；复用主题、locale、tab/slot、分屏与全屏。
2. Flow 与初始 3D 展示同一 artifact。选择、参数编辑、2D 排版和3D transform 命令接入 T02。
3. 当前选择和 revision 进入 Agent 上下文。测试“把这个工位的处理时间改成 20 秒”。
4. 展示 AI 局部提案和诊断；接受/修正/撤销贯通；UI 正在编辑草稿时收到外部修改不得静默丢草稿。
5. 统一 Run 按钮和 AI Run 工具；回放来自原生结果。
6. 将原型数据作为可选只读导入源，生成新项目 artifact；导入不删除原文件。

验收演示：空项目→LLM 建模→选择 service→自然语言修改→人工移动/修正→提交→原生运行→看到真实结果→撤销→重启恢复。

**通过此任务才可称 M1 完成。** 首轮可以没有搬运车、Jev 或 GLB，但不能只有静态面板。

## T06 — 仓储领域包与真实搬运语义

依赖：T05。入口：领域定义/validator/lowering、process 方法、导航/资源运行时。

实现：

1. 定义订单、任务、搬运车、工位、货架区、路径、资源；capability registry 能描述并生成它们。
2. 路径长度由空间图计算；定义 distance/speed 运输模型和装卸时间，禁止沿用演示动画固定时间。
3. 实现总计划 §7 状态机及路段容量/预约；具备相同 simTime 的确定性仲裁。
4. 不可达任务、无车辆、资源不足、死锁/无进展都返回真实诊断。
5. 必要时补 C++ process/navigation/decision hook；遵守 native build 门禁。

验收：一车一任务手算时间；两车同路段互斥；重复派单拒绝；取消释放占用；关闭通道不穿越货架；W1–W5 数据均可构建。

禁止：仅在 Three.js 中插值移动盒子，内核仍按固定 delay 算时间；从模型名字识别专用 warehouse 算法。

## T07 — 空间人机共创与运行投影

依赖：T06。入口：空间契约、scene3d、workbench、选择服务。

实现：

1. 显式坐标转换和尺寸约定；量尺、边界、通道宽度、可达性检查。
2. AI 布局意图变成候选 transform 操作；约束检查后预览；人可拖动修正再提交。
3. 视觉 mesh 与 footprint/导航分离，保留 stable objectId。
4. 3D 显示车辆、货物、工位占用；Flow 显示相应资源/队列；同一 run/time cursor。
5. 缺 trace/gap 的行为明确；清理 GPU、监听、订阅；切换对象不重建整个场景。

验收：移动工位确实改变合法路径和运距（distance/speed 模式）；仅拖 Flow 排版不改变运距；反向/L 形路径坐标正确；边界外拖动失败且可恢复；分屏选择和时钟同步。

## T08 — 规则策略和实验比较

依赖：T07。入口：实验契约、execution、领域调度策略。

实现：

1. FIFO、最近可用车、加急优先，作为可替换策略而非三套运行器。
2. 固定 model revision 和 exogenous sample streams；明确非抢占默认。
3. 支持重复运行、warmup、统计窗口、指标定义与对照表；保留每次 replication。
4. LLM 报告工具读取真实比较结果与假设，禁止自己算未经验证的提升数字。

验收：5 个独立种子的两策略对照；同种子同策略可重放；额外策略采样不改变外生到达；报告可追溯到 run/metric。

禁止：测试断言“智能策略一定赢”；只有一次成功动画就宣称优化有效。

## T09 — 通用决策请求、动作验证与记录

依赖：T08。入口：decisions 插件、运行时 decision barrier、契约。

实现：

1. 将规则策略接入统一 DecisionRequest/DecisionRecord；先验证本地提供方。
2. 候选含稳定 actionId，硬约束筛选在请求前，状态版本复验在应用前。
3. 原生运行在指定事件处暂停；异步返回后稳定排序、原子派单；取消会取消待决请求。
4. 超时、无候选、非法候选、过期结果和 provider 异常各有失败/fallback 行为。
5. 记录输入 digest、版本、实际动作与结果；日志有界、可分页。

验收：延迟、乱序、重复返回不导致双重占用；录制→重放相同 trace；没有提供方时明确 unavailable；禁用提供方不能偷偷回到另一个策略。

## T10 — 真实 Jev 提供方

依赖：T09。入口：可选 `decision-jev`，DSH 凭据/设置机制。

实现：

1. 核对官方当前 SDK/API、模型 ID、端点和 typed question 限制，记录链接与日期。不凭聊天示例编造 API。
2. 通过宿主凭据能力读取已配置凭据；UI/模型上下文/trace 不含密钥。
3. dispatch observation 包含已计算距离/预计时间/约束；Choice 选择 actionId；保留未知/等待/升级选项。
4. 明确 API timeout、取消、最大调用数、重试次数、预算上限。类型不合法立即拒绝，不交由 LLM 修成可执行动作。
5. 配置低置信度策略，默认与规则基线比较；阈值状态标记“未校准”直到有验证集。
6. 真实结果记录提供方/版本，避免 `latest` 别名用于可复现实验。

验收：小规模 live 请求真实进入原生派单；请求数和费用/估计有记录；API 失败行为可见；重放不再收费；删除/缺少 key 时规则策略仍可用。

无访问权限时交付 adapter、offline 契约测试与失败诊断，状态标记 live 未验证，不能宣称 M3 已完成。

## T11 — 决策检查、重放与反事实实验

依赖：T09；含 Jev 的场景需要 T10。

实现：

1. 时间轴定位决策，选中车辆或任务查看 observation/candidates/result/applied action。
2. 用户说“换成最近空闲车看看”，形成新的 ExperimentSpec，与原 run 建立 comparison 关系。
3. 若 provider 支持完整 checkpoint，验证恢复所有资源/事件/RNG/决策状态后才开放“从此刻分叉”；否则 UI 明示“从相同初始条件重跑”。
4. LLM 解释来源于可见证据，区分模型选择、硬约束拒绝与最终应用动作。
5. 重放不触发工具副作用或远程决策；数据缺口明确报告。

验收：可对同一决策列出合法候选；更换策略产生独立 run；旧 run 保持；断网也能回放已归档 trace；无 checkpoint 能力时没有假分叉按钮。

## T12 — “从零”泛化验收与第二领域包

依赖：T11。入口：fixtures、领域定义、生成/评价工具。

实现：

1. 建立固定评价 rubric：需求遵循、假设透明、语义正确、空间正确、可运行、可修改、证据可追溯。
2. 至少 6 条未见的仓储／产线需求，覆盖不同实体数、流程结构、空间约束和指标目标。测试时不给参考完整模型。
3. 增加维修服务站领域包，用同一项目/事务/实验/视图/决策服务生成请求、技术员、工位、备件流模型。
4. 再加至少 2 条不支持需求，验证诚实报告能力缺口；不能用简单队列假装已覆盖。
5. 保存 prompt、模型/提供方版本、生成过程、修复次数、最终诊断和 run。

验收：更换场景不修改公共服务核心；未见需求并非固定 JSON 替换数值；人工按 rubric 审核，失败案例保留；真实原生执行检查。

## T13 — 正式安装、恢复与原型退役

依赖：T12。入口：bundle、打包脚本、升级检查、文档。

实现：

1. 干净 profile 安装构建包，native sidecar 版本/平台检查，无源码绝对路径。
2. 必需服务/提供方的启动诊断：包来源、版本、缺口。官方 DSH 环境零源码改动。
3. 已完成结果持久恢复；在途运行按真实能力 interrupted 或恢复，UI 不谎报。
4. 卸载/禁用先阻止新请求、处理在途任务、清理客户端贡献，保留用户 artifact。
5. 提供原型 artifact 显式导入与报告。新链路通过后再取消旧原型 bundle 激活；源代码保留为历史参考或按明确清理任务处理。
6. 完成使用文档：从零输入、选中对象协作、运行对照、Jev 配置、支持范围、故障恢复。

验收：重复安装不重复注册；与用户其他插件共存；本机完整 E2E 录屏/截图与日志；原型 JS 引擎不在正式运行依赖图。

## T14 — 专用模型训练闭环（后续阶段）

依赖：T13，用户确定首个预测任务和可用标签来源。

实现：

1. 数据集 manifest、episode/时间分组 split、输入/标签来源；验证集和最终测试集分离。
2. 选择单一任务，如工单处理时长；先建立常数、传统特征回归基线。
3. LLM 提特征问题，Jev 特征化，训练下游模型；记录成本与版本。
4. 根据开发集误差迭代，最终测试集仅用于最终评估，不用于继续改提示词。
5. 权重作为 ModelArtifact，显式选择 prediction provider，再用仿真实验比较系统指标。

验收：真实训练产物可重新加载；保留集无泄漏；简单基线结果齐全；新模型未改善也如实记录；训练失败不影响旧模型使用。

## T15 — 真实 3D 资产替换（后续阶段）

依赖：T13。入口：资产 artifact、客户端导入、scene projection。

实现：本地 GLB 导入、digest、资源限额、单位/pivot/朝向设置、objectId 绑定、失败恢复；视觉替换不改变 footprint 或容量。不要支持未验证的“任意格式”。

验收：同一设备替换外观后原生结果不变；尺寸方向可校准；刷新恢复绑定；损坏/过大/外部引用模型明确失败；旧资产可撤销恢复。

## 每轮交接记录模板

在 `docs/maintenance/` 下创建日期化记录，至少包含：

```text
任务号：
开始时的 HEAD / 宿主版本：
本轮实际修改文件：
依赖证据：
实现的用户行为：
验证命令及退出码：
浏览器验证步骤和结果：
真实 provider / mock / 离线 fixture 的区分：
未完成能力及原因：
是否改动 DSH 源码（预期否）：
下一任务及必须先读的文件：
```

严禁把此模板填成无证据的“全部正常”。缺失执行环境、凭据或原生能力时，把具体阻塞写出来。
