# Web IDE 布局与面板系统

状态：**已完成**（2026-08-05 落地，2026-08-06 现状）；对应 roadmap P1-6

## 0. 定位

LogicPilot IDE 的布局形态融合 **VS Code 的 Workbench 壳**（活动栏 + 侧边栏 +
多标签工作区 + 底部面板 + 全局状态栏，全部可调/可折叠/可持久化）与工程建模所需的
Outline、Palette、Properties 和专用编辑器。AnyLogic 风格 Process 画布是首个内置
编辑器，不再定义整个平台的语义。统一文档/provider 迁移与高优先级 SysML v2 计划见
[`../workbench-architecture-plan.md`](../workbench-architecture-plan.md)。

```text
┌──────────────────────────────────────────────────────────────┐
│ TopBar：logo + 搜索框 +（桌面端）窗口控制                        │
├──────┬─────────────────────────────┬─────────────────────────┤
│ 活动栏 │ 中央工作区：Model 建模画布      │ AI / Properties 标签    │
│      │   + 可收起 DSL 编辑区          │                        │
│ 左侧  ├─────────────────────────────┤                        │
│ Project│ Console（事件/诊断日志）       │                        │
│ Palette├─────────────────────────────┴─────────────────────────┤
│      │ status：连接点 问题计数 光标 语言模式 │                        │
└──────┴────────────────────────────────────────────────────────┘
```

决策（roadmap P1-6）：**自研**面板系统，不引 FlexLayout / rc-dock，零新依赖，
复用 zustand 域 store 模式。布局与内容解耦：`panels.tsx` 注册面板，
`layoutStore` 只描述几何（尺寸/折叠/激活标签/标签顺序）。

## 1. 布局区域

| 区域      | 内容                                                     | 可调 | 可折叠 |
| --------- | -------------------------------------------------------- | ---- | ------ |
| `top-bar` | logo + 搜索框 +（Tauri 桌面端）窗口控制与拖动热区        | —    | —      |
| `left`    | 侧边栏：活动栏选一个**视图容器**，容器内堆叠其所有视图（再点当前容器收起） | 宽   | ✅     |
| `center`  | Model 建模画布 + 可收起 DSL 编辑区                       | —    | ✅     |
| `right`   | AI / Properties 标签                                     | 宽   | ✅     |
| `bottom`  | Console（仅中央工作区下方，不贯穿左右）                  | 高   | ✅     |
| `status`  | 全局状态条：左段报工作区，右段报当前文档（见下）          | —    | —      |

运行环境状态（桌面自动管理；开发 fallback 才显示网关 URL / Connect）和外观主题在
**设置弹层**（活动栏 ⚙）。运行参数与控制属于具体实验，在**画布 Run 对话框**
（画布左上角 Run 按钮）。

### 状态栏（status）

两段式，中间由 `.status-spacer` 撑开：左段报告**工作区**，右段报告**当前文档**。

| 段 | 槽位                   | 数据来源                                                       |
| -- | ---------------------- | -------------------------------------------------------------- |
| 左 | 连接点                  | `legacyGatewayStore.conn` / `executionStore.session.status`     |
| 左 | `Backend:` 后端          | `executionStore.session.targetId`；无运行则退为唯一可用 target，**多枚时报数量**（tooltip 列全部）；无 target 不画 |
| 左 | 问题计数（错误/警告）    | `workbench/problems` 聚合；点击调 `requestOpenPanel('bottom','problems')` |
| 左 | `bad:` / `changed:` / 网关错误 | 解码坏帧数、磁盘外部改动、网关 error                       |
| 右 | `Ln x, Col y`           | 文本编辑器上报的 `uiStore.editorCaret`                          |
| 右 | 语言模式                | `documentContributionFor(path)?.label`                          |
| 右 | `Paradigm:` 范式         | **模型自己的 `use <name>` 声明**（`workbench/statusSlots.ts`）    |
| 右 | 通知铃铛                | 系统通知列表（外部改动）                                        |

三条硬约束：

- **槽位只报外壳已有的值**，没有数据源的槽位不画（设计稿里的分支与同步、缩进、编码、EOL
  在本仓库没有来源，所以不出现）。语言模式在无贡献时退化为**扩展名大写**，不发明语言名；
  问题计数为 0、`Paradigm:` 无声明、`Backend:` 无 target 时整块隐藏。
- **范式槽位只是「转发」**：内容来自模型文本里 `use <pack>` 解析出的节点
  （`declaredLibraries(document)`），外壳不知道 `process` 是什么意思。因此新增一个范式包
  **不需要改状态栏**，模型写上 `use <新包>` 槽位就亮。这与「范式由模型声明、外壳只给槽位」
  一致，也避免了把任何范式名写死进 chrome。
- **光标归属判定**：center 区域的面板是**常驻挂载**的（切标签不卸载），所以
  `editorCaret` 携带 `path`，且**只有 center 的前台面板等于
  `editorPanelFor(activeFile)` 时才显示**——否则切到建模画布后仍会显示上一个文件的位置。
- **状态栏永不换行**（`flex-wrap: nowrap`，左段 `overflow: hidden`）：过长的网关错误
  截断，不把状态栏撑成两行。

> **`Backend:` 这条链是通的**（一次早期的误判已更正，见
> [ADR-0138](../adr/0138-sysml-as-runtime-target.md)）：执行目标由 **Node 插件包**声明 ——
> 清单的 `executionTargets` 加 Node 入口导出的 `execute(request)` —— 由
> `NodePluginRuntime`（`@logicpilot/plugin-catalog`）在插件激活后注册、随代际撤回，且**先经
> 一个预备注册表校验**（owner 不匹配、或声明了 target 却没有可执行 provider，都会让整次激活
> 失败）。浏览器侧 `PluginHost` **刻意不持有**执行注册表，所以 IDE 走 app server 的
> `/api/execution/targets`，那是同一个注册表的 HTTP 面。**新增一个范式要带后端 = 发一个 Node
> 插件包，外壳与状态栏都不用动。** 内置的 **web** 包不声明 target，所以纯浏览器运行时看不到
> `Backend:` 的值 —— 这是设计如此，不是缺口。

**怎么验**：`pnpm --filter @logicpilot/ide verify:ui:runtime`（即 `ui-snapshot.mjs --runtime`）
会真起一次 Node 运行时 —— 生成运行时包 → `startNodePluginRuntime()` → 用真实注册表应答
`/api/execution/targets`，并把 `/api/execution/runs` 交给真实的 `ExecutionService`。因此两条分支
都有据：无运行时是 `Backend: 5 targets`（真实注册表每范式族一枚），跑完一次真执行后变成
`Backend: logicpilot.process.runtime`，`reset()` 后回到计数。两点须知：①脚本会
`process.chdir(repoRoot)` —— 运行时的模块加载 worker 继承工作目录，从包目录启动会抛
`DynamicEsmLoaderError: handler-failed`；②探针**只代替运输层**，执行本身是真的（真实内核、
真实 evidence、真实 run store 落盘）。

> **已知缺陷（这个槽位暴露出来的）**：连接点的 class 取自 `session.status`，而原生执行会话报的是
> **运行状态**（`queued` / `preparing` / `running` / `paused` / `finalizing` / `completed` …），
> 这些都没有 CSS 规则，只有 `connected` / `connecting` / `disconnected` 有 —— 会话活跃时圆点
> 本来是隐形的。现已加一个中性兜底色（`.status-bar .conn-dot`）保证它不至于消失，但**把运行
> 状态映射到「连接点」这个语义上本身就是混的**：该不该拆成「连接」与「运行」两个指示器，是
> 待决问题。

## 2. 面板注册表（内容与布局解耦）

`src/layout/panels.tsx`：

| PanelId      | title      | area   | container  | 说明                                                |
| ------------ | ---------- | ------ | ---------- | --------------------------------------------------- |
| `model`      | Model      | center | —          | 建模画布（Palette 拖放）                            |
| `ai`         | AI         | right  | —          | AI 模型面板                                         |
| `properties` | Properties | right  | —          | 选中块属性编辑                                      |
| `console`    | Console    | bottom | —          | 事件/诊断日志                                       |
| `explorer`   | Explorer   | left   | —          | 项目文件树（活动栏 Explorer；本身是一个视图容器）   |
| `navigator`  | Outline    | left   | `explorer` | 当前范式的语义模型树（`OUTLINE_CONTRIBUTIONS` host） |
| `palette`    | Palette    | left   | —          | 块库（活动栏 Palette）                              |

加新面板 = 注册一项，布局与路由不动。

### 视图容器（views-in-container）

`area: 'left'` 的区域**纵向堆叠**显示，而不是像 center/right/bottom 那样分页：

- **活动栏列出的单位是容器，不是单个视图**。点一个容器 = 左栏显示该容器；再点一次
  收起侧边栏。
- 一个容器把**所有 `container` 指向它的视图**渲染为纵向堆叠、可折叠的 section
  （`.panel-section` / `PanelSection`）。
- `container` 缺省 = 该面板**自成一个容器**，渲染为单 section。这是**纯增量**改动：
  既有的内置面板、以及插件通过 `registerPanel()` 注册的面板，行为与渲染都不变。
- 查询入口：`containerOf(panel)`、`containerViews(panels, anchor)`；活动栏的
  active 判定也走 `containerOf`（比容器而非比面板，否则容器内的第二节会点亮不了图标）。
- **声明即挂载**：`containerViews` = 区域自身的面板顺序（保序）**∪** 所有认领该容器的
  注册面板。所以**扩展只要 `registerPanel(id, { area:'left', container:'explorer', … })`
  就能往别人的容器里加一节**，不需要 `openPanel()`、不需要进 `DEFAULT_LAYOUT`、不需要改外壳。
  没有 `container` 的面板不受影响（自成一容器、仍需显式打开）——这正是分页区域不会被
  注册面板塞满的原因。
- 例：`navigator`（显示名 Outline）声明 `container: 'explorer'`，于是它是 Explorer
  容器里的第二节，**不再占据活动栏图标**。

## 3. layoutStore（zustand + persist）

```ts
interface AreaState {
  size: number; // left/right 宽、bottom 高（px）
  collapsed: boolean;
  activePanel: PanelId;
  panels: PanelId[];
}
interface LayoutState {
  areas: Record<AreaId, AreaState>; // center 无 size
  setSize(area, size): void;
  setSizeOrClose(area, size): void; // 拖过 min - CLOSE_OFFSET 则折叠
  reopenArea(area, size): void;
  removePanel(area, panel): void;
  toggleCollapse(area): void;
  setActive(area, panel): void;
  resetLayout(): void;
}
```

- `persist('logicpilot.layout', version 2)`；`merge` 丢弃已注销面板、修复激活
  标签。
- 尺寸 clamp：`left/right ∈ [120, 560]`，`bottom ∈ [60, 480]`；`CLOSE_OFFSET
= 24`（拖过最小值再折叠，防误触）。

## 4. 组件层

| 组件             | 职责                                                            |
| ---------------- | --------------------------------------------------------------- |
| `TopBar`         | logo + 搜索框 +（桌面端）窗口控制/拖动热区                      |
| `ActivityBar`    | 竖排图标（Explorer/Palette + 底部设置），切换左侧**视图容器**   |
| `Workspace`      | 读 layoutStore，渲染 CSS Grid 骨架 + TabBar + Splitter          |
| `PanelArea`      | 一个区域 = 标题栏/标签条 + 内容；left 堆叠 section，其余分页     |
| `PanelSection`   | 左栏一个堆叠视图：35px section 头（点击折叠）+ 常驻挂载的 body  |
| `TabBar`         | 标签条（center 每标签 ✕ + 撤销/重做；right/bottom 面板级 ✕）    |
| `Splitter`       | 1px 分隔条（不可见热区 ±3px），accent 条压在描边线上            |
| `ModelWorkspace` | 画布 + 可收起 DSL 编辑区（edge tab 拉手 + Compile）             |
| `RunDialog`      | 运行参数（按归属分两组，见下）+ Start/Pause/Resume/Step/Stop     |
| `StatusBar`      | 两段状态栏：左段工作区（连接点/`Backend:`/问题计数/外部改动），右段当前文档（光标/语言模式/`Paradigm:`）+ 通知铃铛 |

面板内容**常驻挂载 + CSS 显隐**：切换标签不丢 AI 状态，10 Hz 遥测只重渲染订阅
的面板（zustand selector）。选中块时右侧自动切到 Properties。

### 运行对话框（RunDialog）

运行参数按**归属**分两组，分界写在 `dsl-freeze.md` §3：

| 组 | 内容 | 来源 |
| -- | ---- | ---- |
| `Experiment (declared by the model)` | experiment 选择器、seed mode、seed、replications、reps/min/max、error percent、precision metric、confidence | 模型的 `experiment` 块（`workbench/experiments.ts` 读取） |
| `This run` | arrivals（终止条件）、warmup、execution mode、speed | 外壳的运行设置 |

- 模型声明了 experiment 时，对话框顶部出现**实验选择器**，并按其 `experimentSignature`
  预填模型拥有的字段；**签名不变则不重填**，因此文档每次按键重解析都不会覆盖用户正在
  输入的值。模型未声明时给占位值并提示补一个 `experiment` 块。
- **运行级字段永不写入模型**，模型也不得声明它们；反之 `seed` / `replications` 一族
  只由模型拥有，外壳不再提供第二个可编辑来源（这正是收敛掉的那处双重所有权）。
- 载荷不变：范式相关参数仍装在 `ExecutionRequest.inputs.runParams` 里送给后端，
  所有权只决定**谁编辑**，不改变传输。

## 5. CSS Grid 骨架（styles/layout.css）

```css
.workspace {
  display: grid;
  grid-template-columns: var(--left-w) var(--splitter-w) minmax(0, 1fr) var(--splitter-w) var(
      --right-w
    );
  grid-template-rows: minmax(0, 1fr) var(--splitter-w) var(--bottom-h);
  grid-template-areas:
    'left sl center sr right'
    'left sl sb    sr right'
    'left sl bottom sr right';
}
```

`--splitter-w: 1px`：面板近乎贴边，分隔条用不可见 `::before` 热区（±3px）保证
可拖拽，accent 高亮条压在面板描边线上。尺寸作为 CSS 变量由 store 注入；
Splitter 只改数值。

## 6. 回归

- 单测：layoutStore reducer（setSize/toggle/setActive/removePanel/persist
  merge）、面板注册表完整性、`workbench/experiments.ts`（真实 DSL 文本 → 读取 →
  应用，含「运行级字段不被模型覆盖」与「签名不变不重填」两条边界）、
  `plugins/runParameters.test.ts`（包声明的运行参数经注册表暴露、卸载即撤回、
  未声明则什么也不加、节奏字段不属包）。
- 浏览器 E2E：`web/apps/ide/scripts/browser-verify.mjs` 覆盖连接/运行/编译/
  AI 全流程；`pnpm typecheck/build/test` 不回归。
- 目检探针 `verify:ui`（`scripts/ui-snapshot.mjs`）含两步**运行对话框**检查：
  ①**归属**：往编辑器写入带 `experiment` 的模型，先把外壳的 seed 改成 99、warmup
  改成 1234，再打开对话框断言 `seed` 显示模型声明的值而 `warmup` 保留外壳的值；
  ②**词表来源**：切到 precision 模式后读候选表，断言选项顺序是包声明的顺序
  （`Wq` 开头），外壳原先那张硬编码表的顺序（`throughput` 开头）无法产生它。
- 契约改动必须 `node scripts/check-contract-conform.mjs` 通过，并把新 schema 复制进
  `schemas/contracts/baseline/`（加法式可选字段允许；**enum 收窄与放宽都算破坏性**，
  要按 [ADR-0139](../../docs/adr/0139-open-evidence-method-ids.md) 那样显式接受）。
  开放后的 id 形状仍有约束：`web/packages/contracts/test/contracts.test.ts` 断言
  未列出的 method id 被接受、而 `"Process Family"` 这种非 id 仍被拒绝。
- **范式词表**：`pnpm run check:vocabulary`（已挂进根 `pnpm test` 链）——扫外壳源码与契约
  里的范式字面量，见 §7「词表门禁」。加范式词 = 改包，不是改外壳。

## 7. 阶段 2 扩展点

阶段的 `areas` 是退化的分割树；后续可将 `AreaState` 换成通用节点（tabs/split），
实现拖拽停靠/标签合并/编辑器拆分，`persist` 与 `Workspace` 渲染平滑迁移，
面板注册表不动。

内容扩展采用 provider，而不是继续扩大 `PanelId`/模型 kind 的全局 switch：

- center editor 由 `EditorProvider` 按 document type 注册；
- Project 树是 `OutlineProvider` 的通用 host；
- Palette、Properties、Diagnostics 与 AI 均由活动文档贡献；
- 同一 `DocumentSession` 可同时打开文本、图形和追踪视图；
- 活动选择没有 execution target 时不显示无意义的 Run；SysML behavior/analysis 等
  受支持目标可贡献自己的 Run/Analyze/Verify 动作。

### 范式无关：已收口的四层，与仍然残留的部分

**已收口**（这条线上的四处，新增范式都不必改它们）：

- 状态栏槽位（`Paradigm:` 转发模型的 `use`、`Backend:` 取 target 注册表）
- 左栏视图容器（活动栏列容器，视图带 `container` 声明即可挂载）
- 运行参数归属（`dsl-freeze.md` §3）与**运行参数表由包贡献**（见下）
- **证据方法 id 开放**（[ADR-0139](../../docs/adr/0139-open-evidence-method-ids.md)）：
  `ExecutionEvidence` 的 `methods` / `runtimeKind` / `method` / `details.kind` 不再是
  `"process" | "devs" | ...` 闭集，改为开放的 `MethodId`（按 id 形状校验）。

⚠️ **不得因此说"已无残留"**（本文件曾如此断言，2026-10-11 复核后更正）。仍有两处：

- **契约 `view-notation.schema.json` 的 `CanvasEngineId`** 里混着范式/记号名：
  `flow` / `statechart` / `sequence` / `stock-flow` / `causal-loop`（与 `graph2d` /
  `scene3d` / `table` / `chart` / `text` 这类**机制 id** 并列）。新增一个自带画布引擎的
  范式仍要改契约。注意这正是当初 `flow` 漏进大纲副标题的同源问题。
- **`model/blockDefs.ts` 仍是外壳里的图元库目录**（内置 AnyLogic 派生库的目录数据）。
  把它移进范式包是**独立的一步**，尚未做；但**读取路径已收口**，见下。

**调色板/图元层的两条路已收口**（2026-10-12）：

1. **一条读取路径**。`PalettePanel` 原先同时读 `PALETTE_CONTRIBUTIONS` 与
   `structuredPaletteItems()`（清单 `palettes` 键）。后者**恒为空**：它给出的库 id 是
   `pluginId:contributionId` 形式，而面板比的是裸库 id（`process` 等），永远匹配不上。
   现在只剩一条路，那两条死代码（`paletteItems()` / `structuredPaletteItems()`）已删除。
   契约的 `palettes` 键保留（删它是破坏性变更），但**当前不被 IDE 调色板读取**。
2. **库清单只剩一份声明**。`LibraryId` 联合与 `LIBRARIES` 数组原先是同一份七库清单的两遍
   手抄（`LIBRARIES` 的各条还各写两遍 id 与 name）；现在由 `LIBRARY_IDS` 单一元组派生，
   并有测试钉住「声明 == 目录实际用到的库」。
3. **容器种类走注册缝**。`CANVAS_CONTAINER_KINDS` 原由 `blockDefs` 直接导出、被
   `ModelCanvas` 与 `dslOutlineContribution` 直接 import；现在经
   `ModelSemanticProvider.isCanvasContainer` 与 `modelIsCanvasContainer()` 读取。
   在零插件（回退关闭）时它自然为空，与「零范式启动没有 Process 语义」一致。

于是**替换这份目录只需换提供者**，调色板与画布的消费方不用改。

**已偿还的三笔**（2026-10-12）：门禁台账里最早那三笔已还清 ——

1. `layout/PalettePanel.tsx` 的三处 `library ?? 'process'`（外壳把 `process` 当默认库）。
   第一处还兼修了一个**隐性 bug**：拖拽会话把无主的块当成 `process` 块，于是自定义库的块
   被拖到画布上会按 **process** 插入；现在无主块得不到贡献，`endDrag` 直接返回。
2. `state/runStore.ts` 把 `precisionMetric` 默认成 `'Wq'`。现在外壳默认**空串**（=「尚无
   声明」），由对话框落回**包的声明首选项**；`RunDialog` 的 `effectiveMetric` 同时供下拉
   与 `buildOptions`，所以显示与发出永远一致。
3. `ai/api.ts` 的 `AiRuntimeKind` 闭集 —— ADR-0139 的结论在 AI 端点的翻版。现在开成
   `string`；端点对未知族名本就是**优雅回落**（`AI_EXECUTION_TARGETS` 未命中 → 走兼容
   runner），所以客户端不该替它枚举。

三处都已从 `check-paradigm-vocabulary.mjs` 的 `ALLOWED` 里删掉 —— 现在再写回去，门禁会红。

另有一处耦合**不是范式词汇**：`RunOptions` 仍是固定形状，所以对话框把声明里的 `id`
映射到草稿值时只认得它已有的存储（`arrivals` / `warmup`）。**包声明了一个外壳没有存储的
id，那一项会被跳过而不是猜一个值。** 真正的解法是把 `RunOptions` 拆成「模型拥有 / 运行
拥有」两半，或给运行级参数一个通用袋；那会改变 wire 载荷，单独决策。

### 词表门禁（2026-10-11 补上，此前这条不变式只有散文在守）

上面那些残留**不是靠自觉发现的，是靠人肉 grep**。原有的两个门禁都管不了它们：

- `zero-paradigm-verify`：查**零插件**时贡献注册表为空、无 console 错误、能编辑纯文本。
- `paradigm-lifecycle-verify`：查**贡献随插件生命周期**出现/消失。

两者都只看**运行期行为**，不读**源码文本**，所以一处 `['process','devs',...]` 硬编码
可以安然通过它们。现在补上第三个：

**`scripts/check-paradigm-vocabulary.mjs`**，入口 `pnpm run check:vocabulary`，**已挂进
根 `pnpm test` 链**（纯静态扫描，不需要浏览器与网关，因此可以进主链）。规则：

- 扫 `web/apps/ide/src`（排除 `plugins/builtin/` 与 `*.test.*`）与 `schemas/contracts`。
- **命中 = 值恰好等于范式名的字符串字面量**（`'process'`），先剥注释。`'logicpilot.paradigm.statechart'`
  这类**更长的标识符不算**——壳层写的是 id，不是范式名本身。
- **契约只扫 `enum` 成员**：契约的泄漏面就是封闭枚举；`"source"` 在别处是「产源」语义，
  按全量字面量扫会变成噪声。
- 两份清单含义不同：`ALLOWED` 是**已知违规**（逐条写明理由），`NOT_VOCABULARY` 是**同形
  异义词**（如 artifact graph 的 `createdBy: 'agent'` 指 AI 而非 `agent` 范式）。
- 登记粒度是 **(文件， 词) 对**：移除永不失败，但**已登记文件里出现另一个范式词仍会失败**。

实测 138 处已知命中、28 个欠债文件 + 1 个同形异义文件（2026-10-12，首日 146/31）；注入
「未登记文件里的字面量」与「已登记文件里的新词」两类人为违规，**都被拦下且退出码 1**。
清单本身就是**这份欠债的台账**，随残留逐条偿还而收缩。

### 运行参数表由包贡献

`PluginContributionSet.runParameters`（可选键，加法式扩展，见
`schemas/contracts/plugin-contributions.schema.json`）声明范式包为 run 对话框贡献的字段：

| 字段 | 含义 |
| ---- | ---- |
| `id` | 参数名，同时也是 `inputs.runParams` 里的键 |
| `label` / `hint` | 界面标签与提示 |
| `kind` | `integer` / `number` / `text` / `boolean`，决定渲染什么控件 |
| `owner` | `model`（值由模型的 `experiment` 块给）或 `run`（值属本次运行） |
| `minimum` / `maximum` | 数值范围 |
| `choices` | 候选值与显示名；有 choices 时渲染为下拉 |

`plugins/builtin/des/contributions.json` 声明了 `metric`（`owner: model`，候选为 des 认得的
指标名）、`arrivals` 与 `warmup`（`owner: run`）。**执行模式与速度不由包声明**：它们是
节奏控制，属外壳行为，与范式语义无关。

外壳据此渲染，不再持有任何范式词表——`RunDialog` 里原先那张硬编码的 precision metric
列表已删除。读取入口是 `plugins/registry.ts` 的 `runParameterDeclarations()`。

## 8. 主题系统

- 三态主题（`state/themeStore.ts`）：`light` / `dark` / `system`，persist 到
  localStorage；`system` 实时跟随 `prefers-color-scheme`。
- 实现：`ThemeManager` 写入 `<html data-theme>`，`base.css` 以 `:root`（dark）
  - `:root[data-theme='light']` 两套 CSS 变量切换整个设计系统。
- 新主题 = 增加 `data-theme` 取值的变量覆盖块；组件只引用变量，不写死颜色。
- 切换入口：设置弹层（活动栏 ⚙）的 Appearance 段。
