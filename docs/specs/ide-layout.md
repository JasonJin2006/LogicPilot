# Web IDE 布局与面板系统

Status: **已完成**（2026-08-05 落地，2026-08-06 现状）· 对应 roadmap P1-6

## 0. 定位

LogicPilot IDE 的布局形态融合 **VS Code 的壳**（活动栏 + 侧边栏 + 多标签工作区 +
底部面板 + 全局状态栏，全部可调/可折叠/可持久化）与 **AnyLogic 的建模语义**
（模型树、块库 Palette、属性 Properties、画布居中）：

```text
┌──────────────────────────────────────────────────────────────┐
│ TopBar：logo + 搜索框 +（桌面端）窗口控制                        │
├──────┬─────────────────────────────┬─────────────────────────┤
│ 活动栏 │ 中央工作区：Model 建模画布      │ AI / Properties 标签    │
│      │   + 可收起 DSL 编辑区          │                        │
│ 左侧  ├─────────────────────────────┤                        │
│ Project│ Console（事件/诊断日志）       │                        │
│ Palette├─────────────────────────────┴─────────────────────────┤
│      │ status：连接点 · FPS · 通知铃铛  │                        │
└──────┴────────────────────────────────────────────────────────┘
```

决策（roadmap P1-6）：**自研**面板系统，不引 FlexLayout / rc-dock，零新依赖，
复用 zustand 域 store 模式。布局与内容解耦：`panels.tsx` 注册面板，
`layoutStore` 只描述几何（尺寸/折叠/激活标签/标签顺序）。

## 1. 布局区域

| 区域       | 内容                                                        | 可调 | 可折叠 |
| ---------- | ----------------------------------------------------------- | ---- | ------ |
| `top-bar`  | logo + 搜索框 +（Tauri 桌面端）窗口控制与拖动热区              | —    | —      |
| `left`     | 侧边栏（活动栏切换 Project / Palette，再点当前视图收起）      | 宽   | ✅     |
| `center`   | Model 建模画布 + 可收起 DSL 编辑区                            | —    | ✅     |
| `right`    | AI / Properties 标签                                        | 宽   | ✅     |
| `bottom`   | Console（仅中央工作区下方，不贯穿左右）                       | 高   | ✅     |
| `status`   | 全局状态条（连接点、FPS、通知铃铛）                           | —    | —      |

连接配置（网关 URL / Connect）、外观主题在**设置弹层**（活动栏 ⚙）。运行参数
与控制属于具体实验，在**画布 Run 对话框**（画布左上角 Run 按钮）。

## 2. 面板注册表（内容与布局解耦）

`src/layout/panels.tsx`：

| PanelId     | title   | area    | 说明                     |
| ----------- | ------- | ------- | ------------------------ |
| `model`     | Model   | center  | 建模画布（Palette 拖放） |
| `ai`        | AI      | right   | AI 模型面板              |
| `properties`| Properties | right | 选中块属性编辑          |
| `console`   | Console | bottom  | 事件/诊断日志            |
| `modelInfo` | Project | left    | 模型树/摘要（活动栏 Project）|
| `palette`   | Palette | left    | 块库（活动栏 Palette）   |

加新面板 = 注册一项，布局与路由不动。

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

| 组件           | 职责                                                  |
| -------------- | ----------------------------------------------------- |
| `TopBar`       | logo + 搜索框 +（桌面端）窗口控制/拖动热区              |
| `ActivityBar`  | 竖排图标（Project/Palette + 底部设置），切换左侧面板    |
| `Workspace`    | 读 layoutStore，渲染 CSS Grid 骨架 + TabBar + Splitter |
| `PanelArea`    | 一个区域 = TabBar + 内容；折叠态不渲染标题栏            |
| `TabBar`       | 标签条（center 每标签 ✕ + 撤销/重做；right/bottom 面板级 ✕）|
| `Splitter`     | 1px 分隔条（不可见热区 ±3px），accent 条压在描边线上     |
| `ModelWorkspace` | 画布 + 可收起 DSL 编辑区（edge tab 拉手 + Compile）     |
| `RunDialog`    | 运行参数 + Start/Pause/Resume/Step/Stop                |

面板内容**常驻挂载 + CSS 显隐**：切换标签不丢 AI 状态，10 Hz 遥测只重渲染订阅
的面板（zustand selector）。选中块时右侧自动切到 Properties。

## 5. CSS Grid 骨架（styles/layout.css）

```css
.workspace {
  display: grid;
  grid-template-columns: var(--left-w) var(--splitter-w) minmax(0, 1fr) var(--splitter-w) var(--right-w);
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
  merge）、面板注册表完整性。
- 浏览器 E2E：`web/apps/ide/scripts/browser-verify.mjs` 覆盖连接/运行/编译/
  AI 全流程；`pnpm typecheck/build/test` 不回归。

## 7. 阶段 2 扩展点

阶段的 `areas` 是退化的分割树；后续可将 `AreaState` 换成通用节点（tabs/split），
实现拖拽停靠/标签合并/编辑器拆分，`persist` 与 `Workspace` 渲染平滑迁移，
面板注册表不动。

## 8. 主题系统

- 三态主题（`state/themeStore.ts`）：`light` / `dark` / `system`，persist 到
  localStorage；`system` 实时跟随 `prefers-color-scheme`。
- 实现：`ThemeManager` 写入 `<html data-theme>`，`base.css` 以 `:root`（dark）
  + `:root[data-theme='light']` 两套 CSS 变量切换整个设计系统。
- 新主题 = 增加 `data-theme` 取值的变量覆盖块；组件只引用变量，不写死颜色。
- 切换入口：设置弹层（活动栏 ⚙）的 Appearance 段。
