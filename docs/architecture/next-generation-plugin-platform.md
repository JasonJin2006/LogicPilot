# LogicPilot 下一代插件、知识与 Agent 平台计划

状态：**下一阶段执行基线**

基线提交：`65444f3`（`feat: add cross-paradigm acceptance and harden modeling runtimes`）

适用范围：Workbench、AI Agent、知识系统、诊断、Canvas/View、Palette、方法运行时、插件创作与分发

迁移策略：**允许破坏性调整；不以长期兼容现有实现为默认目标**

## 1. 执行摘要

LogicPilot 下一阶段不再继续扩大“若干全局注册表 + 静态组合根 + 巨型 AI 提示词”的架构，
而是建设一个只有少量稳定核心、其余能力全部由插件组合的工程建模平台。

最终组合模型是：

```text
垂类知识 × 建模范式 × 表示方式 × 执行后端 × 用户权限
```

核心决策：

1. LogicPilot 不自建大模型；当前自建的是 Agent Harness。模型继续来自可替换 Provider。
2. 通用 Agent loop 不再被视为产品差异化能力。建立 `AgentEngine` 接口，以现有实现为
   baseline，引入成熟开源 SDK 后端对拍，达到门禁后可删除自建通用循环。
3. 深度借鉴 DeepSeek Harness/Cordis 的插件生命周期、服务依赖、事件、effect 自动清理、
   配置组合和 append-only trajectory；但不把 LogicPilot 变成 Harness 的皮肤。
4. LogicPilot 自己掌握 Artifact Graph、事务、信任、结构化知识、诊断、Canvas/View、
   建模语义、lowering 和仿真运行时。
5. Knowledge、Skill、Instruction、Tool、Diagnostic 是不同契约，不再统称为 prompt。
6. 2D、3D、流程图属于 Canvas/View；SysML、C4、Process、Agent 属于语义/范式。
7. Palette 归 Canvas Host 所有，其内容由当前 View、Notation、Domain、选择和权限动态生成。
8. AI 可以在授权下创建派生插件草稿，但不能直接覆盖已安装的可信系统。

## 2. 当前基线

基线提交已通过：

- Windows MSVC 原生门禁：496/496；
- Process、Agent、Statechart、Continuous、DEVS 和多方法组合：16/16 真实案例；
- IDE：344 项通过、1 项条件跳过；
- Node/TypeScript、typecheck、format、生产构建全部通过；
- lint 0 error，剩余 warning 是已登记的范式边界迁移债务；
- SysML AI 工具已经按当前文档作用域传给服务端，并与可信 capability 求交集。

后续任何阶段都必须保持或显式替换这组真实性门禁，不能用 mock 测试代替真实编译和运行。

## 3. 当前问题诊断

### 3.1 Agent

LogicPilot 当前自建了：

- turn/step 循环；
- 工具调用与结果配对；
- checkpoint、取消、重试和上下文裁剪；
- 审批、ModelPatch 事务和回滚；
- Provider 协议适配；
- capability、skill、MCP 和运行证据回灌。

其中工具事务、仿真证据和范式作用域是 LogicPilot 的领域能力；通用 loop、handoff、
guardrail、session、tracing 等与成熟 Agent SDK 高度重叠。

### 3.2 插件

当前插件机制已经有 document、diagnostic、palette、outline、panel、AI capability 等注册表，
但仍主要是：

- 编译期/打包期静态组合；
- side-effect import 注册；
- 前后端复制工具元数据；
- 无统一依赖图和生命周期；
- 无统一 effect cleanup、安装、升级、热重载和回滚；
- 无内容寻址 lockfile；
- 无 AI 插件草稿与信任流水线；
- C++ 方法、Web 扩展和知识资产没有统一包边界。

这套实现是合理的过渡层，但不是最终“一切皆插件”。

## 3.1 当前实现检查点（2026-09-03）

以下能力已经在主线实现并有对应 ADR/测试门禁：

- Phase 2B：分层 Plugin Host、PackageStore、lockfile CAS、动态 ESM/WASM、Worker/RPC
  隔离、细粒度 capability broker、结构化 contribution registry 和 registry SSE replay；
- Phase 3：FileSystem Artifact Graph、propose/validate/approve/commit/rollback，AI
  ModelPatch、source patch、SysML typed edit/layout、Save、simulation run/evidence 的
  revision 绑定；
- Phase 5/6：Canvas/ViewDefinition 扩展、View Planner、结构化 Knowledge/Skill/Instruction/
  Diagnostic Context Compiler、Builtin AgentEngine 和可选 OpenAI Agents SDK adapter；
- Phase 7：PluginDraft schema、权限/trust diff、持久化草稿、静态校验、Review UI、Ed25519
  签名、内容寻址 builder、PackageManager 安装和回滚门禁；
- builtin DES/SysML/Canvas wiring 已集中到 `plugins/builtin` seams，lint 门禁为 0 warning。

这些实现不等于所有生态能力都已完成。当前仍明确保留的工作项是：

1. 将 SDK adapter 的真实 provider 多轮/拒绝审批/生产 tracing 纳入 parity benchmark，并
   决定是否切换默认 AgentEngine；当前已完成可持久化 checkpoint、多轮恢复、IDE 宿主编排、
   metadata-only trace seam 和显式 JSONL trace sink，真实 provider parity 与生产保留/导出
   策略仍未通过门禁；
2. 将高频手工 layout/evidence 同步从异步补偿提升为严格可重试事务队列；当前已有浏览器
   outbox/FIFO drain、稳定幂等键、有界死信重试、ArtifactStore 跨进程 mutex/version check
   和 app-server durable outbox/recovery，独立 worker 进程与运维告警仍待完成；
3. 删除服务端旧 `ASSISTANT_TOOLS` fallback 和剩余兼容 facade（服务端静态工具表及 IDE
   modeling 工具别名 facade 已删除，测试 fixture 中的历史变量名不属于生产路径）；
4. Phase 8 capability 迁移：Process/DSL 与 SysML 已拆成独立 Agent capability 和只读变体，
   PalettePanel 已改为完全调用 contribution 的 insert/icon/port hook，完整插件贡献包、
   model semantic registry 已供 ModelStore/Outline/Mutation 使用，并由 DES plugin lifecycle
   注册/撤销 Process provider；SysML semantic dispatch 也已由 SysML plugin lifecycle
   注册/撤销，Statechart/Agent/
   Continuous/DEVS/C4 迁移和默认 provider 的最终插件化仍待完成；SysML semantic、model
   semantic 与 panel provider seams 已集中到 `plugins/registries`，并具备 lifecycle disposer，
   lint 直接范式 import 已清零；DES/SysML 已携带并注册结构化 View/Notation/CreateAction
   contribution 文件；
5. 完成插件 registry delta/replay 的长期存储、签名密钥轮换和外部 registry 发布；当前
   已将经契约校验的 replay history 原子持久化到 PackageStore 旁，并支持可选的 canonical
   snapshot 签名/轮换 keyring，并通过 authenticated `/api/config` 在 IDE 使用 WebCrypto
   校验；外部 registry 发布与远端密钥分发仍待完成。

## 4. 目标架构

```text
LogicPilot Shell
├── Plugin Host / Trust Runtime
├── Artifact Graph / Transaction Runtime
├── Composition Resolver
├── Workspace / Project / Event Log
├── AgentEngine Host
├── Execution Target Host
└── Generic UI Slots / Canvas Hosts
       │
       ├── Domain Packs
       ├── Paradigm Packs
       ├── Knowledge Packs
       ├── Skill / Instruction Packs
       ├── View / Notation Packs
       ├── Canvas Engines
       ├── Runtime / Lowering Packs
       └── Theme / UI Extension Packs
```

Shell 源码中不得识别 `process`、`sysml`、`agent`、`statechart`、`sd`、`devs` 或 `c4`
等具体范式 ID。Shell 只能处理注册契约、artifact、权限、事务和通用 UI slot。

## 5. 固定核心与插件边界

### 5.1 固定核心

只保留：

- 插件发现、依赖解析、激活、停用和隔离；
- 权限、审批、信任等级、签名和审计；
- Artifact、revision、关系图和事务；
- 工作区、项目、插件 lockfile 和迁移记录；
- 通用 command、panel、editor、canvas host；
- Agent turn/step/tool 协议和 AgentEngine 选择；
- execution target 调度和证据归档；
- 插件安装、升级、回滚和崩溃隔离。

### 5.2 全部插件化

- 范式元模型和语义；
- 垂类知识；
- DSL、解析器和语言服务；
- 验证规则、诊断解释和 fix；
- Skill、Instruction 和 Tool；
- View、Notation、Palette action；
- 2D/3D/流程图表示；
- glyph、属性编辑器和布局算法；
- lowering、解释器和 runtime；
- theme、图标、CSS token、扩展面板；
- 示例、benchmark 和 conformance matrix。

## 6. Agent SDK 策略

### 6.1 不整体替换，先建立后端接口

```ts
interface AgentEngine {
  runStep(request: AgentStepRequest): Promise<AgentStepResult>;
  resume(checkpoint: AgentCheckpoint): Promise<AgentStepResult>;
  cancel(turnId: string): Promise<void>;
}
```

首批实现：

```text
BuiltinAgentEngine       当前逻辑的收敛版本
OpenAIAgentsEngine       OpenAI Agents SDK 适配器
```

可以继续增加其他 provider-neutral engine，但工具执行、权限、artifact transaction 和
仿真证据始终位于 AgentEngine 外部。

### 6.2 SDK 可接管的内容

- 通用 agent loop；
- tool schema 和调用循环；
- handoff/agents-as-tools；
- guardrail；
- session 和 human-in-the-loop；
- streaming；
- tracing/eval 接口；
- MCP 接入。

### 6.3 LogicPilot 保留的内容

- Artifact revision 和事务；
- 用户审批后的原子应用；
- 编译失败后的产品语义；
- 范式工具作用域；
- 仿真运行和证据；
- 确定性重放要求；
- 插件权限和信任；
- 诊断到知识/fix 的绑定。

### 6.4 AgentEngine 对拍门禁

- 五范式任务成功率；
- 工具名和参数正确率；
- 审批拒绝和恢复；
- 取消、checkpoint 和 resume；
- 上下文裁剪后工具对不悬空；
- Provider 兼容性；
- token、延迟和失败重试；
- tracing 完整性；
- 同一事件流的重放一致性；
- 非 OpenAI Provider 的降级成本。

只有 SDK 后端稳定超过 baseline，才删除对应自建通用 loop。不得先删除再补功能。

## 7. DeepSeek Harness/Cordis 取舍

### 7.1 应借鉴或复用

- `apply(ctx)` 插件入口；
- 显式 `inject` 服务依赖；
- context-scoped service；
- event bus；
- effect 自动清理；
- 插件加载、卸载和热重载；
- 配置覆盖和组合；
- append-only session trajectory；
- Creator 模式的运行时检查和插件试验思路。

### 7.2 不直接交给 Cordis

- 跨 TypeScript/C++/WASM 的统一 manifest；
- 权限和信任等级；
- Artifact Graph；
- KnowledgeBlock schema；
- DiagnosticDefinition；
- Canvas/View/Notation；
- Runtime/Lowering；
- 工程 lockfile；
- 原生插件 ABI；
- 模型 revision、事务和 conformance。

### 7.3 推荐结构

```text
LogicPilot Plugin Manifest / Trust / Artifact Graph
                    │
          TypeScript PluginHostAdapter
                    │
        Cordis 或 Cordis-compatible Kernel
                    │
       services / events / effects / lifecycle
```

DeepSeek Harness 当前仍是 developer preview。先做隔离 spike，锁定版本并跑卸载、HMR、
依赖失败和内存泄漏测试；不能让业务插件直接依赖未经隔离的 Cordis API。

## 8. 统一插件包

采用 `.lppkg`，一个包可以贡献多类能力，不为每种贡献再发明独立插件系统。

```text
plugins/
  builtin/
    process/
      plugin.json
      knowledge/
      diagnostics/
      skills/
      notation/
      views/
      web/
      native/
      tests/
    sysml/
    agent/
    statechart/
    system-dynamics/
    devs/
    graph2d/
    scene2d/
    scene3d/
```

`PluginManifest v2` 至少包含：

- `id`、`version`、`apiVersion`；
- `provides`、`requires`、optional dependencies；
- Web/Node/WASM/native/data entrypoints；
- 请求权限；
- 信任要求；
- 配置 schema；
- artifact migrations；
- conformance tests；
- 内容摘要和签名信息。

`logicpilot.lock` 固定：

- 插件版本和内容摘要；
- 来源和签名；
- 权限 grant；
- 信任等级；
- 完整依赖解析；
- 工程/数据迁移版本。

## 9. Artifact Graph 与统一事务

Artifact 类型包括：

- semantic model；
- source document；
- view/layout；
- knowledge pack；
- plugin draft；
- execution target；
- experiment/run/evidence；
- diagnostic set；
- migration record。

关系包括：

```text
view projects semantic-model
runtime-target executes semantic-model
diagnostic validates revision
evidence produced-by run
knowledge applies-to paradigm/domain
plugin provides knowledge/view/runtime
```

所有 AI 和人工修改走统一事务：

```text
read revision
→ propose typed operations
→ validate
→ preview
→ approval
→ commit new revision
→ derive projections
→ compile/run
→ rollback/undo
```

ModelPatch、SysML typed edit、source patch 和 layout edit 可以保留自己的 operation schema，
但必须运行在同一个 revision/transaction/approval 协议上。

## 10. 结构化知识系统

### 10.1 KnowledgeBlock 类型

- `concept`
- `term`
- `relation`
- `constraint`
- `formula`
- `diagnostic`
- `fix`
- `workflow`
- `instruction`
- `example`
- `counterexample`
- `evidence`
- `visual-template`
- `transformation`
- `conformance-case`

公共字段：

```text
id / version / owner
classification / scope / applicability
dependencies / conflicts / supersedes
provenance / confidence
verification / localization
```

自然语言只作为展示和本地化层，不能是唯一语义载体。

### 10.2 公式

必须包含：

- Expression AST；
- symbol table；
- 类型和单位；
- 量纲约束；
- 假设和有效范围；
- 初始/边界条件；
- 推荐求解方式；
- 来源 equation 编号。

LaTeX/MathML 只作为展示格式。

### 10.3 图片和图表

保存：

- 原始资产和摘要；
- 来源、页码、figure 编号；
- caption；
- 区域标注；
- 元素和关系；
- 坐标系、单位、图例；
- 可恢复的数据系列或语义图；
- 无法结构化部分的显式标记。

### 10.4 论文摄取流水线

```text
论文/标准
→ 提取 claim、定义、公式和图表
→ 术语、单位和符号归一化
→ 映射 canonical ID
→ 检测重复、包含、冲突和适用范围
→ 生成 KnowledgeBlock draft
→ 生成正例、反例和验证用例
→ 人工/自动审核
→ 发布 KnowledgePack
```

AI 只能直接产生 draft，不能未经审核提升为 trusted knowledge。

## 11. Knowledge、Skill、Instruction、Tool、Diagnostic

- Knowledge：事实、公式、关系、约束和证据。
- Skill：有状态工作流，包括步骤、前置条件、分支和完成标准。
- Instruction：策略和行为限制，具有明确优先级。
- Tool：实际读取或改变系统状态。
- Diagnostic：某个约束失败后形成的结构化实例。

Instruction 优先级：

```text
Shell safety
> organization policy
> workspace policy
> plugin policy
> selected skill
> user turn instruction
```

冲突产生结构化 resolution record，不允许依靠 prompt 顺序偶然解决。

## 12. 诊断是一等知识

`DiagnosticDefinition` 由插件发布：

- 稳定诊断 ID；
- 违反的 constraint ID；
- 参数 schema；
- 默认 severity；
- 解释知识块；
- fix recipe；
- 适用插件/范式版本；
- 本地化 message key；
- conformance cases。

`DiagnosticInstance` 在编译/运行时产生：

- definition ID；
- artifact revision；
- element ID/source span；
- 参数绑定；
- 运行证据；
- 阶段/调用链；
- 可用 fix IDs。

简单约束使用声明式 predicate；复杂约束可以使用 executable validator，但必须注册对应定义。
Problems、AI、文档、fix、测试必须引用同一个诊断/知识 ID。

## 13. Canvas、View、Notation 与 Palette

### 13.1 Canvas Engine

Canvas 只负责通用交互：

- `graph2d`
- `scene2d`
- `scene3d`
- `timeline`
- `table`
- `chart`
- `text`
- 后续 GIS/VR 等

Canvas 不认识 SysML、C4 或 Process。

### 13.2 ViewDefinition

声明：

- 查询哪些 semantic artifacts；
- 如何投影；
- 使用哪个 Canvas；
- 支持哪些交互；
- 是否支持 inverse edit；
- layout/camera 如何保存；
- 需要哪些 notation/domain contributions。

### 13.3 NotationPack

负责：

- semantic kind 到 glyph/compartment；
- relation 到 edge；
- port 和连接规则；
- property editor；
- label；
- layout hint；
- CreateAction。

SysML 和 C4 共享 `graph2d`，但使用不同 NotationPack 和连接约束。

### 13.4 Palette

Palette 是 Canvas Host 的 UI slot。内容按以下公式生成：

```text
active view
+ current selection
+ installed notation/domain contributions
+ permission grants
= available CreateActions
```

删除“每个范式/每个 library 拥有一个全局 Palette”的模型。有些范式可以没有 Palette，
同一范式可以在不同 Canvas 上提供不同动作。

### 13.5 View Planner

AI 根据结构化规则建议视图：

- 空间、碰撞、轨迹 → Scene2D/Scene3D；
- 过程路由 → Flow；
- 生命周期 → Statechart；
- 消息顺序 → Sequence；
- 架构边界 → SysML/C4 graph；
- 参数与证据 → Table/Chart；
- 因果反馈 → Stock-flow/Causal-loop。

AI 只能选择已安装的 ViewDefinition，用户显式选择始终优先。

## 14. AI 可修改插件与信任流水线

### 14.1 权限

- `knowledge.draft.write`
- `skill.draft.write`
- `instruction.draft.write`
- `view.draft.write`
- `notation.draft.write`
- `theme.draft.write`
- `validator.draft.write`
- `runtime.wasm.build`
- `runtime.native.build`
- `plugin.install`
- `plugin.upgrade`
- `plugin.publish`

### 14.2 信任等级

- T0：纯数据和知识；
- T1：声明式规则、视图和主题；
- T2：沙箱 WASM validator/runtime；
- T3：隔离 Worker/iframe UI；
- T4：可信 ESM；
- T5：原生动态库，要求显式批准和重启。

### 14.3 发布流程

```text
AI 创建派生插件 draft
→ manifest/schema 校验
→ 依赖和权限分析
→ 静态检查
→ 自动生成并运行测试
→ 沙箱执行
→ conformance benchmark
→ 展示 diff 和权限变化
→ 用户批准
→ 内容寻址打包和签名
→ 安装并写 lockfile
→ 支持回滚
```

AI 永远不直接覆盖正在使用的已安装插件。

## 15. 前端可定制范围

插件可以贡献：

- theme token 和 scoped CSS；
- icons；
- property editor；
- toolbar/context-menu action；
- side/center/bottom panel；
- canvas overlay/renderer；
- inspector；
- command；
- dashboard widget。

第三方 CSS 默认限定作用域或 Shadow DOM。覆盖 Shell 全局样式需要更高权限。

## 16. 分阶段实施

### Phase 0：基线冻结

已完成，基线为 `65444f3`。后续模型不得重做或拆散这次提交。

### Phase 1：契约冻结

实现语言无关 JSON Schema，并生成 TS/C++ 类型：

- PluginManifest v2；
- Artifact/Revision/Relation/Transaction；
- KnowledgeBlock；
- DiagnosticDefinition/Instance/Fix；
- Canvas/View/Notation/CreateAction；
- Permission/Trust；
- AgentEngine；
- ExecutionTarget。

门禁：round-trip、未知字段拒绝、版本检查、依赖环和 schema compatibility。

### Phase 2：Plugin Host

实现：

- system/user/workspace 插件发现；
- 依赖解析和确定性激活；
- capability grant；
- Web/Node/WASM/native/data entrypoint；
- service/event/effect/lifecycle；
- 安装、卸载、升级、回滚；
- 审计日志。

同时完成 Cordis spike，决定采用 Cordis 适配器还是兼容实现。

删除：静态 `src/plugins/index.ts` 组合根和极简旧插件契约。

门禁：Shell 在零范式插件下仍能构建、启动并编辑普通文件。

### Phase 3：Artifact Graph 与统一事务

迁移：

- ModelPatch；
- SysML typed edit；
- source patch；
- layout edit；
- AI undo；
- run/evidence revision binding。

阶段结束后删除旧的三套事务协调逻辑，不保留长期 facade。

### Phase 4：Knowledge 与 Diagnostic Runtime

实现：

- KnowledgeRegistry；
- canonical ID/version；
- scope/applicability；
- dependency/conflict/supersedes；
- formula AST 和 unit system；
- provenance；
- DiagnosticDefinition 注册；
- fix recipe；
- AI knowledge query；
- 论文摄取 draft pipeline。

逐步把 LP/SY/SL/KR 诊断绑定到知识定义。

### Phase 5：Canvas/View/Palette 重写

先提供：

- Graph2D；
- Scene2D；
- Scene3D 最小版本；
- Table/Chart；
- View Resolver；
- Notation Registry；
- CreateAction Registry；
- Palette Host。

删除：全局 library palette，以及 PalettePanel 中对 model/SysML 的显式分支。

### Phase 6：AgentEngine 与 Context Compiler

实现动态上下文编译：

```text
active artifacts
→ resolve domain/paradigm/view/runtime plugins
→ select knowledge blocks
→ select skills/instructions
→ select exact tools
→ compile bounded structured context
```

并完成 Builtin/OpenAI Agents SDK 对拍。

删除：

- `scripts/ai-assistant.mjs` 静态工具总表；
- 客户端/服务端复制工具名；
- 硬编码 M/M/1 和范式源码配方；
- `logicpilot-modeling` mega capability；
- 由自然语言顺序决定的 instruction 合并。

### Phase 7：Plugin Draft 与 Trust Pipeline

实现：

- plugin draft workspace；
- AI plugin editing tools；
- permission diff；
- schema/lint/test runner；
- WASM sandbox；
- package builder/signing；
- install approval；
- rollback。

首个验收：AI 在授权后给 Process 派生插件增加知识块、诊断说明和 CreateAction，验证并安装。

### Phase 8：迁移内置插件

顺序：

1. Graph2D；
2. Process；
3. SysML；
4. Agent；
5. Statechart；
6. System Dynamics；
7. DEVS；
8. Scene2D/Scene3D；
9. C4 示例插件。

Process 验证 runtime/diagnostic/flow；SysML 验证文本权威、多视图和 lowering；C4 验证
共享 Canvas、不同 Notation。

### Phase 9：原生 Runtime 插件化

- 将内置方法迁移为可信 C ABI 动态插件或 WASM runtime；
- manifest 声明 formalism/family/capabilities；
- execution target 显式选择 runtime；
- 核心删除 `register_all_methods()` 假设；
- 原生崩溃和 ABI 不匹配必须隔离并产生结构化诊断。

### Phase 10：删除旧架构并发布生态

删除：

- side-effect registration；
- 全局 palette library；
- 静态 agent tool 表；
- 范式感知 Shell import；
- mega capability；
- 分散诊断解释；
- 双份插件元数据；
- 旧项目格式隐式兼容。

如需保留旧工程，只提供一次性 `logicpilot migrate --to v3`。

## 17. 破坏性迁移规则

1. 新旧注册表最多共存一个迁移阶段。
2. 禁止新增长期 compatibility facade。
3. 禁止 forwarding file/header 维持已废弃路径。
4. 新项目格式可以直接升级主版本。
5. 删除旧 API 时同步修改所有调用方和测试。
6. 插件 schema 是唯一事实来源，禁止前后端复制工具表。
7. 不为旧测试保留错误层级；测试应迁移或删除。
8. 每个阶段必须列出并完成 legacy deletion list。
9. 中间提交必须能构建；但不要求每个阶段都兼容旧插件包。
10. 对不可逆工程数据变更，必须先提供显式 migrator 和备份提示。

## 18. 并行工作流与依赖

```text
Contracts ──> Plugin Host ──> Built-in migration ──> Legacy deletion
    │              │
    ├──> Artifact Graph ──> Unified transactions
    ├──> Knowledge/Diagnostics ──> Context Compiler
    ├──> Canvas/View/Notation ──> Palette rewrite
    └──> Permission/Trust ──> AI Plugin Draft/Install

AgentEngine abstraction ──> SDK spike ──> benchmark decision
Native ABI schema ──> runtime plugins ──> register_all_methods deletion
```

Phase 1 schema 未冻结前，不得并行实现多个自创版本。schema 冻结后，Knowledge、View、
AgentEngine 和 Trust 可以并行；内置范式迁移必须等 Plugin Host、Artifact Transaction 和
对应贡献契约稳定。

## 19. 全局验收门禁

1. Shell 无任何范式插件仍可启动。
2. 卸载 Process 后，其 Palette、AI、诊断和 runtime 全部消失。
3. SysML/C4 共享 Graph2D，但规则完全隔离。
4. Palette 完全由 active Canvas/View/Selection/Permission 决定。
5. AI 按需加载结构化知识，不读取整库自然语言。
6. 每个诊断都能解析到定义、constraint、解释和 fix。
7. 无权限时 AI 不能创建或安装插件。
8. 有权限时 AI 只能修改 draft，失败校验不污染 installed state。
9. 插件可重现、可审计、可卸载、可回滚。
10. 公式具有 AST、单位、假设和来源。
11. 图片具有 provenance 和语义标注。
12. lockfile 可复现完整组合。
13. Process、Agent、Statechart、Continuous、DEVS、SysML、C4 有独立 conformance suite。
14. Shell 不 import 具体范式目录。
15. 不存在客户端/服务端重复工具列表。
16. Agent SDK 后端不能绕过 LogicPilot 权限和事务。
17. 原生插件崩溃不能破坏项目文件或 Shell 状态。
18. 插件卸载后事件、timer、tool、service 和 UI contribution 无泄漏。

## 20. 后续模型执行协议

后续模型开始工作前必须：

1. 读取本文件和根目录 `AGENTS.md`；
2. 检查当前分支、工作树和最近提交，不重做已完成阶段；
3. 明确正在执行的 Phase、契约和 deletion list；
4. 优先修改唯一事实来源，禁止添加新的复制表；
5. 对跨阶段决策新增 ADR；
6. 每个阶段同时交付实现、迁移、删除、测试和文档；
7. 使用 Windows 官方构建脚本执行原生门禁；
8. 保留真实范式案例，不用 mock 替代编译/运行；
9. 遇到旧兼容层阻碍目标架构时，按本计划删除旧层，而不是继续包 facade；
10. 提交时在说明中列出完成的 Phase 条目、删除项和未完成风险。

## 21. 外部参考

- OpenAI Agents SDK：<https://openai.github.io/openai-agents-js/>
- DeepSeek Harness：<https://www.deepseek.com/harness/>
- DeepSeek Harness 插件开发：
  <https://deepseek-harness.github.io/deepseek-harness/develop/basic/>
- Cordis：<https://github.com/cordiverse/cordis>

这些项目是 Agent loop 和插件生命周期的实现参考，不是 LogicPilot 工程语义的事实来源。
LogicPilot 的范式语义、知识契约、Artifact Graph 和仿真证据仍由本项目规范和 conformance
tests 定义。
