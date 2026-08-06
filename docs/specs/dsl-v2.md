# DSL v2 重设计草案（DSL 2.0）——分层设计

状态: **已实施**（Phase B–E 全部落地，2026-08-06；本文为设计记录，规范性与
规则表以 `dsl-spec.md` 为准）· 目标: 消除 v0 的语法与绑定混乱，
对齐 IR v2（Node/SemanticsRef 薄契约 + 引擎注册表），并按 AnyLogic 官方的
分层（核心原语 + 块库 + 模型文件）重构 DSL 的语法分层。

## 0. 一句话结论

DSL v2 采用 **"薄核心文法 + 厚库注册表"**：`grammar.js` 只描述通用骨架
（`kind name { field = expr; on_<trigger> { }; couple; ... }`），
`source/queue/service` 等**全部是库注册表条目**——块形状（端口/参数/类型）
用 DSL 元层（`library`/`block`）声明，块行为由 C++ 引擎注册表按
`{library, block}` 实现。这与 IR v2 的 `SemanticsRef` 一一对应：
**加一种新块 = 注册一条库条目，语法与 schema 都不动。**

## 1. 现状诊断（v0 的混乱来源）

DSL 是"每完成一个里程碑长一块"累积出来的，缺少一次统一的语法与语义设计：

| # | 问题 | 证据 |
|---|---|---|
| D1 | **文法源文件脱节**：`grammar.js` 只描述 v0 核心（resource/process），真实文法在已生成的 `parser.c`（含 atomic/agent/continuous/experiment）。改 `grammar.js` 会覆盖/丢失功能，违反 ADR-0005"同 commit 再生成"纪律 | `grammar.js` vs `src/parser.c`、`src/grammar.json` |
| D2 | **语法风格不统一**：赋值式（`capacity = 1`）、冒号式（`on_timeout: emit`）、箭头式（`couple a.p -> b.p`）、分式式（`d y/dt = ...`）混用；同概念不同词（`time_advance` vs `time`） | 各示例 `.lp` |
| D3 | **绑定靠名字魔法**：`service Server { ... }` 靠**标识符同名**绑定 resource；`couple` 端口、experiment 的 `variable` 都是裸字符串；改名字即悄悄失联 | `lowering.cpp` 以 `stage.name` 查资源 |
| D4 | **"块"语义不统一**：resource/process 是声明，atomic/agent/continuous 是模型定义，experiment 是配置——全部平铺在 `model { }` 下，无"实例 vs 定义"区分；新用户不知道什么该放哪 | `_model_member` 规则 |
| D5 | **行为三套写法**：atomic 的 `on_input/on_timeout + effects`、agent 的 `on_tick + handler 字符串`、process 阶段语义硬编码在 QueueingFlowSim——没有统一的"行为"概念 | grammar/parser/semantic |
| D6 | **无表达式/参数**：所有数值是字面量；`param` 只存在于 continuous；无法表达 `time = normal(mu, 5 + k)`；实验 `variable` 只能指字符串槽位 | grammar `_numeric` |
| D7 | **与 IR v2 概念错位**：IR 已是"Node + SemanticsRef 库注册表"，DSL 仍是五类平铺，享受不到 v2 的统一性 | `ir_v2.fbs` vs grammar |
| D8 | **文档失真**：`dsl-spec` 规则表 R1–R15、tree-sitter README 的"v0 subset"都与真实文法不符 | 各文档 |

## 2. 设计原则

1. **薄核心**：文法只保留通用骨架，不出现任何业务块名；`kind` 是任意
   identifier，由语义分析解析为"核心种类 / 库块 / 报错"。
2. **厚库**：块 = 库注册表条目。块形状（端口/参数/类型/默认值）用 DSL 元层
   声明，块行为由 C++ 引擎注册表实现——AnyLogic palette + FMI FMU 接口的思路。
3. **一种声明语法**：`kind name { field = value; ... }`，赋值统一 `=`；
   行为统一为 `on_<trigger> { effect; ... }`。
4. **显式引用**：资源、端口、实验变量全部用限定引用，禁止同名魔法。
5. **类型 + 表达式**：`param`/`state`/库块字段类型化；数值位置接受表达式
   （先常量折叠，后参数引用，分阶段落地）。
6. **1:1 映射 IR v2**：每个 DSL 元素映射 `Node + SemanticsRef`；不引入
   IR v2 表达不了的概念（如资源引用以编译期校验的 `ref` 类型落地）。

### 2.1 已定决策（Phase B 起生效）

| 决策点 | 结论 | 说明 |
|---|---|---|
| `use` 库声明 | **可选语法，Phase B 标准库隐式可用** | 目前只有 process 一个库，`use process` 可写可不写；Phase E 多库落地后 `use` 成为必填校验 |
| `resource` 块名 | **保留友好名**（`ResourcePool` 的别名） | 与 v0 示例/测试一致；库注册表记录 `resource → ResourcePool` 别名 |
| `poisson(λ)` | **Phase B 保留，与 `rate(λ)` 等价** | 两者都映射"到达率 λ 的泊松过程"（IR Distribution kind=Poisson）；Phase D 表达式落地时正式弃用 `poisson` |
| `interarrival(dist)` | **推迟（已记录）** | 与 AnyLogic 的 Interarrival time 对应；内核到达驱动（ir_loader streaming）暂只支持 poisson/rate/exponential，任意到达间隔分布待内核扩展后落地 |

## 3. AnyLogic 官方分层对照

| AnyLogic 官方做法 | 出处 | DSL v2 对应 |
|---|---|---|
| Agent 是唯一建模单元：variables / events / statecharts / SD 图 / 内嵌 agent / process 流程图 | `agent.html` | 统一 Node 容器；核心容器 `agent/atomic/process/continuous` + `model` 根 |
| Statechart 转移触发器 = Timeout / Rate / Message / Condition | 官方 tutorial + statechart 文档 | 核心 `on_<trigger> { }` 行为（对应 `TriggerKind` 四类） |
| Source/Queue/Service 是 **PML 库块**（预建 Java 类），**不是语言关键字** | `process-modeling-library.html` | `source/queue/service/...` 是 process 库注册表条目，非语法关键字 |
| ResourcePool 块 + Service 引用资源（seize-delay-release） | `service.html` | `resource`（ResourcePool 友好名）+ `service { resource = R }` 显式引用 |
| Queue 有 discipline：FIFO / LIFO / priority / comparison，容量可无限 | `queue.html` | 块形状字段 `ordering: string = "fifo"`、`capacity: int = -1` |
| Source 到达 = Rate（指数到达，1/rate）或 Interarrival time | `source.html` | `arrival = rate(λ)` 显式区分（v0 的 `poisson` 隐含指数到达，不透明，弃用）；`interarrival(dist)` 待内核扩展后落地 |
| 模型文件 = 元素树（ALP 单文件 / ALPX 分目录） | `model-formats.html` | DSL 文件 → IR v2 `core/model` Node 树；DSL 只是薄语法层 |
| 实验 = Simulation / Monte Carlo / Parameter Variation / Optimization（参数 + objective + constraints，OptQuest） | `about-experiments.html`、`optimization.html` | `experiment` 核心块（variable/range/objective/metric/budget）；后续可加 constraints |
| 引擎只维护事件队列 + 默认 RNG | `engine.html` | 与内核一致（二叉堆 + xoshiro256++） |

关键结论：AnyLogic 的"语言"不是关键字，而是 **Agent 基座（核心）+ 块库（库层）+
模型文件（XML + 生成代码）**。我们保留这个分层形状，把"XML + 任意 Java"换成
**"DSL（类型化、带 span、AI 可生成）+ IR v2（版本化、冻结、可验证）"**——
这正是我们比 AnyLogic 强的工程纪律所在。

## 4. 分层结构

```
┌────────────────────────────────────────────────┐
│ 核心语法层（grammar.js，固定且薄）               │
│  model / param / state / experiment             │
│  容器: agent | atomic | continuous              │
│  行为: on_<trigger>{ }   耦合: couple            │
│  元层: library / block / 类型注解                │
└───────────────┬────────────────────────────────┘
                │ kind 解析（核心种类 or 库注册表）
┌───────────────▼────────────────────────────────┐
│ 库层（注册表：形状 DSL 声明，行为 C++ 实现）      │
│  process: Source/Queue/Service/Sink/ResourcePool│
│  （未来）manufacturing / logistics / pedestrian │
└───────────────┬────────────────────────────────┘
                │ 形状校验 + 类型检查 + 引用校验
┌───────────────▼────────────────────────────────┐
│ 模型层（用户 .lp 文件）                          │
│  model MM1 { use process; resource ...;         │
│              source ...; couple a.out -> b.in } │
└───────────────┬────────────────────────────────┘
                │ lowering（1:1）
                ▼
        IR v2（Node + SemanticsRef，冻结契约）
```

### 4.1 核心语法层

`kind` 规则 = 任意 identifier，由语义分析解析。文法不做块名枚举——
这从根上消灭 D1（grammar 与 parser 脱节）与 D4（块语义平铺）。

```text
source_file      := model_declaration
model_declaration:= 'model' identifier '{' member* '}'
member           := 'use' library_name | param | declaration | experiment
param            := 'param' identifier (':' type)? '=' expr
declaration      := kind identifier '{' declaration_body '}'
kind             := identifier                  // 核心种类或已注册库块名
declaration_body := (field | state | port | behavior | declaration | couple)*
field            := identifier '=' expr
state            := 'state' identifier (':' type)? '=' expr
port             := ('in'|'out'|'inout') identifier? ':' type
behavior         := 'on_' identifier '{' effect* '}'
effect           := assignment | 'emit' port_ref | call
couple           := 'couple' port_ref '->' port_ref
experiment       := 'experiment' identifier '{' exp_field* '}'
exp_field        := 'objective' '=' ('minimize'|'maximize') metric
                  | 'variable' '=' ref
                  | 'range' '=' expr '..' expr
                  | 'budget' '=' expr
                  | 'replications' '=' expr
                  | 'seed' '=' expr
```

**核心种类**（grammar 保留，映射固定语义）：

| 种类 | IR semantics | 说明 |
|---|---|---|
| `model` | 根 Node | 根容器：param、容器、库块实例、experiment |
| `agent` | `{agent, agent}` | ABM 容器：`count`、`state`、`on_tick`、内嵌 agent |
| `atomic` | `{devs, atomic}` | DEVS 容器：`state`、`time_advance`、`on_timeout/on_input`、端口 |
| `process` | —（已移除） | 旧容器写法已舍弃：编译报 LP2004；流程块直接写在 model/agent 作用域，用 `couple` 连线 |
| `continuous` | `{sd, equation}` | 连续容器：`state`、`param`、`d x/dt = ...` |
| `experiment` | `ModelFile.experiments[]` | 实验（核心配置块） |

行为是**核心概念**（对应 AnyLogic 的 Statechart 为内建能力）：任何容器都可写
`on_<trigger> { }`，触发器四类（timeout/rate/message/condition），由引擎注册表
解释——这统一了 D5 的三套行为写法。

### 4.2 库层（块形状注册表）

块形状用 DSL 元层声明（`library`/`block`），嵌入编译进注册表；块行为由 C++ 引擎
按 `{library, block}` 查表实现。**标准库 `process` 随仓库交付**（
`libraries/process.lplib`，经 `scripts/gen-stdlib-header.mjs` 嵌入编译器）。

```logicpilot
// libraries/process.lplib（草案；Phase E 落地为真实文件）
library process {
  version = 1

  block ResourcePool {              // 友好名 `resource`
    capacity: int = 1
    failure_rate: float = 0.0
  }

  block Source {
    out: Job                        // 方向 + 类型；端口名默认 entity
    arrival: distribution = rate(1.0)   // rate(λ)（interarrival 待内核扩展）
  }

  block Queue {
    in: Job
    out: Job
    capacity: int = -1              // -1 = 无限
    ordering: string = "fifo"       // fifo | lifo | priority
  }

  block Service {
    in: Job
    out: Job
    resource: ref = ""              // 引用同容器/模型内的 ResourcePool
    time: distribution = exponential(1.0)
  }

  block Sink {
    in: Job
  }
}
```

块形状 = 端口（方向 + 名称 + 类型）+ 类型化参数（类型 + 默认值）。编译器据此做：
- **字段校验**：实例字段名必须在块形状中（未知字段 → `LP2001`，带 span）。
- **类型检查**：`capacity = 1000000` 必须 `int`；`arrival = rate(0.8)` 必须
  `distribution`。
- **引用校验**：`service.resource` 必须指向已声明的 `ResourcePool` 实例。

### 4.3 模型层（示例重写）

```logicpilot
// M/M/1：λ=0.8，μ=1.0，ρ=0.8，Wq=4.0（与 examples/mm1.expect.json 一致）
model MM1 {
  use process

  param arrival_rate: float = 0.8
  param service_rate: float = 1.0

  resource Server {                 // process 库 ResourcePool 块的友好名
    capacity = 1
  }

  // 流程块直接是 model 根成员，用 couple 连线（agent-centric，无容器）。
  source Arrivals { arrival = rate(arrival_rate) }
  queue WaitLine { capacity = 1000000 }
  service Handle { resource = Server; time = exponential(service_rate) }
  sink Done { }

  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in

  experiment TuneArrival {
    objective = minimize Wq
    variable = arrival_rate
    range = 0.5..1.5
    budget = 20
  }
}
```

行为示例（核心语法，容器内）：

```logicpilot
model Swarm {
  agent Drone {
    count = 3
    state active: bool = true
    on_tick { flip active }
    on_tick { bounce }
  }
}

model PulseChain {
  atomic Pulser {
    count = 3
    state phase: int = 0
    time_advance = constant(1.0)
    on_timeout {
      phase = phase + 1
      emit pulse
    }
  }
  couple Pulser.pulse -> Next.input   // 端口显式耦合（跨实例）
}

model Decay {
  continuous Dynamics {
    state y: float = 1.0
    param k: float = 0.5
    d y/dt = -k * y
  }
}
```

### 4.4 编译与诊断流程

1. 解析（通用文法，错误容忍，带 span）。
2. kind 解析：核心种类 → 库注册表 → 否则 `LP2001`（unknown kind，带 span）。
3. 形状校验：实例字段/端口/类型对照块形状。
4. 引用校验：`resource` 引用、`couple` 端口、`experiment.variable` 路径。
5. lowering → IR v2（1:1，见 §6）。
6. 运行时：引擎注册表按 `{library, block}` 分发。

## 5. 类型与表达式（分阶段）

| 类型 | 说明 | IR VarType |
|---|---|---|
| `int` / `float` / `bool` / `string` | 标量 | Int / Float / Bool / String |
| `distribution` | `rate(λ)` / `exponential(μ)` / `normal(m,s)` / `constant(c)`（`interarrival` 待内核扩展） | Distribution |
| `ref` | 编译期校验的块引用，lowering 为名字字符串（span 记录进 metadata） | String |

表达式分阶段（Phase D）：先常量折叠（`rate(0.8)`），后参数引用
（`rate(arrival_rate)`）。v0 的 `poisson(λ)` 到达构造器弃用，改为语义明确的
`rate(λ)`（指数到达，泊松过程的正确对应）；`interarrival(dist)` 与 AnyLogic
的 Interarrival time 对应，待内核到达驱动支持任意到达间隔分布后落地。

## 6. DSL v2 → IR v2 映射

| DSL v2 | IR v2（`ir_v2.fbs`） |
|---|---|
| `model M { ... }` | `ModelFile{ root = Node }`（schema_version=2） |
| `param p: float = 0.8` | 根/容器 `Node.params = [Var]` |
| `resource Server { capacity = 1 }` | `Node{ semantics={process,ResourcePool}, params=[Var{capacity,Int,1}] }` |
| `source A { arrival = rate(0.8) }` | `Node{ semantics={process,Source}, params=[Var{arrival,Distribution}] }` |
| `queue Q { capacity = N }` | `Node{ semantics={process,Queue}, params=[Var{capacity,Int}] }` |
| `service S { resource=R; time=... }` | `Node{ semantics={process,Service}, params=[Var{resource,String,R}, Var{time,Distribution}] }` |
| `sink K { }` | `Node{ semantics={process,Sink}, params=[] }` |
| `agent A { count, on_tick }` | `Node{ semantics={agent,agent}, behaviors=[BehaviorBinding] }` |
| `atomic A { statechart }` | `Node{ semantics={devs,atomic}, behavior=Statechart }` |
| `continuous C { d x/dt }` | `Node{ semantics={sd,equation}, continuous=[Equation] }` |
| `couple a.p -> b.p` | `Node.couplings = [Coupling]` |
| `experiment E { variable=param }` | `ModelFile.experiments[].variable = 限定路径` |

映射是 1:1 的，**不引入 IR v2 表达不了的概念**；`resource` 引用以 `String` 参数
落地，但编译期已做 `ref` 校验（禁止裸字符串魔法）。

## 7. 迁移路径（分阶段，沿用 IR v2 的纪律）

- **Phase A（本轮）**: ✅ 本草案评审；分层设计确认（薄核心文法 + 库注册表）。
- **Phase B（泛化文法）**: ✅ 已完成（2026-08-04）：`grammar.js` 重写为通用骨架
  （`kind = identifier`、统一 field/behavior/port/couple/expr），tree-sitter CLI
  0.26.11 重生成 `parser.c`/`grammar.json`/`node-types.json`；`parser.cpp`/AST
  改为泛化 Node；process 库块形状迁入编译器内建注册表（C++ 侧形状表，新增
  `LP2004` 未知/错位 kind、`LP2005` 未知字段）；semantic 增加 kind 解析 + 形状
  校验；corpus 重写为 40 用例；示例/测试/`scripts/ai-provider.mjs` 同步为 v2
  写法（`on_<trigger> { }` 行为；`poisson` 保留为 `rate` 等价别名）。
  修复 D1/D2/D8。
- **Phase C（显式引用）**: ✅ 已完成（2026-08-04）：`service { resource = R }`
  显式引用替代同名魔法绑定——`resource` 字段进 service 块形状（`LP2005` 放行），
  引用目标必须指向已声明资源（`LP4001`，span 指向引用处）；字段缺失时保留
  v0 同名绑定作为过渡回退；lowering 按引用解析 `resource`/`servers` 参数。
  示例（mm1/mm1_failure/two_servers）迁移为 `service Handle { resource = Server; ... }`，
  AI provider 同步；golden 与新增 `LP4001` 引用测试覆盖。修复 D3。
- **Phase D（表达式）**: ✅ 已完成（2026-08-04）：`value` 文法扩展为表达式
  （二元 `+ - * /` 带优先级、一元取负、括号）；AST 改为表达式树；编译器
  常量折叠（`rate(2 * 0.4)` → Poisson[0.8]）并解析参数引用
  （`rate(arrival_rate)` → 取模型级 `param` 值，`LP2006` 拒绝未声明标识符/
  非常量）；模型级 `param` 落入 IR 根节点 params；示例 mm1 迁移为
  `param arrival_rate` + `rate(arrival_rate)`。修复 D6；吸收 roadmap P1-5。
- **Phase E（行为统一 + 实验 + 库元层）**: ✅ 全部完成（2026-08-04）——
  行为统一 `on_<trigger> { }` 已在 Phase B 落地；experiment `variable` 限定路径
  （引用已声明模型参数，`LP7001` 校验，`servers` 保留兼容）；**`library`/`block`
  库元层落地**：块形状声明在 `libraries/process.lplib`（类型化字段
  `capacity: int`、无默认值即必填），由 `scripts/gen-stdlib-header.mjs` 嵌入
  编译器（`stdlib_process.h`），semantic 按注册表做形状校验（必填/未知字段/
  重复/参数类型），C++ 侧只保留范围与引用等语义规则——**加一种新库块 =
  注册一条块形状，文法与 schema 不动**。修复 D4/D5/D7。
- 每阶段：示例、测试、`scripts/ai-provider.mjs`（规则生成器）、
  `docs/specs/dsl-spec.md` 同步更新；不破坏 136 ctest 与前端测试。

## 8. 与现有文档的关系

- 定稿后：`dsl-spec` 的规则表重写为 v2 分层；tree-sitter README 的"v0 subset"
  描述重写为通用骨架描述；用户手册 DSL 章更新。
- `roadmap.md` P1-5（DSL 表达式）并入本设计的 Phase D；P1-5 范围更新为分层重设计。
- 兼容策略：v0 DSL 文件（示例/黄金测试）在 Phase B/C 提供过渡支持，不设长期兼容
  承诺（DSL 非冻结契约，IR 才是）。
