# ADR-0009: Runtime Execution Strategy (Parallelism + Scripting)

- **Status**: Accepted；Phase A（reps 级并行）、Phase B（agent ECS 批量
  tick 并行）与脚本 Phase 1（运行时条件表达式）均已落地（2026-08-06）
- **Date**: 2026-08-06
- **Deciders**: `/root` (integration) + kernel/DSL owners

## Context

Two decisions block ecosystem growth and were explicitly deferred from
P0-P3 of `docs/dev-plan.md`:

1. **Parallelism**: ADR-0007 accepted *conservative (synchronous)
   parallelism* as the eventual strategy but never scoped how it lands.
   Today everything is single-threaded, including the common
   `--reps 30` replication workflow.
2. **Scripting**: reviewers and users expect runtime behavior (decisions,
   conditions, agent behaviors). The DSL is deliberately static
   (`docs/specs/dsl-freeze.md`: no functions, no control flow), and the
   kernel executes only native block semantics. The open question is how
   "user logic at runtime" executes without breaking bit-exact determinism
   or the DSL freeze.

## Decision

### A. Parallelism - three phases, cheapest first

1. **Phase A (now): replication-level parallelism.** A worker pool runs
   independent replications concurrently. Each replication stays
   single-threaded and bit-deterministic (its own seed stream); the
   `summarize_replications` aggregation is unchanged, so results are
   identical to a sequential run. This is a free win for the
   `lpcli run --reps N` workflow and the first parallelism feature shipped.
2. **Phase B (medium): agent-runtime bulk tick parallelism.** The agent
   runtime is EnTT ECS with SoA hot components (kernel/agent). Fixed-dt
   ticks are partitioned across workers and reduced in a stable order, so
   per-tick semantics and the deterministic event stream never change.
3. **Phase C (deferred): event-level conservative parallelism**
   (ADR-0007). A global safe-window / barrier scheduler across workers,
   only after A/B are proven with real models and perf budgets show the
   need. Determinism golden tests remain the gate at every phase.

### B. Scripting - expression-first hybrid, no VM now

- **Do not add Lua / Python / a bytecode VM at this stage.**
- The kernel already ships a bounded, side-effect-free expression engine:
  `ExpressionEvaluator` (kernel/src/devs/continuous.cpp, used for ODE RHS;
  supports `+ - * /`, unary minus, parentheses, functions, identifiers).
- **Phase 1: runtime condition expressions in bounded decision slots.** The
  IR already carries `condition_text` on `Transition` (schemas/ir_v2.fbs);
  reuse it for process decision blocks: `selectOutput` / `selectOutput5`
  routing, `hold` blocking, `match` rules, and agent `on_tick` guards. The
  kernel evaluates conditions with `ExpressionEvaluator`; identifiers
  resolve through a lookup (block params, state variables, queue length,
  simulation time), samplers and RNG stay declared - no host calls.
- **Phase 2 (only on a concrete requirement): an embeddable script language**
  for user-defined behaviors, behind a VM boundary with zero host access
  (pure sandbox) and deterministic RNG via injected streams. Do not design
  it speculatively.

### Invariants (both A and B)

- Determinism first: same seed => bit-identical event stream, single- or
  multi-threaded, sequential or parallel reps.
- Script/expression evaluation is pure: no I/O, no host calls, no
  side effects; evaluation failures fail the block deterministically and
  produce compiler/runtime diagnostics instead of undefined behavior.
- The DSL freeze (`docs/specs/dsl-freeze.md`) is preserved: expressions are
  data (condition text), not syntax sugar for functions/control flow.

## Consequences

- Positive: replication parallelism is a safe immediate win; agent bulk
  parallelism leverages the existing SoA layout; runtime conditions close
  the biggest scripting gap (decisions) with machinery that already exists;
  no VM complexity or sandboxing burden today.
- Negative: `selectOutput` stays probability-only until Phase 1 lands;
  agent behaviors stay handler-registry-only; event-level parallel scaling
  is deferred to Phase C.

## Implementation notes

- Phase A: `lpcli run --threads <n>` (default 1); a parallel runner returns
  `std::vector<ReplicationMetrics>` and reuses `summarize_replications`.
- Phase 1 conditions: `process_blocks.h` decision blocks take an optional
  `condition_text` evaluated at routing time; DSL `selectOutput` gains a
  `condition = <expr>` field (compile-time constant today, runtime text
  once the kernel evaluator is wired); statechart `condition_text` uses the
  same evaluator.
- Every phase keeps the kernel determinism tests and the expect.json
  acceptance gates green.
