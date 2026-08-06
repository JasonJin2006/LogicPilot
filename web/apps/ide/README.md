# LogicPilot IDE

浏览器前端（Vite 6 + React 19 + TypeScript + zustand）：拖拽建模画布、DSL
编译诊断、WebSocket 实时运行可视化、AI 建模/优化/归因面板，以及工程保存/打开。
桌面客户端（Tauri）是同一前端的外壳，见 `desktop/README.md`；用户操作指南见
`docs/manual/04-web-ide.md`。

## 依赖结构

- `@logicpilot/protocol` — flatc 生成的 wire/ir TS 绑定。
- `@logicpilot/editor` — 图文档模型、DSL v2 生成器（`generateDsl` /
  `parseDsl` / `modelRunParams`）、块库元数据。
- `@logicpilot/renderer2d` — 纯函数 wire 帧解码（无 DOM，为 Worker 化预留）。
- 本应用 — 面板系统（`src/layout`）、建模画布（`src/model`）、Presentation
  矢量编辑器（`src/presentation`）、工程（`src/project`）、运行状态
  （`src/run`/`src/state`）、AI 面板（`src/ai`）。

## 开发步骤（仓库根目录）

```powershell
# 1. 启动网关（编译 DSL 并开服；或 lp-server --model-file <ir>）
lpcli serve examples/mm1.lp --port 8089 --seed 42

# 2. 安装 workspace 依赖
pnpm install

# 3. 启动 Vite dev server
pnpm --filter @logicpilot/ide dev
# -> http://localhost:5173
```

IDE 启动时自动连接网关（桌面客户端自动拉起 lp-server；浏览器模式默认
`ws://127.0.0.1:8089/sim`，可在设置中修改并手动 Connect/Disconnect）。

## 功能一览

- **Palette**（左侧）：`process`（39 块，AnyLogic PML）/ `presentation` /
  `statechart` / `action` 四个库，拖到画布；最近使用（Recent）与自定义库导入。
- **Model 画布**（中央）：SVG 块 + 端口连线（`out → in`，点击连线删除）、
  网格/缩放/平移、选中块 Properties 编辑（AnyLogic 风格字段）、撤销/重做、
  编组/对齐/层级、Presentation 矢量形状（矩形/椭圆/线/文本/图片/路径/分组/
  Frame + 绑定）。
- **DSL 编辑区**：画布旁可收起代码区，Show DSL / Compile（诊断回显
  Console）。
- **Run**（画布左上角）：seed / reps / arrivals / warmup / speed +
  Start / Pause / Resume / Step / Stop；运行中画布块显示实时队列长度与
  忙/闲/宕机状态点。
- **AI 面板**（右侧）：`generate + run`（NL → DSL → 编译修复 → 运行，
  Load to canvas）、`optimize`（声明区间内搜索）、`explain`（瓶颈归因）。
- **工程**：`*.lpproj` 单文件打包 + agent-centric 目录；会话态启动（每次从
  空状态开始，Open Recent / Open 重新打开）。

## 构建与校验

```powershell
pnpm --filter @logicpilot/ide build     # tsc --noEmit + vite build
pnpm --filter @logicpilot/ide typecheck # 仅 tsc --noEmit
pnpm test                               # workspace：editor / renderer2d / protocol vitest
node web/apps/ide/scripts/browser-verify.mjs  # 浏览器 E2E（需网关）
```

## 备注

- 遥测为二进制帧：4 字节 size 前缀 → FlatBuffer（identifier `LPWR`，
  version 1）→ `FrameHeader` + payload union（见 `schemas/wire.fbs`）。
- 解码位于 `web/packages/renderer2d/src/decode.ts`，纯函数、零 DOM 依赖；
  运行可视化用 PixiJS 渲染循环（`src/state/vizState.ts`），画布徽标由
  `SimClient` → `vizState` 驱动。
