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
| (本轮,待提交) | **F7 PaletteProvider**:新增 `workbench/palette.ts` 注册表 + `model/paletteContributions.ts` 注册 7 个内建库(process 库只登记 executable 项),`PalettePanel.tsx` 改为纯宿主(不再 import BLOCK_DEFS/LIBRARIES union);新增 `workbench/palette.test.ts`;typecheck+237 vitest 通过,E2E 结果见提交前检查 |

## 4. 待办(按优先级,对应审查文档 §4)

### A. 收尾中的小事(先做)
- **容器改名后残留旧名空视图标签**:`state/canvasView.ts` 的 view 以 `{kind,name}` 为键;`modelStore.renameBlock` 改名容器时应同步更新 canvasView 中匹配该名的 open views(或关闭)。截图证据:`.verify/out/rename-container.png` 中 Model/Drone/Falcon 三 tab 并存。注意这仍是名字键的补丁,ElementRef 迁移后应改为 ID 键。
- 提交本轮 palette 切片(若交接时仍未提交):文件为 `web/apps/ide/src/workbench/palette.ts`、`palette.test.ts`、`src/model/paletteContributions.ts`、`src/layout/PalettePanel.tsx`。

### B. F6 稳定 ElementRef(架构根,优先级最高但工程量大)
现状:`ModelNode.container` 存容器**名**(`web/packages/editor/src/graph.ts`);
缓解措施已有:renameNode 级联、LP3103 同名嵌套警告、项目层 `sceneUid` +
`manifest.containerIds`(project/syncEngine)、布局键 `nodePath()` 按名字链推导(project.ts ~L388)。
剩余:`container` 改存容器节点 ID;canvasView 键改 ID(消掉改名残tab);
`modelPatch.diffModelDocuments` 匹配键迁移;**必须保持 DSL round-trip 门禁**
(`parse(generate(parse(src))) == parse(src)`,editor 68 vitest + corpus)。
建议切法:先在 graph 层加 `containerId?` 并行字段过渡,消费方逐个切换后再删 name 链路。

### C. F9 通用 Outline host → F8 DiagramProvider/PanelId 动态化(F8/F10)→ F7 已完 → DocumentSession 统一
- Outline host:`layout/ModelInfoPanel.tsx` 自解析 .lp 渲染 Project 树,应降级为宿主,语义树由贡献方提供(SysML 已有 projection 可作为第二贡献方);
- PanelId(`layout/panels.tsx`)是硬编码 union 含 'sysml'/'sysmlProperties';Workspace.tsx 用 selectedId/sysmlSelectedId 二元判断选属性面板(F10)。

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

- 后台服务:gateway(lpcli serve mm1.lp :8089)、vite(:5173)以 DSH 后台 job 运行中,断线就按 §5 重启;
- `.verify/` 为未跟踪 scratch 目录(E2E 输出/临时脚本);`.playwright-cli/` 是历史 console 日志;
- 测试基线数字:IDE vitest 36 文件 237 用例、editor 68、kernel ctest 492(clean 时)。
