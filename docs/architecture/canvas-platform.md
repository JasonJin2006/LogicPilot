# Canvas 平台规划（S0–S4）

> 状态：S1 实施中 · 2026-08-24
> 背景：模型画布（ModelCanvas）与 SysML 投影画布是两套近乎零复用的实现——
> 各自的 store、撤销栈、连线手势、路由算法、ELK 封装。本方案把"画布平台"
> 下沉为共享内核包 `@logicpilot/canvas`，两套画布降级为它的宿主适配器。

## 目标与非目标

目标：
1. 手势/视口/吸附/路由/自动排版一处实现、两侧生效；
2. 新范式接入成本从"复制上千行"降到"实现一个 Adapter"；
3. 撤销语义归宿主文档所有，画布只发命令；
4. 性能有明确预算与升级路径（虚拟化 → LOD → Canvas2D 后端），不预设 WebGL。

非目标：
- 不做万能画布文档格式（范式结构仍由各自文档模型拥有）；
- 不改 .lpproj 磁盘格式；
- 不引入 PixiJS/WebGL 作为默认管线（README 历史措辞将修正）。

## 包结构

```
web/packages/canvas/src/
├── core/
│   ├── types.ts        # Camera / Point / Size
│   ├── camera.ts       # 缩放聚焦、fit-bounds、比例钳制（纯函数）
│   ├── culling.ts      # 视口裁剪（旋转 AABB + overscan）
│   ├── snapping.ts     # 锚点吸附与参考线
│   └── routing.ts      # 正交路由
├── layout/
│   └── elk.ts          # 共享 ELK 服务：worker 管理 + 主线程兜底 + 泛型收集
└── index.ts
```

后续切片再入：`core/gestures.ts`（无头指针状态机）、`graph/model.ts +
diff.ts`、`react/CanvasSurface.tsx + layers/`。

## 关键决策

1. **画布 = 内核状态机 + 宿主适配器。** 内核只知道带尺寸/端口的图元；
   范式记法渲染与写回语义由 IDE 侧 Adapter 实现。
2. **撤销归宿主。** 手势翻译成命令（moveNodes/connect/arrange…），由
   modelStore / sysmlStore 各自的提交栈执行；管线只有一条。
3. **渲染维持 SVG/DOM**，配视口裁剪与 LOD；500 元素交互 60fps 为预算线，
   超出再在 NodesLayer 接口后挂 Canvas2D 批量后端。
4. **路由与排版是 Provider**：orthogonal/spline 可换，ELK 只是其一。

## 切片

| 切片 | 内容 | 状态 |
| --- | --- | --- |
| S0 | 冻结画布功能新增；盘点可提取物 | ✅ |
| S1 | 建 `@logicpilot/canvas`：camera/culling/snapping/routing 迁入 + 共享 ELK 服务；两画布消费 | ✅ 本提交 |
| S2 | 连线手势状态机内核化；选择/Esc/空白点击语义对齐 | 待做 |
| S3 | ModelCanvas 拆层（Viewport/Blocks/Presentation/Live）+ Adapter 化 | 待做 |
| S4（可选） | Canvas2D 批量渲染后端（特性开关） | 视 S3 后基准 |

## 验收

每切片：pnpm lint / -r typecheck / -r test 全绿 + 浏览器 E2E PASS；
ELK 确定性（固定种子）有专项测试钉住。
