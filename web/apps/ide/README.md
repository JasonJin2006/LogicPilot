# LogicPilot IDE — 最薄 2D 可视化切片

Vite 6 + React 19 + TypeScript 浏览器前端：连接 lp-server 网关、解码
size-prefixed LPWR FlatBuffers 遥测帧、PixiJS 8 渲染 M/M/1 排队动画、
uPlot 绘制实时计数折线。

## 依赖结构

- `@logicpilot/protocol` — flatc 生成的 wire/ir TS 绑定。
- `@logicpilot/renderer2d` — 纯函数 wire 帧解码（无 DOM，为 Worker 化预留）。
- 本应用 — WebSocket 传输、PixiJS 场景、uPlot 折线、控制面板。

## 开发步骤（Windows PowerShell）

```powershell
# 1. 启动网关（仓库根目录；首次构建参考 scripts/build-hello-kernel.ps1）
.\build\integration-dev\kernel\apps\lpcli\lpcli.exe serve examples/mm1.lp --port 8089 --seed 42

# 2. 安装 workspace 依赖（仓库根目录，pnpm 经 corepack 提供）
pnpm install

# 3. 启动 Vite dev server（本目录或根目录 pnpm dev）
pnpm dev
# -> http://localhost:5173
```

浏览器打开 `http://localhost:5173`：

1. 地址栏默认 `ws://127.0.0.1:8089/sim`（直连网关，无需代理），点 **Connect**。
2. 设置 seed/reps/arrivals/warmup/speed（可留默认 42/3/4000/400/10），点 **Start**。
3. 左侧为排队动画（服务台 busy 时高亮；顾客按 `Tick.deltas.pos_x` 排布，
   id 稳定，10 Hz 数据经线性插值在 rAF 循环中平滑移动）；
   右侧为 `queue_length / throughput / mean_wait` 滚动折线；
   底部状态栏显示帧 seq、sim_time、渲染 FPS 与网关 ack。
4. 运行结束（RunFinished）后右下方面板展示跨 replication 统计与 Student-t CI。
   Pause / Resume / Step / Stop / Set speed 按钮对应网关 JSON 控制指令。

## 构建与校验

```powershell
pnpm build        # tsc --noEmit + vite build（根目录 pnpm -r build）
pnpm typecheck    # 仅 tsc --noEmit
pnpm test         # @logicpilot/renderer2d 解码单元测试（Vitest）
```

## 备注

- 遥测为二进制帧：4 字节 size 前缀 → FlatBuffer（identifier `LPWR`，
  version 1）→ `FrameHeader` + payload union（见 `schemas/wire.fbs`）。
- 解码位于 `web/packages/renderer2d/src/decode.ts`，纯函数、零 DOM 依赖；
  后续可将该模块移入 Web Worker 而无需改动应用层。
