# 流程库图标与端口排布规范

状态：已落地（2026-08-06）· 适用范围：`web/apps/ide/src/model/BlockIcon.tsx`、
`blockDefs.ts`、`ModelCanvas.tsx`、`styles/model.css`

## 1. 目标

给 23 个流程块一套统一、可辨识、小尺寸可读的 SVG 图标，以及一套确定性的端口
排布规则：**入在左、出在右**，主流程端口永远钉在图标垂直中轴，开关条件端口
不移动已有连线，端口点永不压图标笔画或名字行。

## 2. 图标设计系统

- 画布：`viewBox 0 0 40 40`，纯描边单色（`stroke="currentColor"`），线宽 1.5，
  圆头端点，无填充（仅允许的小点/小三角除外）。
- 形状语言（照抄 AnyLogic PML silhouette，转 1.5px 描边）：
  圆 = 终端/事件（source/sink/hold/resourceTaskStart/End），
  横矩形 = 站点/容器（delay/queue/service/seize/release/wait/batch/…），
  菱形 = 决策（selectOutput/selectOutput5/selectOutputIn/Out），
  三角形 = 合分流（split/combine），块状箭头 = 进出（enter/exit），
  秒表+箭头 = 计时（timeMeasureStart/End），资源页签 = resource/resourcePool。
- 全量 39 块（23 + 16 新增：selectOutput5/In/Out、resourcePool、resourceTaskStart/
  End、resourceSendTo、downtime、pickup/dropoff、restrictedAreaStart/End、
  resourceAttach/Detach、pMLSettings、plainTransfer）均有图标；新增块的
  ports/properties 从 AnyLogic 官方文档提取（scripts/extract-pml-catalog.mjs）。
- 三档尺寸（16/24/34px）均可辨认；不依赖颜色/填充表达语义。

## 3. 端口排布规则

端口锚点由 `PORT_LAYOUTS`（blockDefs.ts）按 **AnyLogic 绿点规律**标定，坐标在
图标 40×40 viewBox 空间内（相对图标中心 (20,20)），渲染时按 34/40 缩放到画布：

- **主 `in`/`out`**：图形左/右边缘中点（rect 类块 x=7/33，圆类块 x=9/31）。
- **条件端口**（`outTimeout`/`outPreempted`）：顶边（y≈9–11）；
  `match` 四个条件口分列顶/底边；`seize.preparedUnits`、`release.wrapUp` 在底边。
- **合分流**：`split` in/out/outCopy 落在三角形三个角点；`combine` 镜像。
- **决策**：`selectOutput` 的 `outF` 在菱形下顶点（outT 在右侧中点）。
- **计时**：timeMeasureStart 的 `in` 在秒表正下方。
- 多口堆叠（selectOutput5/In/Out 的 5 个口）沿边等距排布，不超出图标。
- 自定义库块无布局条目时回退到左右中点堆叠（`PORT_X`/16px）。

画布与 palette **始终显示全部端口**（含条件端口）；用线连到条件端口时，
`modelStore` 自动把对应开关（`enableTimeout`/`enablePreemption` 等）置为
`true`，保证生成 DSL 可编译（否则 LP5003）。渲染偏移：锚点相对块中心，
图标 span 左上角在块中心 (−17, −26.5)（卡片 = 34px 图标 + 4px 间距 + 15px
名称），故 `left = anchor.x − node.x + 17`、`top = anchor.y − node.y + 26.5`；
画布圆点 5px、palette 4px（约图块宽度 12%），hover/拖线目标放大 1.5×。

## 4. 验收清单

- [ ] `source→queue→service→sink` 主流程连线全水平（y 对齐 0）。
- [ ] 拖入 queue/service：顶边直接可见 `outTimeout`/`outPreempted` 小点。
- [ ] 连线到 `outTimeout`：Properties 里 `enableTimeout` 自动勾选，编译通过。
- [ ] `match` 8 个端口（左右各 2 + 顶/底各 2）全显示且不重叠。
- [ ] `selectOutput` 上 `outT` 下 `outF`；`split` 三点在三角角位。
- [ ] hover 任意端口放大 1.5 倍生效。
- [ ] 16/24/34px 下新 glyph 可辨认；`source` 与 `enter` 不撞脸。

## 5. 端口语义（对照 AnyLogic 官方文档）

端口位置与语义均对照 AnyLogic PML 官方参考（`libraries/pml-catalog.json` 的
`description` 即由 `scripts/extract-pml-catalog.mjs` 从官方 HTML 提取）。
通用约定：`in` = 主输入口，`out` = 主输出口；**条件端口**在对应属性开启后
才可见（`outTimeout` ← `enableTimeout`，`outPreempted` ← `enablePreemption`，
`match` 为 `outTimeout1/2`、`outPreempted1/2` ← `enableTimeout1/2`、
`enablePreemption1/2`）。

| 块                               | 特殊端口                       | 方向  | 语义（官方文档）                                                                      |
| -------------------------------- | ------------------------------ | ----- | ------------------------------------------------------------------------------------- |
| source                           | out                            | 出    | 生成的 agent 出口                                                                     |
| split                            | outCopy                        | 出    | 块创建的新 agent 出口（`out` 为原 agent）                                             |
| combine                          | in1 / in2                      | 入    | 两个输入口，合并为一个 agent                                                          |
| seize                            | preparedUnits                  | 出    | 完成准备任务的资源单元出口，应接"资源准备流程"末端（该流程以 ResourceTaskStart 起始） |
| release                          | wrapUp                         | 出    | 接 wrap-up 流程起始块（该流程以 ResourceTaskEnd 结束）                                |
| selectOutput                     | outT / outF                    | 出    | 条件为 true/false 分别走 outT（上）/ outF（下）                                       |
| selectOutput5                    | out1..out5                     | 出    | 按条件路由到 5 个出口之一                                                             |
| selectOutputIn                   | in1..in5                       | 入    | 从 5 个输入之一接收（与 SelectOutputOut 配对）                                        |
| selectOutputOut                  | out1..out5                     | 出    | 路由到 5 个输出之一（与 SelectOutputIn 配对）                                         |
| match                            | in1/in2、out1/out2             | 入/出 | 两路配对：第一/第二队列的输入与配对后的输出                                           |
| match                            | outTimeout1/2、outPreempted1/2 | 出    | 第一/第二队列超时或抢占离开的 agent                                                   |
| assembler                        | in、p1                         | 入    | 主 agent 入口与第一个部件入口；`out` 为装配后的 agent                                 |
| pickup                           | inPickup                       | 入    | 连接 Queue 块的 out 口（也可由属性指定 Queue，此时可不连）                            |
| dropoff                          | outDropoff                     | 出    | 从容器 agent 中移除的 agent 出口                                                      |
| queue/service/wait               | outTimeout / outPreempted      | 出    | 超时离开 / 被抢占离开的 agent（置顶边）                                               |
| timeMeasureStart                 | in                             | 入    | 计时开始（秒表正下方）                                                                |
| timeMeasureEnd                   | out                            | 出    | 计时结束                                                                              |
| enter / exit                     | out / in                       | —     | 流程边界：入口只有出、出口只有入                                                      |
| restrictedAreaStart / End        | in/out                         | 入/出 | 限制区进入 / 离开                                                                     |
| plainTransfer                    | in/out                         | 入/出 | 简单 agent 传输                                                                       |
| resourceTaskStart / End          | in/out                         | 入/出 | 资源任务开始 / 结束（流经块）                                                         |
| resourceSendTo / Attach / Detach | in/out                         | 入/出 | 资源发送到节点 / 绑定 / 解绑                                                          |
