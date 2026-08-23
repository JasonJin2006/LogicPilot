# Workbench 架构迁移审查（2026-08-23）

状态：审查完成，首批整改已落地  
参照：[`workbench-architecture-plan.md`](./workbench-architecture-plan.md) §2/§5/§9/§13、
[`roadmap.md`](./roadmap.md) P1-Next  
基线：`9fd6080`（feat: unify simulation workbench and add SysML visualization）

## 1. 结论摘要

对照计划 §13 的架构门禁逐项核查后确认：**上一阶段交付的 Document Contribution
Registry 只是路由元数据的最小骨架**，Workbench 核心仍存在多处全局 kind switch 和
名字身份耦合。核心问题按严重度排列如下；本批已修复其中 4 项（§3），其余保留为
后续切片（§4）。

## 2. 审查发现（对照计划 §2 边界清单）

| # | 发现 | 位置 | 违反的门禁 | 严重度 |
| --- | --- | --- | --- | --- |
| F1 | `.lp` 未注册为 contribution，文件→编辑器路由靠 `editorPanelFor` 的 `'dsl'` 回退 + 各处硬编码扩展名判断 | `workbench/documentTypes.ts`、`layout/ExplorerPanel.tsx`（`.lp/.sysml/.json` 三元分支）、`layout/Workspace.tsx`（`=== 'sysml'`） | §13 新文档类型必须经 provider 注册 | 高（已修） |
| F2 | Explorer 自建文件分类 union `'dsl'\|'sysml'\|'json'\|'ir'\|'muted'` 并据此选图标/可开性 | `layout/ExplorerPanel.tsx` | §13 不新增全局 kind switch | 高（已修） |
| F3 | 新建文件模板硬编码 `` path.endsWith('.lp') ? `model …{}` : '' `` | `layout/ExplorerPanel.tsx` | §13 | 中（已修） |
| F4 | `validateDesModel()` 被 4 处直接 import：画布徽标、Properties、Run 门禁、AI preflight——Process 校验位于全局路径，新增校验器需改每个消费方 | `model/ModelCanvas.tsx`、`model/PropertiesPanel.tsx`、`run/RunDialog.tsx`、`ai/capabilities/logicpilot-modeling/compile.ts` | §9.1 全局 Process 校验迁为 DiagnosticProvider | 高（已修） |
| F5 | AI 工具静态全量挂载：SYSML_TOOLS 与 DSL mutation 工具对任何活动文档都可见 | `ai/capabilities/logicpilot-modeling/registry.ts` | §7 按活动文档动态发现 | 高（已修） |
| F6 | 容器身份是**名字**：`container` 字段存容器名，同名嵌套容器靠 LP3103 警告兜底；且 `renameNode` 不级联子节点——重命名容器会把全部子成员孤立出子图（画布视图、DSL 生成、布局键同步漂移） | `web/packages/editor/src/graph.ts`、`parseDsl.ts`、`dsl.ts`、`modelPatch.ts`、`project.ts nodePath` | §13 稳定 ID，显示名不承担引用身份 | 高（级联修复已落地；ElementRef 迁移待做） |
| F7 | Palette 直接 import 固定 `BLOCK_DEFS/LIBRARIES` union | `layout/PalettePanel.tsx` | §9.3 PaletteProvider | 中（未修） |
| F8 | `PanelId` 为含 `'sysml'/'sysmlProperties'` 的硬编码 union；第三种文档类型需要改 core 面板表 | `layout/panels.tsx` | §13 | 中（未修） |
| F9 | Project Outline 面板自行解析 `.lp` 并按元素种类渲染（含 `path.endsWith('.lp')` 分支） | `layout/ModelInfoPanel.tsx` | §9.2 通用 Outline host | 中（未修） |
| F10 | Workspace 用 `selectedId/sysmlSelectedId` 二元判断决定右侧属性面板 | `layout/Workspace.tsx` | §13 不新增 kind switch | 低（未修） |
| F11 | 内核侧边界良好：`SimulationMethod` 已定位为 runtime adapter、kernel 不 include `methods/`、`SemanticsRef.library` 声明为兼容键 | `kernel/runtime/`、`methods/*`、`docs/specs/method-runtime.md` | 符合 §10 | ✅ |

## 3. 本批整改（均已通过 typecheck + vitest + 浏览器 E2E）

### 3.1 文件路由收敛到 Contribution Registry（修 F1/F2/F3）

- `.lp` 作为 `id:'dsl'` 正式注册进 `DOCUMENT_CONTRIBUTIONS`；注册表增加扩展名
  冲突守卫与 `newFileTemplate` 能力声明；
- Explorer 的文件分类改为 `documentContributionFor(path)?.id ?? null`，
  图标由「有贡献→代码图标」推导，删除 `'ir'/'muted'` 死分支；
- Workspace 标签栏直接消费 `editorPanelFor(path)`，不再二次比较字符串；
- 新文件内容统一走 `newFileContentFor()`。

效果：注册一种新文档类型只需一次 `DOCUMENT_CONTRIBUTIONS.register(...)`，
即可获得正确的编辑器路由、图标与新建模板。

### 3.2 DiagnosticProvider seam（修 F4）

- 新增 `workbench/diagnostics.ts`：`DiagnosticContribution { id,
  documentTypes, diagnose(payload) }` 注册表 + `diagnoseDocument(type, doc)`
  聚合入口。registry 不检查 payload 类型，语言自有契约不被压扁；
- `modelValidation.ts` 把 DES 图校验注册为 `logicpilot.des-graph`
  （documentTypes: `['dsl']`）；
- 四个消费方全部改走 seam，不再 import 具体校验器；未知文档类型诊断为空，
  绝不路由到别的语言的校验器。

效果：SysML/未来语言的诊断器注册即接入画布徽标、属性面板、Run 门禁与 AI
preflight。

### 3.3 AI 工具按活动文档动态发现（修 F5）

- `AgentCapability` 增加可选 `toolsForScope(scope)`，`AgentToolScope` 只携带
  `documentType`（无编辑器概念）；registry `tools(ids, scope?)` 支持作用域解析；
- modeling capability：scope=`sysml` → 仅 SYSML 投影工具；scope=`dsl`/null →
  全部建模工具（不含 SysML 投影工具）；无 scope → 维持全量（兼容）；
- readonly capability 显式覆盖 `toolsForScope`，白名单在作用域内仍然生效；
- `AIPanel` 从活动文件推导 scope 传入 `runAssistantTurn`。

## 4. 后续迁移切片（按计划 §9 顺序）

1. **稳定 ElementRef**（F6）：editor 包 `container` 名字链路替换为稳定 ID。
   现状缓解：`renameNode` 已级联子节点 `container` 指针（浏览器实测
   Drone→Falcon 重命名后 on_tick 子成员仍在子图内）；项目层已有
   `sceneUid` + `manifest.containerIds` 稳定场景身份，布局键经
   `nodePath()` 由名字链推导。剩余工作：`container` 字段改存容器节点 ID、
   canvas view 的 `{kind,name}` 键改用 ID（重命名后残留旧名空视图标签）、
   `diffModelDocuments` 匹配键迁移；这是跨视图/重命名/多文件的根，优先级最高；
2. **通用 Outline host**（F9）：Project 面板降级为宿主，语义树由贡献方提供；
3. **PaletteProvider**（F7）：块目录改为贡献注册，Palette 只做搜索/拖放宿主;
4. **DiagramProvider 拆分**（F8/F10）：`ModelCanvas` 拆图引擎与语言投影，
   PanelId 动态化；
5. **DocumentSession 统一**：`.lp` 文本、画布、模型树接同一权威 revision。

### 3.4 容器重命名级联（修 F6 的正确性缺陷）

`renameNode` 现在把名字链上的子成员一并重指向新名（与 `removeNode` 的级联语义
一致），AI patch 的 `update_block` 重命名路径同样受益。验证：editor 68 vitest
（含新增回归测试）+ IDE 234 vitest + Playwright 实测（导入 agents.lp →
Drone 改名 Falcon → 子图内 on_tick 成员保留，截图复核）。

## 5. 本批验证证据

- IDE typecheck 通过；vitest 35 文件 234 用例全绿（基线 222 + 新增 12）；
- `pnpm --filter @logicpilot/ide run build`（tsc + vite production build）通过；
- Playwright + Edge 全流程 E2E（`scripts/browser-verify.mjs`）：新项目→网关连接→
  M/M/1 运行→画布遥测→DSL 编译诊断→AI 生成/应用/运行→优化/解释→连续/
  Statechart/DEVS/Agent 遥测全部 PASS，控制台零错误；
  - 附带修复：上一提交把文件选择器 accept 扩为 `.lpproj,.lp,.sysml,.json` 后
    E2E 的 5 处 `[accept=".lpproj,.lp,.json"]` 选择器失配（presentation/agent/
    statechart/continuous/atomic 导入步骤），已同步更新；
- 关键界面截图人工复核（`.verify/out/*.png`）：Explorer 图标、画布遥测徽标、
  AI 运行指标表、连续模型轨迹图渲染正常。
