# Web IDE 使用

Web IDE（`http://localhost:5173`）是仿真运行的**可视化前台**：连接网关、配置运行、观看动画、读取统计，并在右侧 AI 面板完成"自然语言 → 模型 → 优化"闭环。

## 启动

```powershell
lpcli serve examples/mm1_failure.lp --port 8089   # 终端 1：网关
pnpm dev                                          # 终端 2：IDE，http://localhost:5173
```

## 连接与运行

1. 页面左上角 **Connect**：连上 `ws://127.0.0.1:8089/sim`，状态变绿
2. 设置参数：`arrivals`（到达数）、`warmup`（预热剔除）、`speed`（墙钟倍速，不影响仿真结果）、`reps`（重次数）
3. **Start** 开始；运行中可 **Pause / Resume / Step / Stop**，`speed` 随时调节
4. 底部状态栏显示连接状态、帧序号 `seq`、仿真时间 `sim_time`、渲染 FPS 与最近 ack

## 视图

- **队列动画**（PixiJS 2D）：实体进入排队区，绿色方块代表服务中，红色代表宕机服务器
- **实时图表**（uPlot ×3）：随遥测帧滚动更新
- **统计面板**：`RunFinished` 后显示 Wq/throughput/L/Lq 等均值与 95% CI

## AI 面板

输入自然语言提示词，三个按钮：

| 按钮 | 作用 | 示例 |
|---|---|---|
| `generate + run` | 生成 DSL → 编译修复 → 运行，显示摘要与（连续模型的）轨迹曲线 | "build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0" |
| `optimize` | 在声明区间内搜索最优参数，绘制优化曲线 | "minimize Wq over servers 1..4 for an M/M/1 queue with arrival 0.8 and service 1.0" |
| `explain` | 运行后给出瓶颈归因 | 同一 M/M/1 提示词 |

详见 [AI Copilot](./05-ai-copilot)。

## 数据流

```text
lp-server (C++) ── WebSocket ──► SimClient ──► vizState ──► PixiJS 队列视图
    │                                   └──────► uPlot 图表
    └─ wire.fbs 帧（LPWR，FlatBuffers 二进制，size-prefixed）
```

帧协议为冻结契约 F2，C++ 与 TS 双向互操作由 CI 逐字段校验（见 [确定性复现与契约](./06-determinism)）。
