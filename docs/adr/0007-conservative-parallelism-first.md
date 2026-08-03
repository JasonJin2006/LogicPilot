# ADR-0007: Conservative (Synchronous) Parallelism First

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: LogicPilot Phase 0

## Context

The kernel must reach ≥10M schedule+pop ops/sec while remaining correct and
debuggable at 1M agents. Parallel discrete-event simulation offers two broad
strategies: conservative (synchronization/null-message based) and optimistic
(Time Warp / rollback). Optimistic execution is deferred (ADR-0006).

## Decision

- Adopt **conservative parallelism** as the default execution strategy.
- The scheduler advances via a **global synchronization barrier / safe-window
  mechanism**: events are processed in timestamp order and threads only advance
  within a provably safe horizon before synchronizing.
- Determinism first: given a fixed seed, single- and multi-threaded runs must
  produce identical event orderings (golden tests in `kernel/tests/golden/`).
- Lock-free hot paths only where profiling proves contention; prefer
  partitioned queues per worker over shared contention.

## Consequences

- Positive: correctness is tractable; deterministic replay; simpler debugging;
  a solid foundation to later layer Time Warp behind the same interface.
- Negative: barrier synchronization can cap scaling on skewed workloads;
  partitioning strategy must be revisited with real models (perf budget gates
  in CI will detect regressions early).
