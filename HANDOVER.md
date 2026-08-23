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
| (本轮) | **D1/SysML 结构化 parser**:新建 `sysml/sysmlParser.ts`(括号配对作用域栈、坏语句跳过继续收集全部错误);元素带 `nameSpan`(标识符精确定位)+ 覆盖到闭括号行的块级 span;诊断改稳定码 SY0001 未识别语句/SY0002 未解析引用/SY0003 重名/SY0004 括号失衡/SY0005 无声明;`sysmlStore.refresh` 错误时只更新 source、保留最后有效 projection/layout 并置 `parseDirty`(画布显示提示条)。id 方案不变(qualifiedName fnv1a),布局侧车向后兼容。新增 parser 6 测 + store 1 测(共 259 vitest);E2E/sysml-canvas-check PASS |
| (本轮) | **D2/SysML AI typed edits**:新建 `sysmlEdits.ts`(insertElement/renameElement/addRelationStatement 纯函数——嵌套插入带缩进、单行 `{ }` 父块自动展开、rename 只替换 nameSpan token、同作用域重名拒绝、括号失衡拒追关系);工具侧 `commitEdit` 写前用 parser 重验证(会引入 SY error 的输出直接拒绝且不动文件),读取走权威存储而非滞后的 store.source。新增 7 个纯函数测试 + 4 个真实 store 集成测试(共 270 vitest) |
| (本轮) | **D3/SysML 语言服务**:新建 `sysmlLanguage.ts`——completionsAt(by/to/from 后给元素名,否则按前缀过滤声明关键字)、hoverAt(最内层包含块)、definitionAt(声明处=自身;引用词走唯一名/::尾解析)、referencesOf、renameAt;uiStore 新增 sourceReveal 请求,DslEditor 聚焦并选中 span(浏览器自动滚动到可见),属性面板与画布选中卡加 Open in source 按钮;AI 侧新增 find_sysml_definition/find_sysml_references。renameElement 升级:除声明 token 外,所有能解析到该元素的裸名/限定尾引用一并替换(其他作用域同名不受影响)。语言测试 6 例(共 276 vitest) |
| (本轮) | **S1 补齐**:① `DocumentContribution.completions(source,offset)` 缝隙,SysML 贡献方注册(元素上下文/关键字),DslEditor 通用 Ctrl+Space 弹层(方向键/Enter/Esc、输入续排、点击接受,disk 模式同样落盘);② `sysmlProjectIndex.ts` 聚合全部 .sysml——唯一名/限定名/::尾三级解析,歧义返回 null,诊断按路径聚合;find_sysml_definition 增加 projectFiles 列表与跨文件回退。新增 4 索引测试 + 语言上下文用例扩展(共 280 vitest);`.verify/completion-check.mjs` 实测弹层→点选 Power→token 落盘 PASS |
| (本轮) | **S2-a/SysML 语义执行 0.1**:新建 `sysmlExecution.ts`——`extractExecutionTargets`(action/calculation/state/analysis/verification usage → 显式 target,含不支持原因;纯结构模型为空表)+ 版本化 `SYSML_CONFORMANCE_MATRIX`(supported/planned/unsupported 三档,测试钉住)+ 无 eval 的递归下降表达式求值器(优先级/括号/一元负/兄弟引用/除零与未知标识符确定性报错带行号);parser 新增 calculation/calc 关键字(calc 归一化);store 增加 execution/runError(runTarget),任何新 revision 到达即失效;画布工具条仅当存在受支持目标时渲染目标选择+Run,trace 条显示步骤/result/revision。6 个执行测试(共 286 vitest);`.verify/run-check.mjs` 实测计算 result=38/action 序列/纯需求模型零入口 PASS |
| (本轮) | **视觉切片/ELK 排版+主题**:依赖 elkjs@0.9.2(仓库根 .npmrc 固定 virtual-store-dir-max-length=60 对齐存量存储);新建 `sysmlAutoLayoutElk.ts`——buildElkGraph 把包含关系嵌套为 ELK 复合 children(`contains` 从边表消失)、其余关系参与全局分层(INCLUDE_CHILDREN),固定 randomSeed 确定性,direction=RIGHT 让同父兄弟纵向堆叠、深度向右;运行走 Web Worker(`?url` 引入经典 worker),失败降级主线程 bundled,再败回退同步树形首帧;ELK 返回的容器放大尺寸经 `SysMLLayout.sizes` 持久化并用于拉伸外框;坐标按祖先链累加为绝对值。配色删除硬编码 COLORS,节点 g 带 `data-kind`,CSS 用 currentColor+color-mix 映射主题 token(accent/warn/error/ok/surface),双主题一致。Auto layout 按钮→applyElkLayout(checkpoint 可撤销),无侧车新文件加载后自动精排。+4 测试(共 288 vitest);sysml-canvas/run-check 截图人工复核通过 |
| (本轮) | **S2-d 收尾+视觉修复**:接手另一 AI 未提交的 evidence 切片并补全验证——`.verify/state-evidence-check.mjs` 实测红绿灯状态机(202 步,t=0→2675,预算停止)、evidence 面板逐 Run 累加(1→2 条)、跨容器 satisfies 渲染、浏览器控制台零 ELK 回退;修复两处:① `.sysml-node-kind/.sysml-node-name` 硬编码深色文字改 var(--text-secondary)/var(--text)(浅色主题下名字不可见的真凶);② ELK worker 在无 Worker 环境快速抛出走主线程兜底(消除单测告警刷屏)。309 vitest/build/E2E/专项检查全绿,截图人工复核 |
| (本轮) | **S2-e/evidence AI 查询**:新增 query_sysml_evidence(target 子串/id、outcome=ok|failed、limit≤20 过滤,返回 revision/时长/步数/result/conformance 版本)与 explain_sysml_run(单条全 trace 含源码行与时钟时刻);工具测试 2 例(双 Run 入账+outcome 过滤+explain 全量字段,共 311 vitest) |


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

### D. SysML S1 推进中
- ✅ **D1 结构化 parser**(见 §3):`sysml/sysmlParser.ts` 括号配对+错误恢复,nameSpan/块级 span,稳定诊断码族 SY0001–SY0005(表在文件头),store 错误时保留最后有效快照(parseDirty);元素 id 沿用 qualifiedName 哈希(布局侧车兼容);
- ✅ **D2 AI typed edits**(见 §3):`sysml/sysmlEdits.ts` 纯源文本事务 + `add_sysml_element`/`rename_sysml_element`/`connect_sysml_elements` 三工具(写前重解析验证,拒绝会产生 SY error 的输出;从 bundle/diskFiles 权威存储读取当前文本);
- ✅ **D3 语言服务**(见 §3):`sysml/sysmlLanguage.ts`(completionsAt/hoverAt/definitionAt/referencesOf/renameAt)+ uiStore `sourceReveal` 管道(属性面板/画布选中小卡 "Open in source" 直达 token)+ AI 导航工具 find_sysml_definition/find_sysml_references;rename 升级为**引用同步替换**(逐词重解析判定归属,跨作用域同名不动);
- ✅ **S1 收尾**(见 §3):`DocumentContribution.completions` 缝隙 + DslEditor 通用补全弹层(Ctrl+Space);`sysmlProjectIndex.ts` 多文件项目级索引(definition 跨文件回退、歧义即 null、诊断带路径聚合);
- **S1 至此功能面补齐**。遗留(非阻塞):跨文件 relation 抽取(需要合并虚拟文档)、索引未接入 referencesOf。
- ✅ **S2-a 语义执行子集 0.1**(见 §3):ExecutionTargetRef 提取 + 版本化 conformance matrix + 表达式/calculation/action 赋值序列解释器 + trace 绑定 revision;纯结构/需求模型零 Run 入口(验收红线已测);
- ✅ **可视化重做**:ELK(elkjs)分层自动排版(worker 优先/主线程兜底/同步树形首帧)+ data-kind 主题配色(双主题一致);calculation 关键字入 parser;
- ✅ **S2-b 状态机 0.2**(另一 AI,`0c135e9`):扁平状态机 + transition succession + `after/at` 数值时间触发器,离散事件时钟、步数预算停止;guard 条件(when/otherwise)标 planned;
- ✅ **S2-c 正交路由**(另一 AI,`e4ade3b`):跨容器连线 Manhattan 路由,纯函数渲染时计算,对 ELK/树形/手动布局统一生效;
- ✅ **S2-d evidence 日志**(本轮收尾提交):每次 Run 产出不可变记录(绑 revision/目标/trace/时长/conformance 版本),localStorage + bundle 侧车 `presentation/sysml/<hash>.evidence.json` 双持久化,上限 20 条,refresh 不清空(旧 revision 证据仍可查);画布 overlay 面板展示最近 5 条;
- ✅ **S2-e evidence AI 查询**(见 §3):query_sysml_evidence(target/outcome/limit 过滤)+ explain_sysml_run(单条全 trace),agent 可回答"跑过哪些、结果如何、绑哪个 revision";
- S2 剩余:lowering 到 Statechart/DEVS runtime、外部 analysis adapter。
- S2:action/state/calculation/analysis/verification 的 ExecutionTargetRef + 解释器/lowering,输出 trace/evidence,建 conformance matrix。规范基线:OMG SysML v2。

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
- 新增前端依赖:`elkjs@0.9.2`(EPL-2.0,布局引擎,worker 经 Vite `?url` 引入);
- `.verify/` 为未跟踪 scratch 目录(E2E 输出/临时脚本);`.playwright-cli/` 是历史 console 日志;
- 测试基线数字:IDE vitest ~41 文件 288 用例、editor 73、kernel ctest 492(clean 时);
- 截图人工复核:模型可直接用 Read 工具读 `.verify/out/*.png`(旧 vision.js
  流程已按用户要求废弃);`.verify/screenshot-sanity.mjs` 的像素统计仍可作辅助。
