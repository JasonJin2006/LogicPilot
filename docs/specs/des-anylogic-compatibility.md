# DES / AnyLogic Process Modeling Library compatibility

This document is the executable compatibility ledger for LogicPilot DES.
The semantic reference is the local AnyLogic documentation snapshot at
`C:\Users\JasonJin06\Desktop\AnyLogic官方文档\library-reference-guides\process-modeling-library`.
The reference defines behavior; LogicPilot does not copy AnyLogic's Java API.

Status meanings:

- **E2E**: represented in DSL/IR, executed by the runtime, and covered by a
  regression test.
- **Partial**: a useful subset executes, with the unsupported boundary stated.
- **Surface only**: present in the catalog/DSL but not executed. This is a
  defect category; the UI must not imply full support.
- **Planned**: intentionally absent from the supported product surface.

## MVP flow

| Block | Capability | Status | Runtime boundary / next work |
|---|---|---:|---|
| Source | rate / exponential arrivals | E2E | Deterministic seeded sampler |
| Source | interarrival-time distribution | E2E | `arrivalType = "interarrival_time"` selects `interarrivalTime` |
| Source | first arrival after timeout / at start / at time | E2E | Absolute time is relative to model start in the current single-run lifecycle |
| Source | multiple agents per arrival | E2E | Constant integer `agentsPerArrival`; expression-valued batch size is planned |
| Source | limited number of arrivals | E2E | Limit counts arrival events, not generated agents |
| Source | manual injection | Partial | An inert manual Source is representable; public `inject()`/AI tool command is not implemented |
| Source | database, rate schedule, arrival schedule | Planned | Construction fails explicitly instead of silently using `arrival` |
| Queue | finite/unbounded capacity | E2E | Backpressure is propagated upstream |
| Queue | FIFO / LIFO / priority / comparison | E2E | Entity-identity routing proves priority/comparison victim order; invalid or incomplete comparison modes fail at compile time |
| Queue | timeout / preemption ports | E2E | A full preempting Queue always accepts overflow and ejects the least-preferred entity, including newcomer self-ejection; timeout is currently static |
| Service | seize + delay + release, parallel resource units | E2E | Single-pool mode honors `numberOfUnits`; four units with two per task permits two concurrent tasks |
| Service | internal queue capacity / timeout | E2E | Waiting agents honor `queueCapacity` and may leave via `outTimeout` |
| Service | task preemption | Partial | Priority termination path exists; full AnyLogic policy matrix is not complete |
| Sink | removal and time-in-system accounting | E2E | Per-block `count()` query API is not exposed yet |
| ResourcePool | fixed capacity, busy utilization | E2E | Healthy fixed pools arbitrate capacity across multiple Service blocks; capacity schedules and home-location modes are planned |
| ResourcePool | failure / repair | Partial | One pool-wide busy-time failure/repair clock per declared pool. Service consumers interrupt their in-service tasks and restart them (preemptive-repeat) on repair; Seize/Assembler consumers gate new grants while the pool is down but never interrupt held units (AnyLogic's default "No preemption" policy, where the failure task waits for the unit). The clock lives inside a busy period (first unit held -> last unit released): when the pool goes idle, a failure that has NOT happened yet stops counting (its pending TTF is cancelled), but a failure that HAS happened must complete its repair - releasing the last unit neither cancels the repair nor clears the down state, and waiters resume only when the repair event fires. The run's business end is defined by the Source lifecycle (every Source exhausted by its own maxArrivals / manual / zero limit / sampler termination / the global arrivals cap, with no valid pending Source arrival) plus in_system == 0; pending arrivals of other sources are cancelled when the global cap is reached. Tail maintenance events after that point are cancelled/dropped, so the horizon stays at the exact business end. AnyLogic models failures per resource unit with per-unit clocks - unit-level failure clocks are planned |
| Process flow | Source arrival lifecycle | E2E | Per-source pending arrival tokens and exhaustion tracking; reaching the global arrivals cap cancels other sources' pending arrivals so they cannot advance the clock; external (kernel-owned) scheduler resets cancel every engine-owned pending event (source/depart/timeout/block failure/repair/pool failure/repair), handlers register once per (registry identity, epoch) and are re-registered after attach/clear |
| Process flow | wait timeout lifecycle | E2E | Timeouts are cancelled when the entity leaves the waiting area, starts service/seizes, or is preempted/routed out before firing; a live timeout (business still running) keeps firing through outTimeout; tail block events are cancelled after the business truly ends |
| Process flow | output port fan-out | Restricted | A process output port connects to exactly one downstream (compile-time `LP5007`); duplicating an entity requires an explicit `split` block, whose copies are independent entities (arrivals/departures/in-system stay balanced) |
| Process flow | warm-up by external arrivals | E2E | `--warmup N` excludes the first N external Source arrival events (whole batches); split copies inherit their original's lineage and never shift the warm-up boundary, and changing the copy count does not change which external arrivals are excluded |
| Delay | stochastic time, finite/unlimited concurrent capacity | E2E | Runtime capacity mutation and suspend/resume are planned |

## Product-level gaps

The following are higher priority than adding more catalog blocks. Completed
items remain here because they define the product-level acceptance boundary:

1. **MVP property badges delivered:** Source, Queue, Service, Sink, and
   ResourcePool fields now distinguish executed, partial, and not-executed
   semantics. Extend the explicit runtime contract to each additional block
   before treating its imported AnyLogic property surface as supported.
2. **ModelPatch proposal loop delivered for the first vertical slice:** AI
   results are converted to a reviewable minimal patch, destructive operations
   are called out, stale proposals cannot be applied, and application remains
   atomic and undoable. Parameter edits to an existing DES model preserve
   unrelated DSL and graph identity. Accepted patches are rerun from the exact
   regenerated canvas DSL through separate validation/run endpoints. Existing
   models now use native inspect/patch/validate/run/query tool calls for
   parameter edits, basic structural edits, and grounded result questions.
   Baseline/modified runs are compared through structured per-block deltas.
   Richer multi-turn structural intent remains; complete DSL generation is
   the empty-canvas bootstrap fallback.
3. **Self-contained desktop runtime delivered:** `app/server.mjs` serves the
   built IDE, AI endpoints, and native WebSocket gateway. The staged Tauri
   resources include Node, MSVC Release `lpcli`/`lp-server`, required DLLs,
   frontend assets and AI modules. An isolated-PATH smoke test verifies every
   manifest hash and exercises AI build plus real simulation, including from a
   non-ASCII install path. Installer first-launch/upgrade testing remains M4.
4. **Core golden scenarios delivered:** deterministic models now verify
   Source, Service, Sink, shared ResourcePool arbitration, Queue
   timeout/preemption, FIFO/LIFO ordering, priority/comparison victim identity,
   and newcomer self-preemption through DSL -> IR -> runtime. Unknown Queue
   modes, missing comparison expressions, and unknown compared attributes fail
   at compile time instead of silently degrading to FIFO.

## Experiments and statistical comparison

The reference is also the local AnyLogic `anylogic/experiments` documentation.
LogicPilot deliberately separates a single interactive Simulation run from
multiple-run experiments, as AnyLogic does.

| Capability | Status | Boundary |
|---|---:|---|
| Fixed-seed reproducible Simulation | E2E | IDE/gateway/AI/CLI use the same seed contract |
| Fixed number of replications | E2E | DSL `experiment` lowers seed/count into IR; `lpcli run --experiment` consumes it |
| Student-t confidence intervals | E2E | Configurable confidence is honored by CLI, live gateway and AI runs |
| Paired before/after inference | E2E | AI reuses identical replication seeds and reports a CI for each mean difference |
| Random unique seed mode | E2E | DSL/IR, CLI, gateway, IDE and AI resolve a unique run seed and report it for replay |
| Varying replications until precision target | E2E | Minimum/maximum repetitions, confidence, metric and relative CI error are enforced end to end |
| Multi-axis Parameter Variation (range mode) | E2E | Top-level numeric params, floating/integer ranges, Cartesian combinations, concurrent points, fixed/precision replications, fixed/random seeds, IDE result table |
| Parameter Variation freeform values | E2E | An explicit `values` list replaces the range/step expansion in grid and Monte Carlo modes; grid and Monte Carlo share one axis validation (non-empty finite values, valid variable identifier, finite `min <= max`, positive step when present) |
| Parameter Variation database parameter sets | Planned | External data sources are not |
| Monte Carlo sampling (seeded) | E2E | Deterministic mulberry32 sampling over the axes; seeds are validated to the 32-bit sampler state (`[0, 4294967295]`) so large seeds cannot silently collide |
| Monte Carlo experiment / histogram UI | Planned | Do not conflate Monte Carlo sampling with the deterministic parameter grid |

## Structured statistics contract

`ReplicationMetrics.blocks` and `metrics.json.blocks` now expose stable block
identity plus arrivals, departures, timeout/preemption counts, mean occupancy,
utilization, availability, and capacity. The AI build endpoint returns this
JSON unchanged, and the IDE renders it as a DES block table. Human-readable
CLI output is no longer the AI integration contract.
`metrics.json.summary` carries mean/stddev/confidence bounds and
`metrics.json.replications` carries the exact derived seed for every sample.
AI comparisons pair rows by `(rep, seed)` and label a change inconclusive when
the configured confidence interval includes zero.
For random or precision-driven baselines, the AI freezes the resolved run seed
and actual sample count before running the proposed model, preserving a valid
paired comparison instead of comparing unrelated random samples.

## Conformance rule

Every status promotion to **E2E** requires all four layers to agree:

`property editor -> DSL -> IR -> runtime result`

A catalog entry or a successful compile alone does not count as support.

For an AI-authored feature, two additional layers are required:

`natural-language intent -> reviewable ModelPatch -> the same runtime result`

Core numeric fields reject invalid cardinalities and timeouts at compile time
instead of relying on runtime clamping. LogicPilot's `failure_rate` is an
exponential rate (`>= 0`), not a probability capped at one.
