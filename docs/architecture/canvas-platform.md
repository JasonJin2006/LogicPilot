# Canvas 平台规划（S0–S4）

> 状态：S1 实施中（2026-08-24；此后未复核，未复核期间以源码与门禁为准）
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
- 不引入 PixiJS/WebGL 作为默认管线。默认管线仍是 SVG/DOM；唯一的 WebGL 使用是
  **可选、懒加载**的 3D 场景视图（见下节），它不在首屏路径上，也不参与二维画布渲染。
  `pixi.js` 依赖已移除：它此前只是声明，全仓零引用。

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
| S2 | 按压分类器 PressGesture 内核化（三处按压点统一 click/drag 阈值语义）；Esc/空白点击取消约定已对齐；完整状态机待做 | 🔶 部分（PressGesture ✅） |
| S3 | ModelCanvas 拆层：相机（S3.1）、连线（S3.2）、流令牌（S3.3）已抽为独立模块；presentation 交互（TransformHandles/pen）与 SysML adapter 化待做 | 🔶 部分 |
| S4（可选） | 块级视口裁剪已落地（阈值 120，小模型行为不变）；Canvas2D 批量后端待基准证据 | 🔶 部分 |

## 验收

每切片：pnpm lint / -r typecheck / -r test 全绿 + 浏览器 E2E PASS；
ELK 确定性（固定种子）有专项测试钉住。

## 3D 场景视图（scene3d，2026-09-15）

二维画布之上新增了一个**只读**的 3D 视图，用 Three.js 渲染当前文档的结构，并在运行期间
叠加仿真的 agent。它是对上面非目标的一次明确例外，边界如下：

| | 约定 |
|---|---|
| 默认管线 | 不变。仍是 SVG/DOM；3D 是并列的中心标签，可关闭 |
| 加载时机 | `lazy()` + `Suspense`。首屏 chunk 内 **0 处** `WebGLRenderer`；Three.js 独立成块，仅打开该标签时加载 |
| 写权限 | 只写 `useModelStore.select(id)`。不写文档、不写布局、不写 run 状态 |
| 分层 | `@logicpilot/scene3d`（渲染器无关内核，61 项 Node 单测）+ `web/apps/ide/src/scene3d/`（Three.js 宿主） |
| 面板归属 | **核心 shell 面板**，不是插件面板。中心区的标签栏是文档驱动的，插件注册的面板没有可发现的入口；且 `DEFAULT_LAYOUT` 有一条"只引用已注册面板"的不变量，运行时注册的面板天然违反它 |
| 入口 | 模型画布标签栏右侧的上下文动作区（与 Run 并列），标签出现后可由用户关闭 |

坐标约定、遥测映射与测试范围见 `web/packages/scene3d/README.md`；那里的约定是决定而非巧合，
改它会同时改坏视图与测试。

**为什么不复用 `@logicpilot/canvas` 的相机**：那个是 `{scale, panX, panY}` 的二维平移缩放
模型，被 ModelCanvas 与 SysMLCanvas 消费。3D 需要位置与朝向，撑大它会破坏既有调用点。
两者共用的是真正范式无关的部分：`PressGesture`（点击/拖拽判定）与 `runElkLayout`。
