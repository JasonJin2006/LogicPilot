# LogicPilot 大一统工程建模与仿真 Workbench 迁移计划

状态：**已批准，P1 最高优先级**（2026-08-23）  
范围：Workbench、文档与编辑器扩展、AI 建模、仿真运行时边界、SysML v2 首批接入  
相关：[`roadmap.md`](./roadmap.md)、[`dev-plan.md`](./dev-plan.md)、
[`specs/ide-layout.md`](./specs/ide-layout.md)、
[`specs/method-runtime.md`](./specs/method-runtime.md)

当前用户入口：[`SysML v2 外部模型可视化`](./guide/sysml-visualization.md)。

实现检查点（2026-08-23）：外部 `.sysml` 投影、专用关系画布、All/Structure/
Requirements/Behavior 聚焦、人工拖拽与 Properties 坐标调整、布局 Undo/Redo、
Project Outline、Document Contribution routing、布局侧车和 AI inspect/layout/view/
focus/move 工具已落地；完整 SysML
语法、官方模型 API、原生语义编辑和执行后端仍按下述阶段推进。

## 1. 产品定位

LogicPilot 的目标是**工程建模与仿真领域的可扩展 Workbench**，形态类似 VS Code：

- 对人提供统一且高质量的文件、模型树、编辑器、画布、属性、诊断、命令、实验、
  结果和 AI 交互；
- 对建模语言提供可注册的文档、语义、视图、诊断和 AI 能力；
- 对可执行模型提供时间协调、求解、checkpoint、replay、evidence 和联合仿真；
- 对无法或不应由 LogicPilot 原生实现的工程求解器提供正式适配边界。

“大一统”统一的是**生命周期、扩展契约、稳定身份、交互事务、跨工件关系和执行
边界**，不是强迫所有模型共享一种 `nodes + edges` 数据结构、一个画布或一个
`SimulationMethod`。

SysML、C4 等工程模型是 Workbench 的一等公民。C4 通常只有结构视图；SysML v2
既可只表达结构/需求，也具有 action、state、succession、trigger、clock、time slice、
calculation、analysis/verification case 等可执行或可求值语义。是否运行应由文档内
选定元素暴露的 executable facet 决定，不能按文档类型一刀切，也不需要为纯结构模型
伪造仿真时钟或空 runtime。

## 2. 必须纠正的现有边界

当前实现已有良好的 Workbench 外壳和 AI capability seam，但仍存在下列语义耦合：

- `ModelDocument` 被当作所有模型的统一 `nodes + edges` 表示；
- `container` 通过名称关联，不能作为跨文件、重命名和多视图的稳定身份；
- 模型树直接解析 `.lp` 并硬编码元素种类、图标、排序和菜单；
- Palette 使用固定 library union，画布直接识别 Process、Statechart、Controls 等；
- Process-oriented `validateDesModel()` 位于全局画布路径；
- `SimulationMethod` 同时被用作运行时生命周期接口和建模方法分类；
- `SemanticsRef.library` 同时承担方法、形式化和组件库职责。

迁移期间保持当前 UI 风格与已有 `.lp` 工程兼容，但不再把这些现状提升为平台级
抽象。

## 3. 目标分层

```text
Workbench Shell
  文件 / 标签 / 面板 / 命令 / 搜索 / 选择 / 撤销 / AI / 主题
        ↓
Document & Contribution Platform
  DocumentType / Editor / Outline / Properties / Palette / Diagnostics / AI
        ↓
Engineering Artifact Platform
  Stable ID / Typed Relation / Units / References / Version / Provenance
        ↓
Language & Modeling Extensions
  SysML / C4 / DEVS / Process / Agent / Statechart / SD / External formats
        ↓ optional
Simulation Composition & Runtime Platform
  Time contract / Ports / Variables / Clocks / Lifecycle / Checkpoint / Evidence
        ↓
Native and External Engines
  PDEVS / ODE / FMU / HLA / CFD / FEM / SPICE / HIL / learned simulator
```

上层文档可以没有任何运行时；下层运行时也可以由没有本地可视化编辑器的外部
artifact 提供。

## 4. 平台级数据边界

Workbench 核心只拥有最小文档和身份契约，不拥有各语言完整 AST 或元模型：

```ts
interface WorkspaceDocument {
  uri: string;
  documentType: string;
  version: number;
  dirty: boolean;
}

interface ElementRef {
  documentUri: string;
  elementId: string; // 稳定 ID，不依赖显示名称或数组下标
}

interface DocumentCapabilities {
  editable: boolean;
  diagnosable: boolean;
  aiAssistable: boolean;
  visualizable: boolean;
  providesExecutionTargets: boolean;
}

interface ExecutionTargetRef {
  element: ElementRef;
  semantics: string;
  backend?: string;
}
```

语言扩展拥有自己的语法树、语义索引和序列化格式。跨语言只交换稳定引用、公开
接口和类型化关系，不把 SysML、PDE、DEVS、Process 等内部细节压扁成最低公分母。

### 4.1 工程工件分类

```text
ArtifactKind
  architecture
  requirement
  simulation_model
  experiment
  dataset
  runtime_artifact
  result
  evidence
```

一个文档可以贡献多个工件类型。例如 SysML 文档可同时包含 architecture、
requirement 和 behavior 工件。

### 4.2 跨工件关系

建立独立的 Artifact Relation Graph，只保存跨文档关系，不取代语言内部语义：

```text
contains / depends_on / allocated_to / refines / satisfies / verifies
traces_to / simulated_by / executes / produces_evidence / deployed_as
```

目标链路：

```text
SysML Requirement
  --verified_by--> Experiment
  --executes-----> Simulation Model
  --produces-----> Result / Evidence
```

## 5. Workbench 扩展契约

第一阶段建立以下 provider registry；已有 UI 组件逐步降级为 host：

| 契约 | 平台职责 | 扩展职责 |
| --- | --- | --- |
| `DocumentTypeProvider` | 打开、保存、版本、dirty 生命周期 | 格式、解析、序列化、能力声明 |
| `EditorProvider` | 标签页、焦点、恢复、多视图 | 文本/图/表格/3D 等编辑体验 |
| `OutlineProvider` | 通用树、选择、展开、菜单 | 语义层级、图标、子节点、命令 |
| `PropertyProvider` | 通用属性宿主 | schema、读写、校验、可见条件 |
| `PaletteProvider` | 搜索、最近项、拖放宿主 | 元素目录、创建命令、上下文条件 |
| `DiagnosticProvider` | Problems/Console、定位、严重度 | 语法与语义诊断 |
| `DiagramProvider` | 相机、选择、吸附、路由、图层 | 节点/边语义、连接规则、视图投影 |
| `CommandProvider` | 命令发现、快捷键、上下文菜单 | 类型化编辑操作 |
| `RuntimeProvider` | 运行会话和能力协商 | 可执行 artifact 的 runtime adapter |
| `AIContribution` | 对话、审批、工具调用、diff | 语义上下文、工具、领域规则和解释 |

现有 Process 画布、Statechart、Presentation、Properties 和 Model tree 最终都通过
上述契约注册；核心 Workbench 不出现 `if (kind == process/statechart/sysml)`。

## 6. 编辑事务与多视图一致性

每个资源只能有一个权威 `DocumentSession`，但可以同时打开多个投影视图：

```text
DocumentSession
  text editor
  model outline
  structure diagram
  requirement trace view
  properties
  AI context
```

所有修改以类型化事务提交：

```text
propose edit -> validate preconditions -> preview diff -> commit
             -> unified undo/redo -> diagnostics -> refresh projections
```

禁止 AI、画布和模型树各自维护不可协调的“真模型”。`.lp`、`.sysml` 和未来结构化
文档可以选择 text-backed、structured-backed 或 external-backed session，但同一资源
在一个时刻只有一个 authoritative revision。

## 7. AI 作为一级平台能力

AI 不操作 DOM，也不默认修改 Process JSON。AI 通过活动文档动态发现扩展贡献：

- semantic context provider；
- read/query tools；
- typed mutation commands；
- diagnostics 与 quick fixes；
- build/compile/run tools（仅活动选择存在 execution target 时）；
- traceability、结果与 evidence 解释工具。

标准工作流：

```text
理解用户意图
  -> 查询活动文档/选区/依赖
  -> 生成类型化变更
  -> 展示结构或文本 diff
  -> 执行语言诊断
  -> 用户确认或按策略自动提交
  -> 可选编译/运行/验证
```

纯结构/需求模型可以在“诊断通过”处完成闭环；SysML behavior、calculation、analysis
或 verification target 与其他可执行模型一样，可继续进入运行、观察和证据闭环。

## 8. SysML v2：首批高优先级垂直切片

SysML 建模是明确的近期用户需求，优先级高于 C4、完整 FMI/HLA 编辑器和新的行业
仿真库。目标采用 OMG SysML v2；SysML v1/XMI 仅作为后续导入适配，不反向污染
核心模型。

### S0：最小 Workbench seam（P1-A，先行）

- `DocumentTypeProvider`、`OutlineProvider`、`DiagnosticProvider`、
  `CommandProvider`、`AIContribution` 的稳定接口；
- 文档可选择贡献 execution targets；任何编辑器不得假定整个文档都存在
  runtime/time；
- 稳定 `ElementRef` 与跨文档 relation store；
- 将现有面板注册和 AI capability registry 接到新的 contribution root。

验收：注册一个没有 runtime 的测试文档类型，无需修改 Workbench 核心即可获得文本
标签、Outline、诊断和 AI 上下文。

### S1：SysML v2 可用文本建模 MVP（P1-B，最高用户功能优先级）

- 注册 `.sysml` 文档类型和 SysML v2 文本编辑器；
- parser、增量语义索引、源码范围和稳定元素身份；
- 首批语义覆盖：package、part/item/port definition 与 usage、connection/interface、
  requirement、satisfy/verify/trace、action、state、analysis/verification case；
- 语法高亮、诊断、Outline、completion、hover、go-to-definition、find references、
  rename；
- 错误状态不覆盖最后有效 semantic snapshot；
- AI 工具：读取模型/选区/诊断，创建与修改 requirement、part、port、connection、
  trace，解释错误并生成经验证的 patch；
- SysML 文档不整体注册虚假的 `SimulationMethod`；可执行元素通过显式 execution
  target 选择 SysML semantic interpreter、LogicPilot lowering backend 或外部工具。

验收：用户能在 LogicPilot 新建和编辑一个多文件 SysML v2 项目，AI 可根据自然语言
构造结构与需求关系，错误有稳定代码和源码定位，修改支持 preview/undo/redo。

### S2：SysML v2 语义执行 MVP（P1-C，高优先级）

OMG SysML v2 将 semantic model analysis 或 model execution 明确列为展示 Semantic
Conformance 的方式；本阶段据此实现并声明一个受控子集，而不把工具自有行为冒充完整
标准覆盖。规范基线见
[`SysML v2 Language Specification`](https://www.omg.org/spec/SysML/2.0/Language/PDF)。

- 从 action/state/calculation/analysis/verification usage 显式创建
  `ExecutionTargetRef`；
- 首批解释/执行：表达式与 calculation、constraint 求值、action succession/control
  flow、assignment、state transition、事件与相对/绝对 time trigger；
- 参数、初始值、clock/time reference、观测量和停止条件显式配置；
- 支持的子集可由 SysML semantic interpreter 直接执行，或 lowering 到现有
  Statechart/DEVS/continuous runtime；外部分析通过 adapter 执行；
- 输出结构化 execution trace、diagnostics、result 和 evidence，并绑定模型 revision；
- 建立版本化 semantic-conformance matrix；未支持构造必须在启动前明确诊断，
  不回退为猜测语义。

验收：一个含 calculation、action succession、state/time trigger 的 SysML v2 模型
可以选择目标、运行、暂停/停止并获得可重复 trace；纯 requirement/structure 模型不
显示无意义的 Run。

### S3：SysML 多视图与图形建模（P1-D）

- 模型 Outline 和 Properties 由 provider 驱动；
- 首批视图：系统结构、内部连接、需求追踪、行为/状态；
- 同一 semantic element 在文本、树和多个图中共享 `ElementRef`；
- Diagram 只保存 viewpoint/layout，不复制语义模型；
- AI 可创建视图、整理布局、检查孤立需求和未连接端口。

验收：文本和图形双向修改指向同一 revision；关闭布局文件不会丢失 SysML 语义。

### S4：官方交换与仓库连接（P1-E）

- 对齐 OMG SysML v2 machine-readable abstract syntax / JSON Schema；
- 接入 Systems Modeling API 的 Project、Branch、Commit、Element 读取；
- 支持外部仓库 snapshot、diff、稳定引用和 provenance；
- 写回与完整标准 conformance 在兼容矩阵达标后单独启用，不伪称完整支持。

规范基线：[`OMG SysML v2`](https://www.omg.org/spec/SysML/2.0) 与
[`Systems Modeling API 1.0`](https://www.omg.org/spec/SystemsModelingAPI/1.0)。

### S5：SysML 与仿真的数字线程（P1-F）

- SysML part/behavior/analysis case 可绑定 LogicPilot simulation artifact；
- requirement 可绑定 experiment assertion；
- verification case 可启动实验或引用外部工具任务；
- result/evidence 反向链接到被验证 requirement 和模型 revision；
- AI 能回答“这个需求由哪个模型、实验和证据验证”。

## 9. 现有仿真编辑器迁移

SysML S1 不等待全部迁移完成。S0 后并行按以下顺序逐步包装现有能力：

1. 将全局 Process 校验迁为 `DiagnosticProvider`；
2. 将 Model tree 改为通用 Outline host；
3. 将固定 Palette library 改为 `PaletteProvider`；
4. 将 `ModelCanvas` 拆为 Graph Canvas Engine 与 Process/Statechart/Presentation
   `DiagramProvider`；
5. 以稳定 `ElementRef` 替代 name-based container；
6. 将 Properties 改为 schema/provider；
7. 将 `.lp` 文本、画布和模型树接入同一 `DocumentSession`；
8. 将 AI modeling tools 改为按活动文档动态发现。

迁移全过程保持现有视觉风格、快捷交互和 `.lp` 项目可用。

## 10. 仿真运行时层级修正

`SimulationMethod` 逐步重新命名/定位为 executable runtime adapter，不再表示完整
建模分类。SysML 文档本身不等于 runtime，但其 action/state/analysis 等 execution
target 可以选择解释器、lowering 后端或外部工具。目标注册边界分为：

```text
Modeling/Library contribution
  Process blocks / Statechart behavior / Agent organization / SysML

Formalism contribution
  DEVS/PDEVS / process-interaction semantics / automata / ODE-DAE

Runtime contribution
  DEVS executor / process optimized executor / continuous solver / external adapter

Execution policy
  sequential / conservative parallel / distributed / real-time
```

Process 当前 runtime 保留为兼容和优化路径，但 Process library 不再被描述为与 Agent、
SD 完全平级的顶层方法。优化路径必须能与参考语义进行可观察等价性测试。

## 11. 外部工程软件的一席之地

平台不原生重写 CFD、FEM、SPICE、多体、量子或所有专业求解器。它们通过统一运行
边界接入：

- artifact identity/version/digest；
- typed ports/variables/units/clocks；
- initialize/advance/exchange/observe/shutdown；
- checkpoint/restore/rollback 能力声明；
- FMI Model Exchange / Co-Simulation / Scheduled Execution；
- HLA federate、进程/RPC、WASM/native plugin、实时/HIL adapter；
- 外部编辑器或只读结果视图贡献。

不支持的能力必须显式声明为 false，协调器不得猜测或模拟不存在的语义。

## 12. 后续扩展顺序

在 SysML S1 可用后：

1. C4 作为第二个非仿真文档扩展，验证多层 architecture projections；
2. SysML S2 语义执行 MVP；
3. SysML S3/S4/S5 多视图、交换与数字线程；
4. FMI 文档、变量浏览和联合仿真配置；
5. Petri Net / BPMN / Modelica 等语言或连接器；
6. HLA、外部工程求解器、实时/HIL；
7. 3D/GIS/网格/场结果等专用 editor provider。

## 13. 架构门禁

- Workbench 核心不得 include/识别具体 formalism、library 或 SysML 元素种类；
- 没有选定 execution target 的编辑/诊断流程不得创建 runtime、clock 或 scheduler；
- 新文档类型必须通过 provider 注册，不新增全局 kind switch；
- 一个资源只有一个 authoritative revision，多视图只保存投影状态；
- 所有语义元素使用稳定 ID，显示名称不承担引用身份；
- 所有 AI mutation 使用类型化事务并进入统一 undo/redo；
- 图形布局与语义内容分离；
- 跨工件关系可追踪到文档 revision 和来源；
- 声称支持的 SysML 特性必须进入版本化兼容矩阵和 conformance test；
- 每个迁移切片保持现有 CTest、前端测试、构建和项目 round-trip 门禁。

## 14. 明确不做

- 不把所有建模语言塞进 LogicPilot `.lp` DSL；
- 不把所有文档压成统一 `ModelDocument`；
- 不要求整个 SysML/C4 文档实现 `SimulationMethod`；SysML 可执行元素通过显式
  execution target 接入 runtime；
- 不在 SysML MVP 阶段宣称完整 OMG conformance；
- 不为展示统一而丢弃语言自有语义；
- 不以重写所有工程求解器作为“大一统”的完成条件；
- 不在迁移期推翻当前前端视觉设计。
