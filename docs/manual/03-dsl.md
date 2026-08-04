# DSL 语言速查

LogicPilot DSL 是**人与 AI 共用**的模型描述语言：人可以手写，AI 可以生成并依据结构化诊断修复。语法由 tree-sitter 文法定义，编译为 FlatBuffers IR。

## 结构总览

一个 `model` 由零到多个顶层块组成：

```text
model <Name> {
  resource ...     // 资源池（容量/故障）
  process ...      // 离散事件流程（source → queue → service）
  atomic ...       // DEVS 原子 + couple 布线
  agent ...        // Agent 群体（tick 行为）
  continuous ...   // 连续 ODE 系统
  experiment ...   // 模型声明的实验（优化搜索规格）
}
```

## process：离散事件流程

```logicpilot
model MM1Failure {
  resource Server {
    capacity = 1
    failure_rate = 0.1        // 忙时故障率（可选，默认 0）
  }

  process Flow {
    source Arrivals {
      arrival = poisson(0.8)  // 到达分布：poisson(λ) 或 exponential(λ)
    }
    queue WaitLine {
      capacity = 1000000      // 0 = 无缓冲
    }
    service Server {          // 服务块按名称绑定资源
      time = exponential(1.0) // 服务时间：exponential(μ) 或 normal(均值, 标准差)
    }
  }
}
```

实体按声明顺序流动：`source` 生成 → `queue` 缓冲 → `service` 占用资源处理。`resource` 的 `capacity` 是并发上限，`failure_rate > 0` 时内核按"忙时故障 + 修复"建模（可用性 `a = r/(f+r)`）。

## atomic：DEVS 原子

```logicpilot
model PulseChain {
  atomic Pulser {
    time_advance = constant(1.0)   // 或 exponential(rate) / infinite（缺省）
    on_timeout: emit pulse
  }

  atomic Sink {
    state seen = false             // 类型化状态变量
    on_input pulse: seen = true    // 效果：状态赋值
  }

  couple Pulser.pulse -> Sink.pulse  // 显式端口布线
}
```

约束（v0.1）：每个原子最多一个 `on_input`、一个 `on_timeout`；`time_advance` 缺省为 infinite（被动）。

## agent：Agent 群体

```logicpilot
model Swarm {
  agent Drone {
    count = 3
    state active = true
    on_tick flip active   // 内置行为：翻转布尔状态
    on_tick bounce        // 内置行为：在 [0,1]² 内反弹
  }
}
```

行为由内核内置处理器注册表提供（`flip` / `bounce` / 观测收集 `collect` 等），同种子下 tick 顺序确定。

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
  objective = minimize
  metric = Wq
  variable = servers
  range = 1..8
  budget = 20
}
```

实验作为模型的一部分进入 v2 IR（`ModelFile.experiments`），`lpcli compile --experiments-json` 可导出，AI 优化脚本据此做 grid/GA 搜索。

## 示例模型

| 文件 | 内容 |
|---|---|
| `examples/mm1.lp` | 基础 M/M/1（理论验收 `mm1.expect.json`） |
| `examples/mm1_failure.lp` | M/M/1 + 机器故障（可用性/有效服务率验收） |
| `examples/two_servers.lp` | 双服务器池 |
| `examples/pulse_chain.lp` | DEVS 原子链 |
| `examples/agents.lp` | ABM 群体 |
| `examples/decay.lp` / `examples/sir.lp` | 连续 ODE（解析解验收） |

完整文法与语义约束见 [DSL 规范](/specs/dsl-spec)。
