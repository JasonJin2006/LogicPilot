# Node 场景模型（Node Scene Model）

状态：v1 草案（2026-08-05）。目标：把工程结构的核心元素定为一个通用 **Node**，
每个容器 Node 拥有自己的画布（子图编辑器），Node 树即工程结构，容器 Node 即文件、
可实例化复用。借鉴 AnyLogic（每 agent 一个画布）、Godot（一切皆 Node、Scene 即文件、
场景实例化）、Unity（Scene/GameObject 层级 + Prefab 复用）。

## 1. 结论（一句话）

核心元素是 **Node**（不是 Agent，也不是"五种模型"）：一个带 typed
state/params/ports/time + `SemanticsRef{library, block}` 的通用容器。
`{library: agent}`、`{library: process}`、`{library: sd}`、`{library: physics}`
都只是 Node 的一种语义——保住广度（多方法/多物理）又和 IR v2 完全一致。
Agent 唯一核心会把我们压回 AnyLogic 的运营仿真范畴，不采用。

## 2. 为什么不是 Agent 唯一核心

| 维度 | Agent 唯一核心（AnyLogic） | Node 核心（我们） |
|---|---|---|
| 统一的是什么 | 一个"什么都能干"的对象 | 一个**故意很薄**的容器契约 |
| 新方法怎么进来 | 给对象加能力 → 无限膨胀 | 注册一个新引擎/库，契约不变 |
| 多物理 / GPU / 宏观 | 装不进"带 statechart 的对象" | 各引擎各归其位（FMI 思路） |
| 可验证性 | 差（万能对象） | 好（契约薄，引擎各自验收） |

## 3. 目标形态（借鉴 Godot / AnyLogic）

```
工程（目录）
└── 根 Node: model            ← 一个 scene 文件
    ├── Node: resource Server
    ├── Node: process Flow     ← 容器 scene 文件
    │   ├── Node: source Arrivals
    │   ├── Node: queue WaitLine
    │   └── Node: service Handle
    └── Node: agent Drone      ← 容器 scene 文件
        └── Node: statechart / behavior…
```

三条机制：
1. **Node 即文件**：容器 Node 存成 scene 文件（`model/*.lp` 片段即场景，或演进为
   `.lpscene`），Project 树 = Node 树，文件浏览器 = 磁盘树。
2. **每 Node 一个画布**：点 Project 树中的容器 Node → 中心编辑器打开该 Node 的
   子图（children + couplings）；根 Node 的画布 = 全局视图。
3. **场景实例化 / 库复用**：一棵 Node 树可以作为一个块被实例化进另一棵 Node
   （自定义块库的底层机制，对应 Godot scene instancing / Unity Prefab）。

## 4. 与 IR v2 的映射（已一致，无需改）

- DSL 元素 → `Node + SemanticsRef{library, block}`（ir_v2.fbs）
- `resource` → `{process, ResourcePool}`；`process` 容器 → `{process, flow}`；
  `agent` → `{agent, agent}`；`continuous` → `{sd, equation}`；`experiment` → `ModelFile.experiments`
- Node 的 children/couplings 已在 IR 中；新增的是"容器 Node 的**子图视图**"与
  "容器 Node 即文件"这两层组织。

## 5. 画布视图（步骤 1：本迭代）

- 画布增加**视图状态**：`view = {kind, name} | null`，null = 根（全局）。
- 点 Project 树中容器 Node（如 `process Flow`）→ `view = {process, Flow}`，
  画布只渲染该容器的 children 与其间 couplings；点 Model 节点 → 回到根视图。
- 画布文档节点携带 `container`（所属容器名），`parseDsl` 写、`generateDsl` 读，
  保证画布与 DSL 一致（含未保存的拖拽块）。
- 根视图保持现状（全量渲染），聚焦是"下钻"而非严格分区，避免破坏现有建模流程。

## 6. 迁移路径

1. **步骤 1（本迭代）**：`container` 字段贯通 parse/generate；画布按视图过滤 +
   面包屑；Project 树点击容器节点聚焦。
2. **步骤 2**（已完成）：容器 Node 即 scene 文件 + **实例化/复用**——
   每容器一个文件（`model/scenes/<name>.lp`），模型通过
   `instance <name> = "<scene-path>"` 成员**按路径引用**场景而非内联；
   IDE 与 `lpcli` 在合并时展开实例（引用同一场景可被多个模型复用）。
   剩余：把"自定义块库"做成可直接拖入画布的可实例化场景（UI 层）。
3. **步骤 3**（已完成）：画布分区严格化——根画布只显示模型级元素（resource + 容器
   Node），容器画布只显示其 children；容器 Node 以文件夹卡片渲染于根画布，双击钻取，
   面包屑导航回根；根画布拖入 stage 自动建/复用 `process Flow` 容器并聚焦。

## 7. 关系

- 与 [工程格式](./project-format) 互补：工程格式定义文件/清单；本文定义"元素 =
  Node、每 Node 一画布、Node 即文件"的语义组织。
- 与 [IR v2](./ir-v2) 一致：Node + SemanticsRef 是唯一模型载体。
