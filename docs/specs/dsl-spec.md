# LogicPilot DSL Specification (v2)

Status: **Implemented** (2026-08-06; supersedes v0) · Normative reference for
the tree-sitter grammar + compiler lowering

This is the normative DSL reference (tree-sitter grammar + compiler
lowering), aligned with `docs/specs/dsl-v2.md`. The grammar is a **thin
generic skeleton**: `kind` is any identifier, resolved by the compiler
against the core kinds and the process library registry (block shapes),
so adding a library block never changes the grammar. `lpcli compile` lowers
the model to the frozen v2 IR contract (`schemas/ir_v2.fbs`, `LP2R`).
Numeric fields accept compile-time constant expressions (arithmetic over
literals and model-level `param`s, see §2).

**Library meta-layer**: block shapes are declared in DSL library files
(`libraries/process.lplib`, embedded into the compiler binary); a parameter
without a default is required, with a default it is optional. The compiler
validates block instances against the registry (`LP2001` missing required,
`LP2005` unknown field, `LP1002` duplicates, `LP3001` type/range); range and
reference semantics stay in the compiler/runtime keyed by `{library, block}`.

## 1. Grammar Rules (v2 generic skeleton)

| # | Rule | Description |
|---|------|-------------|
| R1 | `model_declaration` | `model <Identifier> { block }` — exactly one model per file; top-level container. |
| R2 | `declaration` | `kind <Identifier> { block }` — generic declaration; `kind` is resolved semantically (core kinds: `agent`/`atomic`/`process`/`continuous`/`experiment`; process library: `resource`/`source`/`queue`/`service`/`sink`). Unknown/misplaced kinds → `LP2004`. |
| R3 | `field` | `name = <value>` — one field per occurrence; required/optional sets come from the block shape (unknown fields → `LP2005`). |
| R4 | `variable_declaration` | `state <name> = <value>` / `param <name> = <value>` with optional `: type` annotation (`int`/`float`/`bool`/`string`/`distribution`/`ref`). |
| R5 | `value` | expression: literal (`bool`/`int`/`float`/`string`), bare identifier, numeric call `name(<expr>, ...)`, binary `+ - * /` and comparisons `< > <= >=` (precedence), unary `-`, parentheses. Constant-folded; parameter references resolve against declared `param`s. Runtime condition slots (`selectOutput.condition`, `hold.blockingCondition`) keep their raw text and are evaluated by the kernel at routing time. |
| R6 | `behavior` | `on_<trigger> [port] { effect; ... }` — unified behavior block; triggers `timeout`/`input`/`tick`/...; effects are `name = <value>`, `emit <port>` or `call [arg]`. |
| R7 | `equation` | `d <var>/dt = <rhs>` — structured ODE; RHS supports `+ - * /`, unary `-`, parentheses, identifiers and numeric calls (`exp`/`log`/`sqrt`/`sin`/`cos`, explicit `t`). |
| R8 | `port_declaration` | `in [name]: <type>` / `out [name]: <type>` / `inout [name]: <type>` — typed ports (unnamed → `entity`). |
| R9 | `couple_declaration` | `couple <from>.<port> -> <to>.<port>` — explicit port wiring. |
| R10 | `use_declaration` | `use <library>` — optional in stage 1 (the process library is implicitly available). |
| R11 | `range_field` | `range = <min>..<max>` — experiment search range. |
| R12 | `experiment` | `experiment <Name> { objective/metric/variable/range/budget }` — core config block, travels in `ModelFile.experiments`. |
| R13 | `distribution_call` | `poisson(<Numeric>)` / `rate(<Numeric>)` (equivalent Poisson arrivals), `exponential(<Numeric>)`, `normal(<Numeric>, <Numeric>)`, `constant(<Numeric>)`. |
| R14 | `literal_and_identifier` | Numeric literals (integer / float), identifiers `[A-Za-z_][A-Za-z0-9_]*`; `//` line and `/* ... */` block comments. |

## 2. Semantics (v2)

- A `model` is a root container: model-level `param` declarations, process
  library blocks (`resource`/`source`/`queue`/`service`/`sink`/...), core
  kinds (`atomic`/`agent`/`continuous`/`experiment`), and `couple` wiring.
  There is **no `process` container**: process-library blocks are direct
  members of the `model` root or an `agent` body (agent-centric, `LP2004`
  otherwise).
- A flow executes its stages in declaration order: entities arrive at the
  `source`, pass through `queue`(s), are served by `service`(s), and exit via
  `sink`.
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
// Factory example — agent-centric (no `process` container)
model Factory {
  resource Machine {
    capacity = 3
    failure_rate = 0.01
  }

  source Order {
    arrival = poisson(5)
  }
  queue Buffer {
    capacity = 50
  }
  service Machining {
    resource = Machine
    time = normal(10, 2)
  }
  couple Order.out -> Buffer.in
  couple Buffer.out -> Machining.in
}
```

Equivalent minimal variant using exponential service time:

```logicpilot
model QueueDemo {
  resource Server { capacity = 1 }
  source Clients { arrival = poisson(2) }
  queue WaitLine { capacity = 0 }
  service Server { resource = Server; time = exponential(3) }
  couple Clients.out -> WaitLine.in
  couple WaitLine.out -> Server.in
}
```

## 4. Lowering (non-normative preview)

`model → ir_v2.fbs::ModelFile` (root Node + SemanticsRef children);
process-library blocks and `atomic`/`agent`/`continuous`/`experiment` → v2
Node blocks.
See `docs/specs/ir-v2.md`.

## 5. Explicitly Out of Scope (v2 stage 1)

Runtime-variable references in expressions (state variables are not
compile-time constants), branching (`route`), priorities, replication and
warmup/run-length settings (CLI-level today), multi-file imports, and
expression support inside `experiment` blocks (literal-only).

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
