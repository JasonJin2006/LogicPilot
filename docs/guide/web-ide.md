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
**Connect / Disconnect**。连接状态显示在底部状态栏（圆点 + 通知铃铛）。

## 建模画布

- **Palette**（左侧）：库选择条（All / Recent / process / presentation /
  statechart / action / 导入的自定义库），块拖到画布。
  - `process` 流程库：source / queue / delay / service / sink / split /
    batch / seize / release / selectOutput5 / selectOutputIn/Out 等 26 个
    已注册可执行块，带 in/out 端口可连线。其余 catalog-only 块
    （restrictedArea* / pickup / resourceTask* 等）尚无内核实现，已从
    palette 隐藏，避免拖入后编译失败。
  - `presentation` 演示库：矩形/椭圆/线/文本等绘图形状，渲染为真实 SVG。
  - `statechart` / `action`：状态图与行动图元素（画布建模，语义落内核为后续）。
- 画布：滚轮缩放、空白拖动平移、坐标网格；端口拖出连线（点击连线删除）。
- **Properties**（右侧）：选中块后编辑名称与字段（AnyLogic 风格参数）。
  - `source` 块额外有 **Entity attributes** 区：新增/重命名/删除实体属性
    （int/float/bool），生成 DSL 里的 `state <name>: <type> = <值>`，可被
    selectOutput/hold 条件、match 配对、优先级排队引用。
- **DSL 编辑区**：画布右侧可收起的代码区，Show DSL / Compile（诊断回显
  Console）。
- 撤销/重做：`Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`；Project 面板可新建模型。

> 注意：启动时不会自动恢复上次打开的工程。浏览器模式的工程先保存在内存中，
> **File > Save** 会导出 `.lpproj`；桌面模式可以打开真实文件夹，把项目和
> workspace 文件写入磁盘。继续之前的工程请用 **File > Open Recent**、
> **File > Open...** 或打开 workspace 文件。

## 工程保存 / 打开

工程是工作单元（`*.lpproj` 单文件打包，格式见[工程格式 v2](../specs/project-format-v2)）：

- **File > New Project...**（Ctrl+N）：输入工程名与所在文件夹，桌面客户端会在该文件夹生成 `工程名/` 目录（`logicpilot.json`、`model/main.lp`、`presentation/main.canvas.json`、`build/`、`results/`）；浏览器模式创建内存工程并在 Save 时导出 `.lpproj`。编辑后 Explorer 根部显示脏点，桌面模式的 Save 写回工程目录。
- **File > Save**：把画布模型（含坐标/连线/参数）与生成的 DSL 一起存成
  `*.lpproj`，重新打开时布局完整还原。
- **File > Open... / Open Recent**：打开 `*.lpproj` 工程；旧 `.lp` / `.json`
  单模型文件仍可打开（无布局信息）。

桌面模式会每 2 秒检查已打开工程的文件指纹。外部工具修改文件后，Explorer 根节点和
底部状态栏会显示变更数量；IDE 不会自动覆盖这些修改，Save 时会列出 LP5xxx 冲突并
要求明确选择是否覆盖。浏览器内存工程不启用此检查。

## 运行

画布左上角 **Run** 打开运行对话框：seed / reps / arrivals / warmup /
**execution mode** / speed 参数 + Start / Pause / Resume / Step / Stop。
空画布运行网关内置模型；有画布模型时先编译再带模型参数运行。

执行模式（`executionMode`，默认 **Fast**）：

- **Fast（批量）**：不按仿真时钟休眠，仿真尽快完成；遥测帧按每 replication
  的帧预算限流（事件稀疏时自动放大分片，不会因时间跨度大而产生海量空帧；
  **预算包含最终状态帧**——排空后强制发送一帧最终 Counters，画布上显示的
  最后一个状态就是运行结束时的真实状态；最终帧的 `sim_time_ns` 是引擎的
  精确最后事件时间（不是切片采样边界），`RunFinished.sim_time_ns` 与之一致）。
  4000 arrivals 的普通 DES 保持秒级完成。**speed 在 Fast 模式下被禁用**——
  不会出现"以为 speed 只影响动画，结果批量实验被意外拖慢"的情况。
- **Animated（实时）**：按 speed 进行 wall-clock 节奏（1.0 = 实时），
  Pause / Resume / Step 在这个模式下才有动画意义；遥测按固定分片输出。

M/M/c 指数流程在运行中显示实时队列长度与忙/闲状态点（Tick 增量帧）。
**泛型 process 流程**（delay/split/selectOutput/Service 共享资源池等拓扑）
也通过 ProcessFlowSim 分片流式执行：每个块实时显示缓冲徽标与忙/闲状态点，
实体沿 coupling 连线以令牌动画流动（新一轮运行/切换模型/重连时动画基线自动重置）。
Agent 模型现在按固定 tick 流式发送 Tick/Counters，并在 Agent population 卡片上显示
实时数量；Atomic 和 Continuous 模型目前完成批量复制后返回统计摘要，不提供
Pause/Step 粒度的 Tick 流。

## 状态机连线与实时图表

- **状态机过渡连线**：在 Statechart 画布中，状态（State）左右边缘有端口点。从源状态的
  out 端口拖到目标状态的 in 端口即可创建一条过渡（Transition），箭头自动生成；点击箭头
  可在 Properties 面板编辑触发方式 / 超时 / 条件 / 守卫 / 动作。
- **实时图表（Analysis 库）**：Time Plot / Bar Chart / Pie Chart 等图表块绑定内核遥测流
  （队列长度、吞吐、平均等待等），运行模型时在画布上实时滚动绘制。图表块的 `value`
  属性选择指标，`title` 设置标题。

## AI 助手（右侧）

AI 面板使用连续对话界面。输入目标后，助手会根据当前模型和最近运行结果自主选择
检查模型、应用最小补丁、编译、运行或读取指标，不需要先选择 generate / optimize /
explain 按钮。

- 回复中实时显示计划、工具调用和执行结果。
- 右下角停止按钮会取消正在进行的网络请求、编译或仿真；若本轮已修改模型，取消
  会自动回滚该轮修改。
- **View changes** 展示本轮结构化 `ModelPatch`；**Undo** 只撤销对应的 AI 事务。
  如果模型之后被手动修改，按钮会禁用，避免误撤用户编辑。
- 会话按工程和模型隔离并保存；发送时仅附带有限的最近对话。
- 未配置 Provider 时，Agent 模式的模型构建会回退到确定性的 rule-based 快速路径；连续对话、Ask/Plan 和真实 LLM 工具调用仍需前往 Settings 配置 Provider。

示例：“添加一个容量为 20 的 Queue 并连接到 Service”“运行 5 次复制并解释
等待时间”“把服务器容量从 1 调到 4，比较修改前后的指标”。配置与协议详见
[AI Copilot](./ai-copilot)。

## 数据流

```text
lp-server (C++) ── WebSocket(wire.fbs, LPWR) ──► SimClient ──► vizState ──► 画布实时徽标
     │                                              └─► Console 事件日志
     └── /api/assistant + /api/ai-*（Node 后端，vite dev 或 app/server.mjs）
```

帧协议为冻结契约 F2（FlatBuffers size-prefixed），C++ 与 TS 双向互操作由
CI 逐字段校验（见[确定性与契约](./determinism)）。
