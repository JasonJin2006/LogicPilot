# LogicPilot Workbench 迁移 + SysML 开发 · 交接文档

> 交接时间:2026-08-23 · 基线分支:`main`(本地,未推送远程)
> 前序提交:`9fd6080` → `93b7f3d` → `81e332f`(+ 本轮 palette 切片)

## 1. 总目标(来自用户)

以 `docs/workbench-architecture-plan.md` 为准绳:**先审查并修复项目核心问题、
把 Workbench 架构迁移到位,再继续开发 SysML**。用户要求前端开发中多用
**视觉能力(截图人工复核)和浏览器自动化实测**(项目已有 Playwright E2E 设施,
见 §5),没有的工具可以自行配置。

## 2. 必读文件(按顺序)

1. `docs/workbench-architecture-plan.md` — 迁移总计划(§5 扩展契约表、§9 迁移顺序、§13 架构门禁);
2. `docs/workbench-migration-review.md` — **上一轮审查产出**:F1–F11 发现清单、已修/未修状态、后续切片路线(§4);
3. `docs/roadmap.md` P1-Next 节 — 实施顺序 1–7;
4. `AGENTS.md` — Windows 构建纪律(C++ 不要直接在 PowerShell 里跑 MSVC CMake,用 `./scripts/windows-build.ps1 -Preset windows-msvc-dev [-Test]`)。

## 3. 已完成(勿重做)

| 提交 | 内容 |
| --- | --- |
| `93b7f3d` | ① `.lp` 注册为 Document Contribution,Explorer 分类/图标/新建模板/标签栏路由全部经注册表解析(F1/F2/F3);② 新增 `workbench/diagnostics.ts` DiagnosticProvider 注册表,DES 图校验注册为 dsl 类型 provider,画布/Properties/RunDialog/AI preflight 四处消费方改走 seam(F4);③ AI 工具按活动文档作用域发现:`AgentToolScope.documentType`,sysml→仅 SYSML 投影工具,dsl/null→建模工具,无 scope 保持全量兼容(F5);④ 修复 E2E 文件选择器 accept 缺 `.sysml` 的 5 处失配 |
| `81e332f` | `editor/graph.ts renameNode` 级联子节点 container 指针——修复"重命名容器导致子成员孤立出子图/DSL/布局键"的正确性缺陷;含 editor 回归测试与 Playwright 实测 |
| `9110586` | **F7 PaletteProvider**:新增 `workbench/palette.ts` 注册表 + `model/paletteContributions.ts` 注册 7 个内建库(process 库只登记 executable 项),`PalettePanel.tsx` 改为纯宿主;新增 `workbench/palette.test.ts`(237 vitest) |
| (本轮) | **A1 canvasView 同步**:`state/canvasView.ts` 新增 `syncCanvasViewsWithDocument(next, previous)`——容器改名时打开的视图标签跟随新名(undo 跟回旧名,改名撞已有标签去重),容器删除时关闭标签;接入 `App.tsx` 既有 modelStore 订阅,统一覆盖 renameBlock/AI patch/undo/redo。新增 5 个 vitest(共 242)+ `.verify/rename-tab-check.mjs` 浏览器实测 PASS |
| (本轮) | **B/F6 稳定链接(containerId)**:editor `ModelNode` 新增 `containerId?`(权威父子链接)+ `isChildOf/isRootMember/childrenOfContainer/parentOfNode` 辅助;parseDsl 双写 container/containerId;dsl.ts 子图查找换辅助;removeNode 改 id 驱动**传递性**级联(修复删 agent/behavior 容器孤儿化子成员的缺陷);modelPatch `add_block.container`(wire 名字)apply 时解析为 id,未知/歧义容器报 MP2005。IDE:canvasView 视图携 containerId(id 解析+前代回溯),canvasInsert/dblclick/connectPresentationShapes/nodePath 全部传/走 id。diffModelDocuments 与 syncEngine structureSignature **有意保留名字键**(跨 parse 边界,id 不对应,已注释说明)。editor 73(+5)ide 242 typecheck build 全绿,E2E PASS |
| (本轮) | **C1/F9 Outline host**:`workbench/outline.ts` 新增 `OUTLINE_CONTRIBUTIONS`(applies+priority+组件形态,贡献方自带 store 订阅);`.lp` 项目树整体迁至 `project/dslOutlineContribution.tsx`,SysML outline 迁至 `sysml/sysmlOutlineContribution.tsx`(priority 10,活动文档为 sysml 时压过项目树);`ModelInfoPanel` 降级为纯宿主(解析零语言、零 kind 分支)。新增 `workbench/outline.test.tsx`(4 用例,共 246 vitest)+ `.verify/outline-check.mjs` 实测双贡献方切换 PASS。注意:导入 .sysml 会 clearProject(SysML 是项目外虚拟文档,既有设计) |
| (本轮) | **C2/F8+F10 Panel 开放注册**:panels.tsx 的 `PanelId` 放开为 string + `registerPanel()`(重复 id 拒绝);`PanelDef.focus?` 谓词承载"选中→属性面板"规则,Workspace 的 selectedId/sysmlSelectedId 二元分支改为 `focusedPanelId('right')` 注册表解析(两个订阅仅作触发器);SysML 编辑器/属性面板迁至 `sysml/sysmlPanelsContribution.tsx`(lazy 保留),App.tsx 作为组合根最先引入(保证持久化 layout 校验前注册完成);documentTypes 的 editorPanel union 同步放开。新增 panels 测试 2 例(共 248)。E2E + outline-check PASS |
| (本轮) | **C3/DocumentSession 同步**:`projectSync.refreshCanvasDocument()`——解析成功即换新 revision,失败保留最后有效模型并记控制台;DslEditor 编辑 bundle 文件 300ms 防抖触发(文本→画布实时);Project 树/AI 源码工具/场景导入三条流全部改走温和路径(不再 closeAllFiles+resetCanvasViews);canvasView resolve 增加"前代名字恢复",reparse 换 id 后已打开容器视图存活。新增 projectSync.test.ts(3 例)+ canvasView 跨 reparse 用例(共 252 vitest)+ `.verify/live-sync-check.mjs` 实测 PASS |


## 4. 待办(按优先级,对应审查文档 §4)

### A. 收尾中的小事 —— ✅ 已全部完成(palette 见 §3,A1 见上)

### B. F6 稳定 ElementRef —— 会话内链接已迁 id;剩余收口
- 已完成:`containerId` 权威链接 + 双写过渡、消费方切换(canvasView/nodePath/创建路径)、removeNode 级联缺陷修复;
- 剩余:IDE 手工建块的路径已传 id,但 ModelInfoPanel(F9 文本 Outline)开的视图仍是名字式(sync 兼容);`container` 名字字段仍保留作 DSL 序列化元数据——彻底删除需等 patch wire/dsl 文本格式演进,非近期必须。

### B. F6 稳定 ElementRef(架构根,优先级最高但工程量大)
现状:`ModelNode.container` 存容器**名**(`web/packages/editor/src/graph.ts`);
缓解措施已有:renameNode 级联、LP3103 同名嵌套警告、项目层 `sceneUid` +
`manifest.containerIds`(project/syncEngine)、布局键 `nodePath()` 按名字链推导(project.ts ~L388)。
剩余:`container` 改存容器节点 ID;canvasView 键改 ID(消掉改名残tab);
`modelPatch.diffModelDocuments` 匹配键迁移;**必须保持 DSL round-trip 门禁**
(`parse(generate(parse(src))) == parse(src)`,editor 68 vitest + corpus)。
建议切法:先在 graph 层加 `containerId?` 并行字段过渡,消费方逐个切换后再删 name 链路。

### C. F9/F8/F10 + DocumentSession 核心同步已完成(见 §3),剩余:更细粒度的会话治理
- 已完成:`refreshCanvasDocument` 温和刷新(文本编辑器防抖触发、树/AI/场景流改走,不再关标签/视图;坏语法保留最后有效模型并记控制台);canvasView 支持跨 reparse 的按名恢复;
- 剩余:按文件粒度的 authoritative revision 追踪(哪些文件已与文档一致)、磁盘文件夹模式(无 bundle)的实时同步、AI typed edits 直接走 DocumentSession 事务。

### D. SysML 继续(roadmap P1-Next 第 2 步起,S1 MVP)
现状:仅 regex 投影(`sysml/sysmlProjection.ts`,行级、best-effort)+ 关系画布 + 布局侧车 + AI inspect/layout/view/focus/move 工具。
S1 缺口:真正的增量 parser、稳定元素身份+源码 span、诊断稳定码、Outline、completion/hover/go-to-def/find-references/rename、错误时保留最后有效快照、AI typed edits(requirement/part/port/connection/trace)。
S2:action/state/calculation/analysis/verification 的 ExecutionTargetRef + 解释器/lowering,输出 trace/evidence,建 conformance matrix。规范基线:OMG SysML v2。

## 5. 验证工作流(每个切片必须全绿)

```powershell
# 前端门禁(最快路径)
pnpm --filter @logicpilot/editor run test   # 68 tests(round-trip 守护)
pnpm --filter @logicpilot/ide run typecheck
pnpm --filter @logicpilot/ide run test      # 237 tests(随切片递增)
pnpm --filter @logicpilot/ide run build     # tsc + vite production
pnpm docs:build                             # VitePress

# 浏览器 E2E(需两个后台服务)
.\build\windows-msvc-dev\kernel\apps\lpcli\lpcli.exe serve examples\mm1.lp --port 8089 --arrivals 2000 --warmup 200
pnpm dev   # web/apps/ide 下,vite :5173;Windows 下编辑文件偶发 EBUSY 杀 watcher,重启即可
node scripts\browser-verify.mjs   # web/apps/ide 下;用系统 Edge(playwright-core),全流程 PASS 约 4 分钟
```

- E2E 截图落在 `.verify/out/*.png`,**用 read_image 人工复核**;
- 针对性小验证脚本可仿照 `.verify/rename-check.mjs`(playwright-core 用绝对路径导入 `file:///.../web/apps/ide/node_modules/playwright-core/index.mjs`);
- 内核侧如需跑 CTest:`./scripts/windows-build.ps1 -Preset windows-msvc-dev -Test`(clean gate 曾 492/492)。

## 6. 关键架构知识 / 约定

- 分层方向:**语言扩展依赖 workbench 平台**,反向禁止(workbench 不 import model/sysml 具体目录);provider 注册都是模块副作用式(`import './xxxContributions'`),新 provider 一律带 `*.test.ts`;
- 注册表模式三件套已立:`documentTypes.ts`(文件路由)、`diagnostics.ts`(诊断聚合,未知类型诊断为空,**绝不跨语言路由**)、`palette.ts`(元素目录,honesty filter 归贡献方);
- AI runtime:`assistantRuntime.runAssistantTurn({capabilities, toolScope})`;AIPanel 从 `useUiStore.activeFile` 推导 scope;server 侧 `/api/assistant` 只收 capabilities 字符串(尚未传 scope,如需要再扩协议);
- 名字身份的坑:`container`、canvasView 键、nodePath、diffModelDocuments 都走名字链——改动任何一处先想 round-trip 与 syncEngine 结构键(JSON.stringify([kind,name,container]));
- 冻结契约:F1 ir_v2.fbs / F2 wire.fbs / F3 interop,动内核指标/遥测要走冻结流程;
- git:本地 main,不推远程;每切片一个 commit,message 说明动机+验证证据;prettier/eslint 配置在仓库根(`pnpm format` / `pnpm lint`)。

## 7. 当前环境快照

- 后台服务:gateway(lpcli serve mm1.lp :8089)、vite(:5173)已重启;注意本机
  shell 有 HTTP(S)_PROXY=127.0.0.1:7890,curl 探活必须加 `--noproxy "*"`(浏览器
  E2E 不受影响);
- `.verify/` 为未跟踪 scratch 目录(E2E 输出/临时脚本);`.playwright-cli/` 是历史 console 日志;
- 测试基线数字:IDE vitest 38 文件 248 用例、editor 73、kernel ctest 492(clean 时);
- 截图人工复核:模型可直接用 Read 工具读 `.verify/out/*.png`(旧 vision.js
  流程已按用户要求废弃);`.verify/screenshot-sanity.mjs` 的像素统计仍可作辅助。
