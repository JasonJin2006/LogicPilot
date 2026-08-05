# 工程格式 v2（Project Format v2）：容器即文件、双向同步

状态：v1 草案（2026-08-05）。目标：把"DSL 代码编辑"与"面板可视化编辑"统一到**单一
canonical 模型**上，实现真正双向同步；工程组织采用**一切皆容器**（每个容器 Node 一个
模型文件 + 一个布局文件），并内置格式校验、错误处理与稳定引用（uid）。

与 [project-format](./project-format)（v1）的关系：v1 的 bundle/目录两形态、manifest、
`build/`/`results/` 分层继续沿用；v2 替换**文件拆分规则**（消灭 `modelParts` 的 kind
拆分）并新增**结构/表现分离**与**同步层**。

## 1. 结论（一句话）

一个工程 = 根容器 + 若干子容器：**每个容器一个 `.lp`（结构）+ 一个 `.canvas.json`（纯
表现）**；面板与 DSL 都是 canonical Node 树的两个编辑入口，经"解析/序列化"双向投影，
解析失败时保留最后有效模型并给出诊断。

## 2. 单一 canonical 模型

- **canonical**：内存中的结构树（Node：`kind/name/params/children`）＋ 布局表（节点 id →
  坐标/几何/分组/缩放）。只有这一份真相。
- **面板编辑**：直接改 canonical → 保存时序列化回 DSL 文件与布局文件。
- **DSL 编辑**：解析文件 → 校验 → 替换 canonical → 面板重渲染。
- **instance 是存储级引用语法**（Godot `.tscn` 的实例化思路）：语义上等于"该子树在此
  处内联"；合并视图（`lpcli --project`、DSL 编辑器默认视图）展开后是完整嵌套模型。

### 2.1 canonical 与 IR v2 的关系（结构同构）

- canonical 的**结构层**与 IR v2（`schemas/baseline/ir_v2.fbs`）的 `Node` 定义**同构**：
  `Node / SemanticsRef / Var / Port / Statechart / Equation` 直接对齐。
- 差异只在两端：canonical 多**布局表**（`.canvas.json`，纯 IDE 表现，不进 IR）；
  IR 多**冻结/执行**属性（schema 版本 + 冻结门禁，供 C++ 内核与 F3 互操作）。
- 结论：`parseDsl` 的产出结构直接按 `ir_v2.fbs` 的 Node 形状建模（替代现
  `ModelDocument` 的"结构+坐标合一"），lowering 只补派生语义、不做结构翻译；
  `SourceSpan` 由 DSL 解析产生，随 canonical 贯穿到 IR（诊断/AI 修复闭环）。

## 3. 目录布局

```
factory/                          # 工程根
├─ logicpilot.json                # 清单：version / defaults / containerIds(uid→path)
├─ main.lp                        # 根容器：资源/实验/子容器成员（子容器用 instance 引用）
├─ scenes/
│  ├─ Flow.lp                     # process Flow 子树
│  ├─ Drone.lp                    # agent Drone 子树
│  └─ Tune.lp                     # experiment 子树
├─ presentation/
│  ├─ main.canvas.json            # 根画布布局（纯表现）
│  └─ scenes/Flow.canvas.json     # 每个容器一个布局文件
├─ lib/custom.lplib               # 项目级块库（AnyLogic Libraries 映射，可选）
├─ build/                         # derived（gitignore）
└─ results/                       # runtime（gitignore）
```

### 3.1 统一拆分规则（一切皆容器）

- 每个**容器 Node**（process / agent / atomic / continuous / experiment / 根）一个
  `scenes/<name>.lp` 文件；根容器固定为 `main.lp`。
- **消灭 `modelParts` 的 kind 拆分**：不再有 `resources.lp`/`experiments.lp`；
  resource/param/experiment 等成员节点写在**所属容器**的文件里。
- 子容器在父文件中以 `instance <name> = "scenes/X.lp"` 引用（可重复引用 = 复用/预制体）。
- 布局文件与容器文件一一对应：`presentation/<dir>/<name>.canvas.json`。

## 4. 结构 vs 表现分离

- `.lp` 只含结构（无坐标）；`.canvas.json` 只含布局（按节点 id 索引）。
- 画布渲染 = 结构树 × 布局表；布局缺失时自动布局兜底。
- 结构解析失败 → 布局文件仍可用，面板显示最后有效结构。
- 兼容：v1 合一 canvas（含结构）读取时自动拆分，写回只写布局。

## 5. DSL 语法

- 保留嵌套容器（语义）；`instance` 为存储级引用。
- `parseDsl` 扩展至全语法：`resource / process / agent / atomic / continuous /
  experiment / param / behavior`。
- 画布暂不支持的 kind 解析为**占位结构节点**（面板灰色占位框，只读展示，绝不丢弃）。
- 解析期校验：重名、字段类型、未解析引用（instance 指向缺失/循环），产出可修复诊断。

## 6. 稳定引用（uid）

- 每个容器文件首行注释 `# @uid lp_<hex>`（文件自描述）。
- `logicpilot.json` 维护 `containerIds: { "<uid>": "<relative path>" }`。
- 重命名/移动容器文件 → 同步 manifest 映射，instance 引用不破。
- 解析顺序：优先 manifest 中 uid→path；instance 引用写路径，工具负责重命名修复。

## 7. 同步层（sync 引擎）

```
load(files):
  parse 各 .lp（全语法）→ 结构树
  按 uid/路径展开 instance → canonical 结构
  读各 .canvas.json → 布局表
  validate → { ok | warnings | errors }

save(canonical):
  结构 → 各容器 .lp（内联子树 + 父文件 instance）
  布局 → 各 .canvas.json
```

### 错误处理

- **DSL 解析失败**：不覆盖 canonical，面板保留最后有效模型；文件标红，可继续编辑
  （VS Code 语法错误模型）；诊断进入 Console。
- **错误码族**：`LP2xxx` 结构解析、`LP3xxx` 引用、`LP4xxx` 布局、`LP5xxx` 同步冲突。
- **外部改动**：文件 mtime/哈希变化 → 提示"重新加载/放弃本地"，不静默覆盖。

## 8. 迁移步骤

1. `parseDsl` 全语法 + 占位节点 + 全语法 round-trip golden（`generate(parse(x))` 语义等价）。
2. 布局分离：布局表读写 + 旧合一 canvas 兼容读取。
3. `splitModelSource` 统一为"一切皆容器"：移除 kind 部件文件，容器统一进 `scenes/`。
4. `lpcli --project` 消费新目录布局（合并 instance）。
5. sync 引擎 + 错误码 + mtime 冲突检测。
6. uid 映射 + 重命名修复工具（v2 纳入）。
7. 多模型根 / 项目级库（v3）。

## 9. 验收

- AI 生成完整 DSL（含 agent/experiment）→ 打开工程，面板结构/参数无损。
- 面板编辑 → 保存 → 磁盘文件 diff 干净、可读。
- 手改 DSL 引入错误 → 面板保留旧结构 + 诊断定位；修复后双向恢复。
- 全语法 round-trip 100% 通过；现有 ctest 与浏览器 E2E 不回归。
