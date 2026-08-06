# 工程格式 v2（Project Format v2）：agent-centric 目录 + 双向同步

状态：现行（2026-08-06）· 维护者：`/root`。

本格式把"DSL 代码编辑"与"面板可视化编辑"统一到**单一 canonical 模型**上，
实现真正双向同步。工程组织采用 **agent-centric 结构**（见
[agent-centric](./agent-centric)）：`model` 根承载全部成员（参数、资源、
流程块、`couple`、嵌套 agent 的 `instance` 引用）；嵌套容器（agent /
atomic / continuous / experiment）每个一个模型文件 + 一个布局文件；
`process` **不再是容器**，新工程不产生 `model/scenes/<Process>.lp`。

## 1. 结论（一句话）

一个工程 = 根（`model/main.lp` 承载根级全部成员）+ 若干嵌套容器
（`model/scenes/<Name>.lp`，由父文件 `instance` 引用）+ 纯布局
（`presentation/*.canvas.json`）；面板与 DSL 都是 canonical Node 树的
两个编辑入口，经"解析/序列化"双向投影；解析失败时保留最后有效模型并给出诊断。

## 2. 单一 canonical 模型

- **canonical**：内存中的结构树（`ModelDocument`：`kind/name/params/
  children/couplings`）+ 布局表（节点 id → 坐标/几何/分组/缩放）。
- **面板编辑**：直接改 canonical → 保存时序列化回 DSL 文件与布局文件。
- **DSL 编辑**：解析文件 → 校验 → 替换 canonical → 面板重渲染。
- **instance 是存储级引用语法**（Godot `.tscn` 实例化思路）：语义上等于
  该子树在此处内联；合并视图（`lpcli --project`、DSL 编译器默认视图）
  展开后是完整嵌套模型。

## 3. 目录布局

```
factory/                          # 工程根
├─ logicpilot.json                # 清单：version / defaults / containerIds(uid→path)
├─ model/
│  ├─ main.lp                     # model 根：param / resource / 流程块 / couple /
│  │                              #   嵌套容器的 instance 引用（无 process 容器）
│  └─ scenes/
│     ├─ Drone.lp                 # agent Drone 子树（`agent Drone { ... }`）
│     └─ Tune.lp                  # experiment 子树（可选）
├─ presentation/
│  ├─ main.canvas.json            # 根画布布局（纯表现）
│  └─ scenes/Drone.canvas.json    # 每个嵌套容器一个布局文件
├─ lib/custom.lplib               # 项目级块库（AnyLogic Libraries 映射，可选）
├─ build/                         # derived（gitignore）
└─ results/                       # runtime（gitignore）
```

### 3.1 拆分规则

- **根成员留在 main.lp**：`param`、`resource`、process 库块
  （source/queue/service/sink/delay/...）、根级 `couple`。
- **嵌套容器各一个 scene 文件**：`agent` / `atomic` / `continuous` /
  `experiment` 拆到 `model/scenes/<Name>.lp`，父文件用
  `instance <Name> = "model/scenes/<Name>.lp"` 引用（可复用 = 复用/预制体）。
- **不产生 process 容器文件**：新工程不再为流程生成
  `model/scenes/<Process>.lp`；历史工程的此类文件已不支持（无法编译）。
- 布局文件与容器文件一一对应：`presentation/<dir>/<name>.canvas.json`。

## 4. 结构 vs 表现分离

- `.lp` 只含结构（无坐标）；`.canvas.json` 只含布局（按稳定路径索引）。
- 画布渲染 = 结构树 × 布局表；布局缺失时自动布局兜底。
- 结构解析失败 → 布局文件仍可用，面板显示最后有效结构。
- 兼容：旧合一 canvas（含结构）读取时自动拆分，写回只写布局。

## 5. instance 复用与稳定引用（uid）

- 每个 scene 文件首行注释 `// @uid lp_<hex>`（文件自描述）。
- `logicpilot.json` 维护 `containerIds: { "<uid>": "<relative path>" }`。
- 重命名/移动 scene 文件 → 同步 manifest 映射，instance 引用不破。
- 解析顺序：优先 manifest 的 uid→path；instance 引用写路径，工具负责重命名修复。

## 6. 同步层（sync 引擎）

```
load(files):
  parse 各 .lp（全语法）→ 结构树
  按 uid/路径展开 instance → canonical 结构
  读各 .canvas.json → 布局表
  validate → { ok | warnings | errors }

save(canonical):
  结构 → 各 .lp（内联子树 + 父文件 instance）
  布局 → 各 .canvas.json
```

### 错误处理

- **DSL 解析失败**：不覆盖 canonical，面板保留最后有效模型；文件标红，可继续
  编辑（VS Code 语法错误模型）；诊断进入 Console。
- **错误码族**：`LP2xxx` 结构解析、`LP3xxx` 引用、`LP4xxx` 布局、
  `LP5xxx` 同步冲突。
- **外部改动**：文件 mtime/哈希变化 → 提示"重新加载/放弃本地"，不静默覆盖。

## 7. 兼容与迁移

- **旧格式完全舍弃**（2026-08-06）：`process` 容器不再编译，不再生成
  `model/scenes/<Process>.lp`；历史工程的此类文件成为孤立文件（可编辑，
  无法运行）。嵌套 agent/experiment 等 scene + `instance` 引用保留。
- 新工程与保存一律产出 agent-centric 布局；`generateDsl` 平铺根级流程块，
  `nodePath` 根级成员直接用名字（无 `Flow/` 前缀）。
- 迁移顺序：编译器 → 内核 → 工程格式 → IDE → 示例/测试/E2E，每阶段保持
  ctest / vitest / browser-verify 全绿。

## 8. 验收

- `lpcli compile --project <dir>` 对 agent-centric 工程直接编译运行。
- 面板编辑 → 保存 → 磁盘文件 diff 干净、可读。
- 手改 DSL 引入错误 → 面板保留旧结构 + 诊断定位；修复后双向恢复。
- 全语法 round-trip 通过；现有 ctest 与浏览器 E2E 不回退。

### 8.1 全量 round-trip 保证（parse ⇄ generate）

画布文档（`ModelDocument`）与 DSL 文本互为投影，编辑器的
`parseDsl`（DSL → 画布）与 `generateDsl`（画布 → DSL）保证以下不变量
（`web/packages/editor/test/parseDsl.test.ts` 的 round-trip 套件逐条覆盖）：

- **稳定性**：对任意合法 DSL 子集，`parse(generate(parse(src)))` 与
  `parse(src)` 的成员集合（kind/name/container）、参数键值、couple 边集
  完全一致；`generate` 在首次 parse 后幂等（二次生成字节级相同）。
- **表达式原样保留**：比较/算术表达式（`condition = t < 3`、
  `blockingCondition = t >= 10`）、分布调用（`rate(0.8)`）、typed state
  （`state active: bool = true`）、ODE（`d y/dt = -k*y`）以表达式形式往返，
  不会被加引号变成字符串字面量。
- **行为块完整**：同一容器内多个同名触发器（多个 `on_tick`）各自保留自己的
  effect 分组（合成名 `on_tick`、`on_tick#2`），带端口的触发器
  （`on_timeout ready { emit ready }`）端口不丢失。
- **占位成员不丢**：未知块种类、effect 裸行、端口声明
  （`outTimeout: entity when enableTimeout`）以 placeholder 节点保留，
  生成时原样写回。
- **约束**：容器名跨作用域重名时画布无法无损表达，解析产生 LP3103 警告，
  生成器做了自引用防护不会递归崩溃；presentation/statechart 等纯画布元素
  按设计不进入 DSL。
