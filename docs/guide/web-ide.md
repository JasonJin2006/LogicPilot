# Web IDE 使用

Web IDE（浏览器 `http://localhost:5173`，或打包的桌面客户端）是仿真建模与
运行的前端：连接网关、拖拽建模、编译、运行、AI 生成与优化。

## 启动

```powershell
pnpm --filter @logicpilot/ide dev      # 浏览器模式（vite，http://localhost:5173）
# 或桌面客户端（Tauri）：
pnpm --filter @logicpilot/ide build
cargo build --manifest-path desktop/src-tauri/Cargo.toml
desktop/src-tauri/target/debug/logicpilot-desktop.exe
```
## 连接

IDE 启动时自动连接网关：桌面客户端自动拉起 lp-server 并使用它的地址；
浏览器模式默认连接 `ws://127.0.0.1:8089/sim`（网关未就绪时自动重试，失败后
状态栏红点提示）。活动栏齿轮打开**设置**可改网关地址并手动
**Connect / Disconnect**。连接状态显示在底部状态栏（圆点 + FPS + 通知铃铛）。

## 建模画布

- **Palette**（左侧）：库选择条（All / Recent / process / presentation /
  statechart / action / 导入的自定义库），块拖到画布。
  - `process` 流程库：source / queue / delay / service / sink / split /
    batch / seize / release 等 39 个块（23 常用 + 16 新增 AnyLogic PML 块），
    带 in/out 端口可连线。
  - `presentation` 演示库：矩形/椭圆/线/文本等绘图形状，渲染为真实 SVG。
  - `statechart` / `action`：状态图与行动图元素（画布建模，语义落内核为后续）。
- 画布：滚轮缩放、空白拖动平移、坐标网格；端口拖出连线（点击连线删除）。
- **Properties**（右侧）：选中块后编辑名称与字段（AnyLogic 风格参数）。
- **DSL 编辑区**：画布右侧可收起的代码区，Show DSL / Compile（诊断回显
  Console）。
- 撤销/重做：`Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`；Project 面板可新建模型。

> 注意：模型与工程是**会话态**——客户端每次启动都从空白状态开始，不会
> 恢复上次打开的工程；继续之前的工程请用 **File > Open Recent** 或
> **File > Open...** 重新打开。

## 工程保存 / 打开

工程是工作单元（`*.lpproj` 单文件打包，格式见[工程格式 v2](../specs/project-format-v2)）：
- **File > New Project...**（Ctrl+N）：输入工程名与所在文件夹，桌面客户端会在该文件夹生成 `工程名/` 目录（`logicpilot.json`、`model/main.lp`、`presentation/main.canvas.json`、`build/`、`results/`）；浏览器模式随时可用（内存工程）。编辑后 Explorer 根部显示脏点，Save 直接写回工程目录
- **File > Save**：把画布模型（含坐标/连线/参数）与生成的 DSL 一起存成
  `*.lpproj`，重新打开时布局完整还原。
- **File > Open... / Open Recent**：打开 `*.lpproj` 工程；旧 `.lp` / `.json`
  单模型文件仍可打开（无布局信息）。

## 运行

画布左上角 **Run** 打开运行对话框：seed / reps / arrivals / warmup / speed
参数 + Start / Pause / Resume / Step / Stop。空画布运行网关内置模型；有画布
模型时先编译再带模型参数运行，运行中画布块显示实时队列长度与忙/闲状态点。

## AI 面板（右侧）

| 按钮 | 作用 | 示例 |
|---|---|---|
| `generate + run` | 生成 DSL → 编译修复 → 运行；可 **Load to canvas** 加载进画布 | "build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0" |
| `optimize` | 在声明区间内搜索最优参数 | "minimize Wq over servers 1..4 for an M/M/1 queue with arrival 0.8 and service 1.0" |
| `explain` | 运行后给出瓶颈归因 | 同一 M/M/1 提示词 |

## 数据流

```text
lp-server (C++) ── WebSocket(wire.fbs, LPWR) ──► SimClient ──► vizState ──► 画布实时徽标
     │                                              └─► Console 事件日志
     └── /api/ai-build|optimize|explain（Node 后端，vite dev 或 app/server.mjs）
```

帧协议为冻结契约 F2（FlatBuffers size-prefixed），C++ 与 TS 双向互操作由
CI 逐字段校验（见[确定性与契约](./determinism)）。
