# Web IDE 布局与面板系统设计（阶段 1）

Status: **实现中**（2026-08-04）· 对应 roadmap P1-6 前置条目

## 0. 定位

LogicPilot IDE 的布局形态融合 **VS Code 的壳**（活动栏 + 侧边栏 + 多标签工作区 +
底部面板 + 全局状态栏，全部可调/可折叠/可持久化）与 **AnyLogic 的建模语义**
（模型树、块库 Palette、属性 Properties、画布居中）：

```text
┌──────────────────────────────────────────────────────────────┐
│ header   品牌 · 连接条 · 运行控制（全局，始终可见）            │
├──┬───────────┬──────────────────────────┬────────────────────┤
│活│ 侧边栏     │ 中央工作区（tabs）        │ 右侧面板（tabs）    │
│动│ Run 视图   │ ▸ Queue（队列可视化）     │ ▸ Counters         │
│栏│ Model 视图 │   Model（建模画布·未来）   │   Results          │
│  │ Palette   │                          │   AI               │
│  │ AI 视图    │                          │   Properties（未来）│
├──┴───────────┴──────────────────────────┴────────────────────┤
│ bottom  控制台 / 输出 / 编译诊断（可折叠）                     │
├──────────────────────────────────────────────────────────────┤
│ status  连接 · seq · sim_time · FPS · 模型                   │
└──────────────────────────────────────────────────────────────┘
```

决策（roadmap P1-6）：**自研**面板系统，不引 FlexLayout / rc-dock，零新依赖，
复用 zustand 域 store 模式。阶段 1 = 固定区域 + 面板注册表；阶段 2 将"区域"
升级为递归分割树（拖拽停靠 / 标签合并 / 拆分）。

## 1. 布局区域

| 区域 | 内容 | 可调 | 可折叠 |
|---|---|---|---|
| `header` | 品牌、连接条、运行控制 | — | — |
| `activity` | 活动栏（竖排图标，切换侧边栏视图） | — | — |
| `left` | 侧边栏（跟随活动栏：Run / Model / Palette / AI 视图） | 宽 | ✅ |
| `center` | 工作区标签页（Queue 可视化、未来建模画布/3D） | — | — |
| `right` | 上下文面板（Counters / Results / AI / 未来 Properties） | 宽 | ✅ |
| `bottom` | 控制台 / 输出 / 编译诊断 | 高 | ✅ |
| `status` | 全局状态条（连接、seq、sim_time、FPS、模型） | — | — |

## 2. 面板注册表（内容与布局解耦）

```ts
interface PanelDef {
  title: string;
  area: AreaId;          // left | center | right | bottom
  view?: ActivityView;   // 侧边栏面板跟随的活动栏视图（仅 left）
  component: ComponentType;
}
```

当前注册表（`src/layout/panels.tsx`）：

| PanelId | title | area | 说明 |
|---|---|---|---|
| `queue` | Queue | center | PixiJS 队列可视化 |
| `counters` | Counters | right | uPlot 实时图表 |
| `results` | Results | right | RunFinished 统计 |
| `ai` | AI | right | AI 模型面板 |

未来：`modelTree`(left/Model)、`palette`(left/Palette)、`properties`(right)、
`console`/`diagnostics`(bottom)。加新面板 = 注册一项，布局与路由不动。

## 3. layoutStore（zustand + persist）

```ts
interface AreaState {
  size: number;          // left/right 宽、bottom 高（px）
  collapsed: boolean;
  activePanel: PanelId;
  panels: PanelId[];     // 该区域标签顺序（阶段 2 拖拽合并修改这里）
}
interface LayoutState {
  areas: Record<AreaId, AreaState>;   // center 无 size
  activityView: ActivityView;         // 当前活动栏视图（驱动 left 内容）
  setSize(area, size): void;          // clamp 到 [min, max]
  toggleCollapse(area): void;
  setActive(area, panel): void;
  setActivityView(view): void;
  resetLayout(): void;
}
```

- `persist('logicpilot.layout')` 持久化；`merge` 处理旧版本/缺省值。
- 尺寸 clamp：`left/right ∈ [240, 560]`，`bottom ∈ [120, 480]`。
- 折叠时区域只显示 TabBar（或活动栏图标提示）。

## 4. 组件层

| 组件 | 职责 |
|---|---|
| `Workspace` | 读 layoutStore，渲染 CSS Grid 骨架 |
| `ActivityBar` | 竖排图标（Run/Model/Palette/AI），切换 `activityView` |
| `PanelArea` | 一个区域 = `TabBar` + 内容；折叠态处理 |
| `TabBar` | 标签条（点击切换；阶段 2 加拖拽） |
| `Panel` | 单个面板的边框容器 |
| `Splitter` | 拖拽分隔条（pointer events）→ `setSize`；双击折叠 |

面板内容**常驻挂载 + CSS 显隐**：切换标签不丢图表/AI 状态，10 Hz 遥测只重渲染
订阅的面板（zustand selector）。

## 5. CSS Grid 骨架（styles/layout.css）

```css
.app-body {
  display: grid;
  grid-template-columns: 48px var(--left-w) minmax(0, 1fr) var(--right-w);
  grid-template-rows: minmax(0, 1fr) var(--bottom-h);
  grid-template-areas:
    "activity left center right"
    "activity bottom bottom bottom";
}
```

尺寸作为 CSS 变量由 store 注入；Splitter 只改数值，不触发整树重排。

## 6. 迁移与回归

- `App.tsx` 的 `viz-column`/`side-column`/tabs 状态替换为 `<Workspace/>`；
  `header`/`RunToolbar`/`StatusBar` 保留（StatusBar 移到底部全局）。
- 面板组件（QueueView/ChartPanel/ResultsPanel/AIPanel）与语义 class 保留，
  `browser-verify` DOM 断言兼容；默认布局保持 Charts 可见。
- 单测：layoutStore reducer（setSize/toggle/setActive/activityView/persist merge）、
  面板注册表完整性（唯一 id、默认 area、left 面板有 view）。
- 验收：面板可折叠/调宽/标签切换、布局刷新后保持、E2E 全绿、
  `pnpm typecheck/build/test` 不回归。

## 7. 阶段 2 扩展点

阶段 1 的 `areas` 是退化的分割树；阶段 2 将 `AreaState` 换成通用节点：

```ts
type LayoutNode =
  | { type: 'tabs'; panels: PanelId[]; active: PanelId }
  | { type: 'split'; dir: 'row' | 'column'; children: LayoutNode[]; sizes: number[] };
```

拖拽停靠 / 标签合并 / 编辑器拆分 = 树的变换；序列化仍是 JSON，`persist` 与
`Workspace` 渲染平滑迁移，面板注册表不动。
