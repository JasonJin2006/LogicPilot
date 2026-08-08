# DSL 语言速查

LogicPilot DSL 是**人与 AI 共用**的模型描述语言：人可以手写，AI 可以生成并依据结构化诊断修复。语法由 tree-sitter 的 **v2 通用骨架**定义（`kind name { ... }`，`kind` 由编译器解析为核心种类或库块），编译为 FlatBuffers IR。

## 结构总览

一个 `model` 由零到多个顶层块组成：

```text
model <Name> {
  use process      // 可选：声明使用 process 库（阶段 1 隐式可用）
  param <p> = <值> // 模型级参数（可带 : float 类型注解）
  resource ...     // process 库块：资源池（容量/故障）
  source/queue/service/sink ... // process 库块：直接是 model/agent 成员
  couple a.out -> b.in   // 同作用域连线（根级或 agent 体内）
  atomic ...       // DEVS 原子 + couple 布线
  agent ...        // Agent 群体（tick 行为）
  continuous ...   // 连续 ODE 系统
  experiment ...   // 模型声明的仿真/优化实验
}
```

`resource/source/queue/service/sink` 是 **process 库注册表条目**（块形状由编译器校验：未知字段 `LP2005`），不是语法关键字——加一种新库块不需要改文法。

## process：离散事件流程

```logicpilot
model MM1Failure {
  resource Server {
    capacity = 1
    failure_rate = 0.1        // 忙时故障率（可选，默认 0）
  }

  source Arrivals {
    arrival = rate(0.8)     // 到达分布：rate(λ)（= poisson(λ)，指数到达）
  }
  queue WaitLine {
    capacity = 1000000      // 0 = 无缓冲
  }
  service Handle {          // 服务块名与资源名解耦
    resource = Server       // 显式引用资源（LP4001 校验）
    time = exponential(1.0) // 服务时间：exponential(μ) 或 normal(均值, 标准差)
  }
  sink Done { }

  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in
}
```

流程块直接是 model 根（或 agent 体）的成员，用 `couple` 连线，不再需要
`process` 容器（旧 `process Flow { ... }` 写法已移除，写它会在编译时报错）。
实体按声明顺序流动：`source` 生成 → `queue` 缓冲 → `service` 占用资源处理。`service` 通过
`resource = R` 显式引用资源（不写则回退为按服务块名匹配）；`resource` 的
`capacity` 是并发上限，`failure_rate > 0` 时内核按"忙时故障 + 修复"建模
（可用性 `a = r/(f+r)`）。

决策块支持**运行时条件表达式**（比较运算，内核在路由/阻塞时求值）：

```logicpilot
selectOutput Inspect {
  condition = t < 100        // 前 100 秒走 outT，之后走 outF
}
hold Gate {
  blockingCondition = t < 60 // 60 秒前阻塞，之后放行
}
```

条件里可引用仿真时间 `t`/`time` 与本块的数值参数；表达式是纯求值（无副作用），
同种子下结果确定。条件字段引用未声明的标识符会得到 `LP5006` 诊断（只允许
`t`/`time` 与本块自身的数值字段）。表达式支持等值比较 `==` / `!=`
（如 `condition = priority == 5`），与 `< > <= >=` 同级。

### 多出口路由（selectOutput5 / selectOutputIn / selectOutputOut）

- `selectOutput5`：1 进 5 出。`type = conditions` 时按 `condition1..4`
  顺序求值，首个为真的出口胜出，全假走默认出口 `out5`；`type =
  probabilities` 按 `probability1..5` 随机；`type = exit_number` 按
  `exitNumber` 表达式取出口（1..5，越界钳制）。条件可引用实体属性与
  `t`/`time`（`LP5006` 校验）。示例：`examples/select_output5.lp`。
- `selectOutputIn` / `selectOutputOut`：AnyLogic 的"准多出口"组合。
  `selectOutputIn` 只有 `in` 端口，把每个 agent 路由到它关联的
  `selectOutputOut`（后者按名字声明 `selectOutputIn = Route`，只带 `out`
  端口），实体被直接转发到该出口的下游，不经图形连线。默认按各出口
  `probability` 滚动；`conditionIsProbabilistic = false` 后按 `choice`
  表达式取 1-based 出口序号。示例：`examples/select_output_quasi.lp`。

### 实体属性（entity attributes）

`source` 块可以用 `state <name>: <type> = <值>` 声明**实体属性默认值**，每个
被它发射的 agent 都会携带该属性（AnyLogic 的 agent 字段语义）：

```logicpilot
source Jobs {
  arrival = rate(2.0)
  state size: int = 10
  state priority: float = 1.0
}
selectOutput Route {
  condition = size > 5        // 按实体属性路由（运行时求值）
}
```

运行时条件（`selectOutput.condition` / `hold.blockingCondition`）可引用任意
source 声明的属性名（`LP5006` 校验放行）；`split` 复制实体时属性随拷贝，
`combine`/`batch` 生成的实体保留第一个原件的属性。属性目前为数值型
（int/float/bool）。

### DES 块语义（batch/combine/match/seize/release/测量）

通用流程引擎（`ProcessFlowSim`）已实现以下 AnyLogic 语义块的执行行为：

- `batch` / `unbatch`：`batchSize` 个 agent 聚成一个批（`permanent = true`
  丢弃原件；`false` 时原件作为批内容，`unbatch` 恢复为独立 agent）。
- `combine`：等待 `in1`/`in2` 两个输入各一个 agent 后合成一个（零时间）。
- `match`：同步两条流，双方都到齐时成对从 `out1`/`out2` 同时输出。
- `match` 的**属性配对**：`matchCondition = <属性名>` 时按该实体属性等值
  配对（新到达的 agent 与对侧队列从前到后找第一个同值配对），缺省
  （不写或 `true`）保持纯同步器；也支持 AnyLogic 标准写法
  `matchCondition = agent1.kind == agent2.kind`（`agent1`/`agent2`
  引用两侧 agent 的属性字段，可组合 `==`/`!=`/比较运算符）。
- `seize` / `release`：`seize` 从 `resource` 资源池按 `numberOfUnits` 抢占
  单位（不足时在块内队列等待），`release` 归还该 agent 持有的全部单位。
- **被 seize 持有的单元同样服从池故障**：资源池的 `failure_rate` /
  `repair_rate` 在单元被持有期间生效——池进入故障后不再放行新的 seize，
  修复后恢复；`availability` 反映停机占比。
- **池级故障是全局的**：每个声明资源池只有一条忙时故障/修复时钟。多个
  `service`/`seize` 共享同一故障池时，故障会同时中断所有消费者的在服任务
  （抢占式重启：修复后任务重新计时），不会给每个消费者各画一条独立故障
  曲线；停机时间按故障发生时刻持有的单元数折算进 `availability`。
- `wait` / `seize` 的**退出超时**：`enableTimeout = true` 时，等待超过
  `timeout` 秒的 agent 从 `outTimeout` 出口离开（AnyLogic 语义；couple 到
  `outTimeout` 时编译器要求 `enableTimeout` 为 true）。
- **优先级排队与抢占**：`queue`/`wait` 的 `queuing` 支持
  `queuing_fifo`（默认）/ `queuing_lifo` / `queuing_priority`；优先级取
  实体属性 `priority`（无则回退块字段 `agentPriority`，越大越靠前）。
  `enablePreemption = true` 时，满 `queue` 仍接收新人，再把最弱实体送到
  `outPreempted`：新人更强则淘汰旧等待者，新人不更强则新人自己离开，不能把
  它反压在上游。`wait`/`seize` 在每次到达时抢占最弱等待者。
  也支持 **`queuing_comparison`**：`queue` 用
  `agent1IsPreferredToAgent2 = <表达式>`（wait 用 `agent1MayPreemptAgent2`）
  按双 agent 表达式排序/准入（`agent1` 为新到达者，`agent2` 为队列中的
  agent）。
  比较模式缺少表达式、引用未知实体属性，或填写未知 `queuing` 模式时会在编译期
  报错，不会静默退化为 FIFO。
- `timeMeasureStart` / `timeMeasureEnd`：成对标记，`measure` 统计（均值）进
  `lpcli run` 输出与 `metrics.json`。

`count` 继续直通计数；`moveTo`/`assembler` 暂为直通占位
（位置/装配语义为后续工作）。示例：`examples/seize_release.lp`、
`examples/batch_unbatch.lp`、`examples/combine_time.lp`。

`exit` 块已实现 AnyLogic 语义：把 agent 从流程中移除（无输出端口），
sojourn 照常记录；`enter` 是无输入端口的入口点，当前没有外部注入 API，
保持空闲（不产生 agent）。示例：`examples/flow_exit.lp`。

`assembler` 已实现 AnyLogic 语义：等待 `in`（主件）+ `p1`（部件，
`quantity125` 指定数量）到齐后装配 `delayTime` 秒，再输出主件；多个装配
可并行。装配期可用 `resourcePool` + `numberOfUnits` 占用资源单元
（不足时等待，装配完成后归还）。示例：`examples/assembler_line.lp`。

`moveTo` 已实现：`tripTime` 显式行程时间、`speed` + 坐标位移（`xYZ` 沿轴
或 `node` 目标，耗时 = 距离/速度）；两者都不设则零时跳转。
**空间标记**：`node <Name> { x = <f>; y = <f> }` 声明带坐标的节点，
`path <Name> { node1 = A; node2 = B }` 连接节点成网络（边长 = 欧氏距离）；
`moveTo` 的 `node = <Name>` 沿网络**最短路径**位移（距离/速度），无 path
时回退直线。示例：`examples/move_route.lp`。

`service` 现在在**通用流程引擎**（`ProcessFlowSim`）里也遵守资源池的故障语义：
`resource` 的 `failure_rate` / `repair_rate` 按「忙时故障 + 修复」建模
（抢占式重启服务，与专用 M/M/1 路径一致）；`availability` 指标输出到
`lpcli run` 与 `metrics.json`。示例：`examples/failure_line.lp`（用 `count`
强制走通用引擎，可用性 < 1、无丢件）。

`service` 还支持**任务抢占**（AnyLogic 资源任务优先级）：`enablePreemption`
打开且 `taskPreemptionPolicy` 非 `pp_no_preemption` 时，高优先级新任务
（实体属性 `priority` 或 `taskPriority` 字段）可打断正在运行的低优先级
任务，后者经 `outPreempted` 退出。示例：`examples/task_preempt.lp`。

## 表达式与参数

数值字段接受**编译期常量表达式**（`+ - * /`、一元负、括号），并可通过
模型级 `param` 引用：

```logicpilot
model Tuned {
  param arrival_rate: float = 0.4
  resource Server { capacity = 1 }
  source A { arrival = rate(arrival_rate * 2) }  // = rate(0.8)
  service R { resource = Server; time = exponential(1) }
}
```

未声明标识符或非常量表达式 → `LP2006`。`poisson(λ)` 与 `rate(λ)` 等价
（`poisson` 已弃用）。

## atomic：DEVS 原子

```logicpilot
model PulseChain {
  atomic Pulser {
    time_advance = constant(1.0)   // 或 exponential(rate) / infinite（缺省）
    on_timeout { emit pulse }     // 行为统一为 on_<trigger> { ... }
  }

  atomic Sink {
    state seen = false             // 类型化状态变量
    on_input pulse { seen = true } // 消息触发 + 端口 + 效果
  }

  couple Pulser.pulse -> Sink.pulse  // 显式端口布线
}
```

约束：每个原子最多一个 `on_input`、一个 `on_timeout`；`time_advance` 缺省为 infinite（被动）。

## agent：Agent 群体

```logicpilot
model Swarm {
  agent Drone {
    count = 3
    state active = true
    on_tick { flip active }   // 内置行为：翻转布尔状态
    on_tick { bounce }        // 内置行为：在 [0,1]² 内反弹
  }
}
```

行为由内核内置处理器注册表提供（`noop` / `flip <state>` / `bounce`），同种子下 tick 顺序确定。
大规模群体（≥ 65536 个 agent 且多核）时，flip/bounce 这类逐实体独立的行为自动
走并行批量 tick 路径，每实体计算与串行逐位一致（10 万 agent 确定性测试覆盖）。

## continuous：连续 ODE 系统

```logicpilot
model Decay {
  continuous Dynamics {
    state y = 1.0          // 初始值
    param k = 0.5          // 命名常量
    d y/dt = -k*y          // RHS 支持 + - * / 与 exp/log/sqrt/sin/cos、显式 t
  }
}
```

内核用固定步长 RK4 积分；`lpcli run --arrivals N` = N 步（`dt = 0.01`），`--trajectory` 导出采样轨迹。多方程耦合即连续多个 `d x/dt` 语句（SIR 见 `examples/sir.lp`）。

## experiment：模型声明实验

```logicpilot
experiment Optimization {
  type = optimization
  objective = minimize
  metric = Wq
  variable = arrival_rate   // 引用已声明模型参数（'servers' 保留 v0.1 兼容）
  range = 1..8
  budget = 20
}

experiment Baseline {
  type = simulation
  replications = 30
  seed = 42
}

experiment Adaptive {
  type = simulation
  seed_mode = random
  replication_mode = precision
  min_replications = 5
  max_replications = 100
  confidence = 0.95
  error_percent = 5
  metric = Wq
}

experiment CapacityStudy {
  type = parameter_variation
  metric = Wq
  seed_mode = fixed
  seed = 42
  replications = 10

  axis ArrivalRate {
    variable = arrival_rate
    range = 0.6..1.0
    step = 0.2
  }
  axis Servers {
    variable = server_count
    range = 1..4
    step = 1
  }
}
```

实验作为模型的一部分进入 v2 IR（`ModelFile.experiments`），`lpcli compile
--experiments-json` 可导出，AI 优化脚本据此做 grid/GA 搜索。`variable` 必须
引用已声明的模型参数（`LP7001` 校验）。Simulation 实验可由
`lpcli run --experiment Baseline` 选择；显式 `--seed`/`--reps` 覆盖声明值。
精度模式至少运行 `min_replications` 次；当所选指标的 Student-t 置信区间
半宽相对均值达到 `error_percent`，或达到 `max_replications` 时停止。随机模式
会记录解析后的实际种子，因此单次运行仍可回放。

`parameter_variation` 使用一个或多个 `axis` 构造参数笛卡尔积。轴必须引用顶层
数值 `param`；浮点参数可使用浮点范围，整数参数的范围端点和步长必须为整数。
IDE 的 AI 面板可直接执行项目中声明的参数扫描，以表格显示每个组合的均值、
Student-t 置信区间和实际重复次数。固定种子模式会让各组合使用相同的重复种子，
便于采用共同随机数降低比较噪声；组合数上限为 100,000。

## 自定义库与行业库

库块形状声明在 `.lplib` 文件中（`block <Name> { <field>: <type> [= 默认值];
in/out 端口 }`），`use <library>` 按搜索路径加载（模型所在目录与 `libraries/`），
`lpcli compile --lib-path` 可指定额外目录：

```logicpilot
use manufacturing
```

行业库通过 `scripts/logicpkg.mjs` 分发：`logicpkg init` → `logicpkg pack`（单文件
`.lpkg` 包）→ `logicpkg install`（防路径穿越）→ `logicpkg list`。新块可用
`extends: ref = <内置块>` 映射到内核已有语义（例如 `Machine → service`），
无需改动内核即可发布、编译、运行；仓库自带 `libraries/manufacturing.lplib`
与 `examples/industry/manufacturing_line.lp`（制造线示例，发布闭环由
`library_publish_smoke` ctest 覆盖）。

## 示例模型

| 文件 | 内容 |
|---|---|
| `examples/mm1.lp` | 基础 M/M/1（理论验收 `mm1.expect.json`） |
| `examples/mm1_failure.lp` | M/M/1 + 机器故障（可用性/有效服务率验收） |
| `examples/two_servers.lp` | 双服务器池 |
| `examples/flat_mm1.lp` | 扁平 agent-centric M/M/1（根级流程块 + couple） |
| `examples/agent_body_mm1.lp` | 流程块放在 agent 体内的 M/M/1（与根级 bit-exact） |
| `examples/pulse_chain.lp` | DEVS 原子链 |
| `examples/agents.lp` | ABM 群体 |
| `examples/decay.lp` / `examples/sir.lp` | 连续 ODE（解析解验收） |
| `examples/seize_release.lp` | 资源抢占/归还（seize→delay→release） |
| `examples/batch_unbatch.lp` | 临时批：batch→unbatch 还原 agent |
| `examples/combine_time.lp` | combine 同步两流 + timeMeasure 测量 |
| `examples/attribute_routing.lp` | 实体属性声明 + selectOutput 按属性路由 |
| `examples/failure_line.lp` | 通用引擎故障模型（failure/repair + availability） |
| `examples/wait_timeout.lp` | wait 退出超时（outTimeout 出口） |
| `examples/priority_preempt.lp` | 优先级排队 + 满队抢占（outPreempted） |
| `examples/match_attr.lp` | match 按实体属性等值配对 |
| `examples/seize_failure.lp` | seize 持有单元的池故障（availability） |
| `examples/flow_exit.lp` | exit 从流程移除 agent（sojourn 保留） |
| `examples/assembler_line.lp` | assembler 等待部件 → 装配延时 → 输出 |
| `examples/move_route.lp` | moveTo 行程时间（tripTime） |
| `examples/comparison_queue.lp` | 比较式排队（agent1IsPreferredToAgent2） |
| `examples/task_preempt.lp` | service 任务抢占（outPreempted） |
| `examples/move_route.lp` | moveTo 沿 path 网络最短路径位移 |
| `examples/select_output5.lp` | selectOutput5 条件路由（首真胜出 / out5 默认） |
| `examples/select_output_quasi.lp` | selectOutputIn/Out 准多出口路由 |
| `examples/condition_statechart.lp` | 状态机条件迁移（表达式轮询） |
| `examples/source-arrivals.lp` | source 到达模式（rate/interarrival/manual、限次） |
| `examples/des-core-conformance.lp` | 确定性 DES 契约（Source→Service→Sink） |
| `examples/des-shared-resource.lp` | 多消费者共享健康资源池仲裁 |
| `examples/des-queue-fifo.lp` / `des-queue-lifo.lp` | 队列 FIFO/LIFO 确定性 |
| `examples/des-queue-timeout-preempt.lp` | 队列超时 + 抢占出口确定性 |
| `examples/des-parameter-variation.lp` | 声明式多轴参数变化 |
| `examples/des-simulation-experiment.lp` | 声明式仿真实验（fixed/random 种子、精度复制） |

完整文法与语义约束见 [DSL 规范](/specs/dsl-spec)。
