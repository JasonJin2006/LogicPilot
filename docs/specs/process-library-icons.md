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

端口锚点由 `portAnchor()`（blockDefs.ts）计算，相对块中心：

| 常量          | 值   | 含义                                 |
| ------------- | ---- | ------------------------------------ |
| `PORT_X`      | 17   | 内轨横偏移（无条件/主流程端口）      |
| `PORT_X_COND` | 23   | 外轨横偏移（条件/异常端口）          |
| `PORT_Y`      | −9.5 | 垂直基准（图标中心偏上，避开名字行） |

规则：

1. **主流程口永远在 y=0**：`in`/`out` 存在时钉在水平轴，开关 timeout/preemption
   等条件口不改变主口位置，已有连线不跳。
2. **无条件副口**（`split.outCopy`、`seize.preparedUnits`、`release.wrapUp`）：
   内轨 +12 / −12 / −24 依次下排（`SECONDARY_OFFSETS`）。
3. **无主口的块**（`selectOutput`、`combine`、`match`、`assembler`）：按 catalog
   顺序固定展开（`INNER_SPREADS`）：selectOutput 上 `outT` 下 `outF`；
   combine/match/assembler 多入口 −6/+6。
4. **条件口**：全部走外轨 ±23，按 catalog 顺序以 10px 间距居中堆叠，钳制 ±15
   （`match` 全开 4 个条件口 = −15/−5/+5/+15），永不碰名字行。
5. **自定义库块**（无主口名）：同方向 12px 居中堆叠。

画布渲染：锚点是块中心相对坐标，图标 span 原点在左上角（中心 −17px），因此
`left/top` 需再 +17 偏移；条件口带 `port-cond` 类（7px 小点 + 1px 引线），
主口 9px，hover/拖线目标放大 1.3 倍（缩放由 CSS 完成，内联样式不覆盖 transform）。

## 4. 验收清单

- [ ] `source→queue→service→sink` 主流程连线全水平（y 对齐 0）。
- [ ] 勾选 service 的 `enableTimeout/enablePreemption`：主 `out` 不动，外轨出现
      小点带引线；取消勾选后连线不跳。
- [ ] `match` 四条件全开：右外轨 4 小点（−15/−5/+5/+15），不碰名字行。
- [ ] `selectOutput` 上 `outT` 下 `outF`；`split.outCopy`、`release.wrapUp` 在
      主口下方 12px。
- [ ] hover 任意端口放大 1.3 倍生效。
- [ ] 16/24/34px 下新 glyph 可辨认；`source` 与 `enter` 不撞脸。
