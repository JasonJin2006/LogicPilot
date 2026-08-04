# DSL v2 重设计草案（DSL 2.0）

状态: **草案，待评审**（2026-08-04）· 目标: 消除 v0 的语法与绑定混乱，
与 IR v2（Node/SemanticsRef 薄契约 + 引擎注册表）对齐。

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

## 2. 设计目标

1. **一种声明语法**：`kind name { field = value; ... }`，赋值统一 `=`；行为统一为
   `on_<trigger> { effect; ... }` 块。
2. **显式引用**：一切绑定（resource、端口、实验变量）用**限定引用**，禁止同名魔法。
3. **类型 + 表达式**：`param`/`var` 类型化；数值位置接受算术表达式（先常量折叠，
   后参数引用）；分布构造器统一为"返回 distribution 的表达式"。
4. **对齐 IR v2**：每个 DSL 块 1:1 映射 `Node + SemanticsRef`；DSL 成为 v2 契约的
   薄语法层，"加一种库块"不改 DSL 文法。
5. **行为统一**：atomic statechart、agent on_tick、process 阶段统一为
   "状态 + 触发器 + 效果"，由内核引擎注册表解释。

## 2.5 AnyLogic 官方设计对照（依据 anylogic.help 文档）

DSL v2 的形态不是凭空设计，而是对齐 AnyLogic 官方建模模型。逐条对照：

| AnyLogic 官方做法 | 出处 | DSL v2 对应 |
|---|---|---|
| Agent 是唯一建模单元：可定义 variables / events / statecharts / SD 图 / 内嵌 agent / process 流程图 | `agent.html` | 统一 `Node` 容器（state/ports/behavior/continuous/children） |
| Statechart 转移触发器 = Timeout / Rate / Message / Condition | 官方 tutorial + statechart 文档 | v2 `TriggerKind` 已含四类；DSL 统一 `on_<trigger> { }` |
| Source 的到达模式：Rate（= 指数到达，1/rate）或 Interarrival time | `source.html` | `arrival = rate(λ)` 与 `arrival = interarrival(exp(μ))` 显式区分（当前 poisson 隐含指数到达，不透明） |
| Queue 有 discipline：FIFO / LIFO / priority / comparison，容量可无限 | `queue.html` | `queue { capacity = N; ordering = fifo\|lifo }`（新增 ordering 字段） |
| Service = Seize + Delay + Release 组合，容量由 ResourcePool 决定 | `service.html` | `service { resource = R; time = ... }` 显式引用资源（语义即 seize-delay-release） |
| 模型文件 = 元素树（ALP 单文件 / ALPX 分目录，元素含 Parameters/Variables/Events/Statecharts/嵌入 agent） | `model-formats.html` | IR v2 已是 `core/model` Node 树；DSL 只是它的薄语法层 |
| 实验 = Simulation / Monte Carlo（固定输入变 seed）/ Parameter Variation / Optimization（参数 + objective + constraints，OptQuest） | `about-experiments.html`、`optimization.html` | `experiment { variable = 参数路径; range = 上下界; objective/metric/budget }` 已对齐；后续可加 constraints |
| 参数是"root agent"的属性，优化通过注入参数值驱动 | `optimization.html` | 模型级 `param` + `variable = <限定路径>` |
| 引擎只维护事件队列 + 默认 RNG | `engine.html` | 与我们的内核一致（二叉堆 + xoshiro256++） |

结论：AnyLogic 的"块 = 库组件 + 属性面板（type/expression 化的属性）"是 DSL v2 的属性
设计蓝本——**块名保持友好，属性名与官方对齐，引用显式化**。

## 3. 目标语法（草案）

### 3.1 统一声明

```logicpilot
model MM1 {
  param arrival_rate = 0.8        // 模型级参数（新增）
  param service_rate = 1.0

  resource Server {
    capacity = 1
  }

  process Flow {
    source Arrivals {
      arrival = poisson(arrival_rate)   // 表达式 + 参数引用
    }
    queue WaitLine {
      capacity = 0
    }
    service Handle {                    // 服务块自带名字
      resource = Server                 // 显式引用，不再靠同名
      time = exponential(service_rate)
    }
  }
}
```

### 3.2 行为统一为 `on_<trigger> { }`

```logicpilot
atomic Pulser {
  state phase = 0
  time_advance = constant(1.0)
  on_timeout {
    phase = phase + 1          // 表达式赋值（表达式落地后）
    emit pulse
  }
}

agent Drone {
  count = 3
  state active = true
  on_tick {
    flip active                // 内置行为调用（注册表）
  }
}
```

### 3.3 连续方程（保留唯一的特殊记号）

```logicpilot
continuous Dynamics {
  state y = 1.0
  param k = 0.5
  d y/dt = -k * y
}
```

### 3.4 实验引用参数（限定引用）

```logicpilot
experiment TuneArrival {
  objective = minimize Wq
  variable = arrival_rate      // 引用 param，而非魔法字符串
  range = 0.5..1.5
  budget = 20
}
```

### 3.5 文法骨架（v2）

```text
source_file     := model_declaration
model_body      := '{' (param | declaration | experiment)* '}'
declaration     := kind identifier '{' field* '}'
kind            := 'resource' | 'process' | 'atomic' | 'agent' | 'continuous'
field           := identifier '=' expr
behavior        := 'on_' identifier '{' effect* '}'
effect          := assignment | 'emit' port_ref | call
couple          := 'couple' port_ref '->' port_ref
expr            := literal | identifier | unary | binary | call
port_ref        := identifier '.' identifier          // model.port
ref             := identifier ('.' identifier)*       // 限定引用
```

表达式文法先做常量折叠（v2 阶段 1），再放开参数引用（阶段 2）。

## 4. DSL v2 → IR v2 映射

| DSL v2 | IR v2（`ir_v2.fbs`） |
|---|---|
| `param p = <expr>` | 模型级 `SemanticsRef.params` / 节点 `Var` |
| `resource R { capacity=.., failure_rate=.. }` | `Node{ semantics={process,resource}, params=[Var] }` |
| `process P { source/queue/service }` | `Node{ semantics={process,flow}, children=[...], couplings }` |
| `service S { resource=R, time=.. }` | `Node{ semantics={process,service}, params 含 resource 引用 }` |
| `atomic A { statechart }` | `Node{ semantics={devs,atomic}, behavior=Statechart }` |
| `agent A { count, on_tick }` | `Node{ semantics={agent,agent}, behaviors=[BehaviorBinding] }` |
| `continuous C { d x/dt }` | `Node{ semantics={sd,equation}, continuous=[Equation] }` |
| `experiment E { variable=param }` | `ModelFile.experiments[].variable = 限定路径` |

映射是 1:1 的，DSL 块种类可以收窄为"库注册表里的友好别名"。

## 5. 迁移路径（分阶段，沿用 IR v2 的纪律）

- **Phase A（本轮）**: 本草案评审；与现状差异表确认。
- **Phase B（统一文法）**: 重写 `grammar.js`（全部块进文法源）+ 用 tree-sitter CLI
  0.26.11 重生成 `parser.c`/`grammar.json`；`parser.cpp` 适配新节点；**语义保持等价**
  （先不引入表达式/显式引用），全部示例/测试过一遍。修复 D1/D2/D8。
- **Phase C（显式引用）**: `service { resource = R }` 替代同名匹配；semantic 增强
  （`LP2001` 族补引用校验）；修复 D3。
- **Phase D（表达式）**: 表达式文法 + 常量折叠 → 参数引用；`param` 提升到模型级；
  修复 D6；吸收 roadmap P1-5。
- **Phase E（行为统一 + 实验引用）**: `on_<trigger> { }` 统一；experiment `variable`
  改为限定路径；修复 D4/D5/D7。
- 每阶段：示例、测试、`scripts/ai-provider.mjs`（规则生成器）、`docs/specs/dsl-spec.md`
  同步更新；不破坏 136 ctest 与前端测试。

## 6. 与现有文档的关系

- 定稿后：`dsl-spec` 的规则表重写为 v2；tree-sitter README 同步；用户手册 DSL 章更新。
- `roadmap.md` P1-5（DSL 表达式）并入本设计的 Phase D。
- 兼容策略：v0 DSL 文件（示例/黄金测试）在 Phase B/C 提供过渡支持，不设长期兼容承诺
  （DSL 非冻结契约，IR 才是）。
