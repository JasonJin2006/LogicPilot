# ADR-0006: Defer GPU / Distributed / Time Warp (IR Placeholders Only Before Phase 6)

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: LogicPilot Phase 0

## Context

LogicPilot's long-term roadmap includes GPU-accelerated simulation, distributed
execution and optimistic concurrency (Time Warp). Designing for these now would
significantly complicate the IR, scheduler and wire protocol before the core
single-node conservative kernel is proven against the performance budget.

## Decision

- **Defer** GPU, distributed execution and Time Warp to **Phase 6 and later**.
 - Before Phase 6, the IR (`schemas/ir_v2.fbs`) and wire schema may carry minimal
  **reserved/placeholder fields** (e.g. partition id, logical clock) but no
  executable semantics.
- The scheduler is designed so that an optimistic/rollback engine can be added
  behind the same event interface, but no optimistic code is written yet.

## Consequences

- Positive: dramatically smaller Phase 0–5 surface; focus on hitting the
  single-node performance budget first; cleaner validation story.
- Negative: some IR/wire fields are reserved-but-unused; a future phase must
  verify that earlier abstractions do not block optimistic execution (covered
  by keeping the event/scheduler interfaces narrow).
