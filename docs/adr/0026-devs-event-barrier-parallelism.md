# ADR 0026: Deterministic PDEVS timestamp-barrier parallelism

## Context

Replication-level workers and Agent SoA ticks are already parallel, but the
DEVS executor still processed every PDEVS atom on one thread. The runtime plan
already provides stable atom ids and route spans, which are sufficient to
partition atom-local work without introducing optimistic rollback.

## Decision

Add `DevsPartitionPlan` with deterministic contiguous atom ranges, atom work
weights, and an explicit cross-partition route table. `DevsExecutor::run_parallel` applies a
conservative two-phase barrier for PDEVS timestamp rounds:

1. workers run atom-local `lambda` output functions;
2. the coordinator merges output bags in original atom/event order;
3. workers run complete bag transitions;
4. evidence sequencing, internal-budget accounting, and scheduler token
   writes commit in atom-id order.

Atoms must explicitly opt into `supports_parallel_execution()`; the default
is serial, so legacy or externally shared models cannot accidentally enter the
worker path. Atoms may also declare `parallel_lookahead()`; the executor
exposes the resulting conservative safe-horizon lower bound, while zero
lookahead retains the timestamp barrier.

Legacy DEVS-lite models and single-worker calls fall back to the existing
serial loop. No shared scheduler mutation occurs in worker threads.

## Consequences

Independent and cross-partition PDEVS routes can use multiple workers while
preserving event order, bag order, evidence hashes, and replay results. The
barrier is intentionally conservative; optimistic Time Warp and distributed
transport remain future work.
