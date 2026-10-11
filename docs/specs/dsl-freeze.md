# DSL 冻结契约（Freeze Contract）

状态：已定稿（2026-08-06），修订于 2026-10-11（补第 3 节）。维护者：`/root`，规范依据：`dsl-spec.md`

LogicPilot 定位是**可扩展工程建模与仿真 Workbench**（权威措辞见 [dev-plan §0](../dev-plan.md)），不是通用编程语言或逻辑推理语言。本契约
把 DSL 的边界固化成两条清单：**永不添加**（冻结边界）与**允许扩展**（扩展点），
防止语言因「加语法」而腐化。第 3 节补充一层**所有权边界**：哪些设置归模型、
哪些归运行，两者不得重叠。

## 1. 冻结边界（永不添加）

以下能力**不属于** DSL 的路线，评审/提案中出现即拒绝：

- **函数定义**：没有用户自定义函数；行为由库块语义与内核内置处理器
  （`noop` / `flip` / `bounce`）提供。
- **模块/文件导入**：单文件模型 + `use <library>` 库声明；无跨文件
  `import`。工程级复用走 `instance` 引用（工程格式 v2）。
- **pattern matching / 模式匹配**：无模式匹配语法。
- **逻辑规则/推理语法**：`rule`、`query`、`A -> B` 依赖陈述等不属于仿真
  建模；约束用模型语义表达（资源、队列容量、故障率）。
- **通用控制流**：`if/for/while` 等过程式控制流不进入 DSL；时间驱动行为用
  `on_<trigger>` 声明式表达。

## 2. 扩展点（允许且鼓励）

- **库注册表**：`libraries/*.lplib` 声明块形状（字段/端口/默认值），
  `kind name { ... }` 骨架不变；加新块 = 注册一条库条目 + 内核引擎实现。
  自定义块可用 `extends: ref = <内置块>` 映射到内核已有语义（如
  `block Machine { extends: ref = service }`），`use <library>` 经
  `<library>.lplib` 加载后即可编译、降级为内置语义并运行（LP2010/LP2011
  校验库加载与映射错误）。
- **表达式**：数值位置接受编译期常量表达式（`+ - * /`、一元负、括号、
  `param` 引用、分布调用），随 IR/内核能力演进（不引入运行时副作用函数）。
  决策位（`selectOutput.condition`、`hold.blockingCondition`）额外支持
  比较运算符（`< > <= >= == !=`，文法 `binary_op`/`field_access` 已落地），
  以原文降级为字符串参数、由内核在路由时求值（纯求值，标识符解析为仿真
  时间 `t` 与块数值参数；行为表达式中的属性点访问如 `agent1.kind` 走
  双作用域求值）。
- **工程复用**：`instance <Name> = "model/<Scene>.lp"` 是**工程格式层构件**
  （project-format-v2），由加载器在装载时展开（`lpcli --project` / IDE 打开
  工程文件夹）；它不属于 DSL 文法，裸文件编译会得到定向诊断
  （LP2014：请改用工程方式编译）。嵌套容器复用的运行语义由场景展开保证。
- **行为统一**：新触发器按 `on_<trigger> { effect; ... }` 形态扩展，不新增
  并行写法。

## 3. 实验与运行设置的分工（所有权边界）

`experiment` 块是**模型的成员**（与 `param` 同级，见 `dsl-spec` R12），不是外壳的
运行参数。据此，两层各管一半，**不重叠**：

| 归模型（`experiment` 块拥有） | 归运行（外壳的每次运行设置） |
| --- | --- |
| `seed`，`seed_mode` | `warmup` |
| `replications`，`replication_mode` | 终止条件（跑多久、跑够多少次到达） |
| `min_replications`，`max_replications` | 执行模式（批处理 / 动画）与回放速度 |
| `confidence`，`error_percent`，`metric` | |

分界理由是**改不改模型语义**：左半是「这个实验是什么」（可复现性与精度目标），
属于模型修订的一部分，改了要留痕；右半是「这次怎么跑」（预热、看多快），
不改模型语义，也不该写进文件。

约束：

- **同名字段只有一个主人。** 外壳不得为 `seed` / `replications` 一族另留一个可编辑
  来源；`RunOptions` 中这些字段的角色是**模型声明的投影**，不是独立设置。出现两份
  即视为缺陷（当前实现细节与收敛进度见 `ide-layout.md` 的运行对话框一节）。
- **运行级设置不得进入模型。** `warmup` 与终止条件属 run 级，写进 `.lp` 视为越界
  （`dsl-spec` §5 已把 warm-up / run-length 列为 CLI 级）。它们随每次运行给出，
  不落在 `experiment` 块里。
- 新增**运行级**设置 = 扩外壳的运行设置；新增**实验级**设置 = 扩 `experiment` 块，
  并同步 `dsl-spec` 的 R12、R11（`range_field`）与 IR 的 `model-file.experiments`。

## 4. 与 dsl-spec 的关系

`dsl-spec.md` §5（Out of Scope）是 v2 阶段一的排除清单；本契约将其固化为
长期冻结边界（第 1 节），并把「批处理/统计块」等已实现项从排除清单移除。
语法变更必须遵守 ADR-0005（grammar.js 与生成文件同 commit）。
