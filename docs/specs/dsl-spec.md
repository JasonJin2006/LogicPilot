# LogicPilot DSL Specification — v2 Draft

Status: **Draft v2 (thin core grammar + library registry)** · Phase 2
implemented (2026-08-04) · Supersedes: v0

This is the normative DSL reference (tree-sitter grammar + compiler
lowering), aligned with `docs/specs/dsl-v2.md`. The grammar is a **thin
generic skeleton**: `kind` is any identifier, resolved by the compiler
against the core kinds and the process library registry (block shapes),
so adding a library block never changes the grammar. `lpcli compile` lowers
the model to the frozen v2 IR contract (`schemas/ir_v2.fbs`, `LP2R`).
Expression grammar is the remaining open item (see §5).

## 1. Grammar Rules (v2 generic skeleton)

| # | Rule | Description |
|---|------|-------------|
| R1 | `model_declaration` | `model <Identifier> { block }` — exactly one model per file; top-level container. |
| R2 | `declaration` | `kind <Identifier> { block }` — generic declaration; `kind` is resolved semantically (core kinds: `agent`/`atomic`/`process`/`continuous`/`experiment`; process library: `resource`/`source`/`queue`/`service`/`sink`). Unknown/misplaced kinds → `LP2004`. |
| R3 | `field` | `name = <value>` — one field per occurrence; required/optional sets come from the block shape (unknown fields → `LP2005`). |
| R4 | `variable_declaration` | `state <name> = <value>` / `param <name> = <value>` with optional `: type` annotation (`int`/`float`/`bool`/`string`/`distribution`/`ref`). |
| R5 | `value` | expression: literal (`bool`/`int`/`float`/`string`), bare identifier, numeric call `name(<expr>, ...)`, binary `+ - * /` (precedence), unary `-`, parentheses. Constant-folded; parameter references resolve against declared `param`s. |
| R6 | `behavior` | `on_<trigger> [port] { effect; ... }` — unified behavior block; triggers `timeout`/`input`/`tick`/...; effects are `name = <value>`, `emit <port>` or `call [arg]`. |
| R7 | `equation` | `d <var>/dt = <rhs>` — structured ODE; raw RHS text until expressions land (Phase D). |
| R8 | `port_declaration` | `in [name]: <type>` / `out [name]: <type>` / `inout [name]: <type>` — typed ports (unnamed → `entity`). |
| R9 | `couple_declaration` | `couple <from>.<port> -> <to>.<port>` — explicit port wiring. |
| R10 | `use_declaration` | `use <library>` — optional in stage 1 (the process library is implicitly available). |
| R11 | `range_field` | `range = <min>..<max>` — experiment search range. |
| R12 | `experiment` | `experiment <Name> { objective/metric/variable/range/budget }` — core config block, travels in `ModelFile.experiments`. |
| R13 | `distribution_call` | `poisson(<Numeric>)` / `rate(<Numeric>)` (equivalent Poisson arrivals), `exponential(<Numeric>)`, `normal(<Numeric>, <Numeric>)`, `constant(<Numeric>)`. |
| R14 | `literal_and_identifier` | Numeric literals (integer / float), identifiers `[A-Za-z_][A-Za-z0-9_]*`; `//` line and `/* ... */` block comments. |

## 2. Semantics (v2)

- A `model` is a root container: model-level `param` declarations, core
  kinds (`resource`/`process`/`atomic`/`agent`/`continuous`/`experiment`) and
  `couple` wiring.
- A `process` executes its stages in declaration order: entities arrive at the
  `source`, pass through `queue`(s), are served by `service`(s), and (v2)
  exit via `sink`.
- A `service` declares which `resource` it consumes with an explicit
  `resource = R` reference (validated `LP4001`); when the field is absent the
  v0 identifier binding is kept as a transitional fallback. If the resource is
  unavailable, the entity waits in the preceding queue.
- Distribution parameters and numeric fields are **constant-folded
  expressions** (Phase D): arithmetic over literals and model-level `param`s
  reduces at compile time (`rate(arrival_rate * 2)` → Poisson [0.8]);
  undeclared identifiers are `LP2006`. `rate` and `poisson` are equivalent
  Poisson arrivals — `poisson` is deprecated.
- Errors (compile-time): unknown resource reference, negative capacities,
  out-of-range `failure_rate`, duplicate declarations, unknown/misplaced
  kinds (`LP2004`), unknown fields (`LP2005`).

## 3. Example

```logicpilot
// Factory example — v0 DSL
model Factory {
  resource Machine {
    capacity = 3
    failure_rate = 0.01
  }

  process Production {
    source Order {
      arrival = poisson(5)
    }
    queue Buffer {
      capacity = 50
    }
    service Machine {
      time = normal(10, 2)
    }
  }
}
```

Equivalent minimal variant using exponential service time:

```logicpilot
model QueueDemo {
  resource Server { capacity = 1 }
  process Arrivals {
    source Clients { arrival = poisson(2) }
    queue WaitLine { capacity = 0 }
    service Server { time = exponential(3) }
  }
}
```

## 4. Lowering (non-normative preview)

`model → ir_v2.fbs::ModelFile` (root Node + SemanticsRef children);
`resource/process/atomic/agent/continuous → v2 Node` blocks.
See `docs/specs/ir-v2.md`.

## 5. Explicitly Out of Scope (v2 stage 1)

Runtime-variable references in expressions (state variables are not
compile-time constants), branching (`route`), priorities, batches,
replication, warmup/run-length settings, multi-file imports, statistics
blocks, and expression support inside `experiment` blocks (literal-only).

## 6. Diagnostics JSON Protocol (AI Copilot loop)

`lpcli compile <input.lp> --diagnostics-json <path>` writes a stable,
machine-readable diagnostics document (valid JSON, always produced on both
success and failure):

```json
{
  "ok": false,
  "source_file": "examples/bad.lp",
  "diagnostics": [
    {
      "code": "LP2001",
      "severity": "error",
      "message": "missing required field 'capacity'",
      "span": { "line": 3, "column": 4, "byte_offset": 40, "byte_length": 10 }
    }
  ]
}
```

`ok` mirrors the compile result; `diagnostics` is empty on success. Fields
map 1:1 to `logicpilot::dsl::Diagnostic` (§2); severity uses the registry
names (`error`/`warning`/`note`). This is the contract consumed by the AI
model generator: the LLM receives the JSON, repairs the DSL, and recompiles.

## 7. Atomic models (DEVS, v0.1)

`atomic` blocks declare classic DEVS atoms whose transitions are **literal
state effects** (no expressions in v0.1). Example:

```logicpilot
model PulseChain {
  atomic Pulser {
    time_advance = constant(1.0)     // or exponential(rate) / infinite
    on_timeout { emit pulse }
  }
  atomic Sink {
    state seen = false               // bool / int / float literals
    on_input pulse { seen = true }
  }
  couple Pulser.pulse -> Sink.pulse  // explicit port wiring
}
```

Semantics:
- `state` declares initial variables; transition `effects` assign literals
  (`LP5001` rejects undeclared targets).
- `time_advance` is constant / exponential (sampled once per run at
  construction, fixed seed => deterministic) / infinite (passive). Absent =
  infinite.
- v0.1 constraints (mirroring the frozen F1 IR `AtomicModel`): **at most one
  `on_input`** (a single external transition, `LP2003`) and **at most one
  `on_timeout`** (a single internal transition).
- `couple` wires an emitted output port to an input port (`LP5002`/`LP5003`).
- The kernel executes these via the IR atomic interpreter on the DEVS-lite
  executor; `lpcli run --arrivals N` is the internal-transition budget, so
  perpetual emitters terminate deterministically.

## 8. Agent models (ABM, v0.1)

`agent` blocks declare an agent population with literal state variables and
`on_tick` behaviors backed by a kernel-built-in handler registry:

```logicpilot
model Swarm {
  agent Drone {
    count = 3
    state active = true
    on_tick { flip active }
    on_tick { bounce }
  }
}
```

- `count` is the population size (>= 1). State variables are bool/int/float
  literals (same syntax as atomic `state`).
- Handlers (v0.1 registry, `LP6001`/`LP6002` validate):
  - `noop` — no-op;
  - `flip <state>` — toggle a declared bool state on every agent;
  - `bounce` — reflect agent positions into [0,1]^2 after the kinematics
    step.
- The kernel runs a fixed-dt (1.0 s) tick loop; `lpcli run --arrivals N` is
  the tick budget. Deterministic (no RNG): identical seed/budget => identical
  trajectories. Hot components (Position/Velocity/AgentState) live in the
  SoA store; model state rides as a cold EnTT component.

## 9. Continuous models (ODEs, v0.1)

`continuous` blocks declare coupled ordinary differential equations executed
by a fixed-step RK4 integrator:

```logicpilot
model SIR {
  continuous Dynamics {
    state S = 0.99
    state I = 0.01
    state R = 0.0
    param beta = 0.5
    param gamma = 0.1
    d S/dt = -beta*S*I
    d I/dt = beta*S*I - gamma*I
    d R/dt = gamma*I
  }
}
```

- `state` declares variables + initial values; `param` declares constants;
  each `d <var>/dt = <rhs>` is one ODE. Equations are coupled: every RHS is
  evaluated against the shared state at each RK4 stage.
- RHS grammar: numbers, identifiers (params + state vars), `+ - * /`,
  parentheses and the functions `exp`, `log`, `sqrt`, `sin`, `cos`; the
  identifier `t` is reserved for simulation time (`LP8002`). `LP8001`
  rejects equations whose lhs is not a declared state variable.
- `lpcli run --arrivals N` = N integration steps of dt = 0.01; the summary's
  `final_value` is the first variable's end state. Deterministic (no RNG).

## 10. Experiment blocks (v0.1)

`experiment` blocks declare the model's own run/optimization setup; they are
part of the model and travel inside the v2 IR (`ModelFile.experiments`):

```logicpilot
experiment Optimization {
  objective = minimize   // maximize | minimize
  metric = Wq            // throughput | W | Wq | Lq | ...
  variable = arrival_rate // declared model param to search over
                         // ('servers' keeps the v0.1 resource-capacity slot)
  range = 1..8           // inclusive integer range
  budget = 20            // search budget (optional, default 20)
}
```

- `lpcli compile --experiments-json <path>` exports the declared experiments
  as JSON; `scripts/ai-optimize.mjs` reads it to drive grid/GA search.
- Semantic validation (`LP2001`/`LP7001`-family) rejects missing
  objective/metric/variable or malformed ranges
  (see `tests/bad_sources/bad_experiment.lp`).
