# LogicPilot DSL Specification — v0 Draft

Status: **Draft v0** · Phase 0 · Supersedes: —

This is the minimal DSL subset targeted by Phase 1–2 (tree-sitter grammar +
compiler lowering to `schemas/ir.fbs`, ADR-0004/0005). Anything not listed
here is out of scope for v0.

## 1. Grammar Rules (v0 subset, 15 rules)

| # | Rule | Description |
|---|------|-------------|
| R1 | `model_declaration` | `model <Identifier> { block }` — exactly one model per file; top-level container. |
| R2 | `resource_declaration` | `resource <Identifier> { resource_body }` — declares a reusable resource type. |
| R3 | `resource_field_capacity` | `capacity = <Integer>` — max concurrent usage, required, ≥ 1. |
| R4 | `resource_field_failure_rate` | `failure_rate = <Float>` — failure probability per time unit, optional, [0.0, 1.0], default 0.0. |
| R5 | `process_declaration` | `process <Identifier> { block }` — declares an entity flow; contains source/queue/service stages. |
| R6 | `source_declaration` | `source <Identifier> { source_body }` — entity arrival generator inside a process. |
| R7 | `source_field_arrival` | `arrival = <arrival_expr>` — arrival distribution expression, required. |
| R8 | `arrival_expr_poisson` | `poisson(<Numeric>)` — Poisson arrival with given rate parameter. |
| R9 | `queue_declaration` | `queue <Identifier> { queue_body }` — buffering stage inside a process. |
| R10 | `queue_field_capacity` | `capacity = <Integer>` — buffer size, required, ≥ 0 (0 = no buffering). |
| R11 | `service_declaration` | `service <Identifier> { service_body }` — processing stage bound to a resource. |
| R12 | `service_field_time` | `time = <service_time_expr>` — service time distribution, required. |
| R13 | `service_time_expr_normal` | `normal(<Numeric>, <Numeric>)` — normal distribution (mean, std-dev). |
| R14 | `service_time_expr_exponential` | `exponential(<Numeric>)` — exponential distribution with given rate/mean parameter. |
| R15 | `literal_and_identifier` | Numeric literals (integer / float), identifiers `[A-Za-z_][A-Za-z0-9_]*`; `//` line comments. |

## 2. Semantics (v0)

- A `model` consists of zero or more `resource` declarations followed by zero
  or more `process` declarations.
- A `process` executes its stages in declaration order: entities arrive at the
  `source`, pass through `queue`(s), and are served by `service`(s).
- A `service` whose identifier matches a declared `resource` consumes one unit
  of that resource's capacity; if unavailable, the entity waits in the
  preceding queue.
- Distribution parameters are deterministic literals in v0 (no expressions,
  no variables, no function calls beyond the built-in distributions listed).
- Errors (compile-time): unknown resource reference, negative capacities,
  out-of-range `failure_rate`, duplicate declarations.

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

`model → ir.fbs::Model`; `resource → ir.fbs::Resource`;
`process/source/queue/service → ir.fbs::Process` stage tables.
Exact field mapping is defined when `schemas/ir.fbs` lands.

## 5. Explicitly Out of Scope for v0

Variables/expressions, branching (`route`), priorities, batches, replication,
warmup/run-length settings, multi-file imports, statistics blocks.

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
    on_timeout: emit pulse
  }
  atomic Sink {
    state seen = false               // bool / int / float literals
    on_input pulse: seen = true
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
