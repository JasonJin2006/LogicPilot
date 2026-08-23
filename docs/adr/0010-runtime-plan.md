# ADR-0010: Compile a DEVS Runtime Plan Before Execution

- **Status**: Accepted; initial lowering implemented
- **Date**: 2026-08-22
- **Deciders**: `/root` (integration) + kernel/DSL owners

## Context

`CoupledModel` is deliberately hierarchical and name-oriented so it can be
inspected, edited, and serialized. Walking that representation during every
event dispatch would keep name resolution, recursive pass-through routing, and
debug metadata on the hot path. It would also make later scheduler backends
depend on the UI-oriented model tree.

## Decision

Compile a `CoupledModel` once into `DevsRuntimePlan` before a replication starts.
The plan owns no model state; it borrows atomic models and contains:

- stable flat atom ids and hierarchy paths;
- model-local output route spans backed by contiguous target storage;
- root input route spans;
- resolved root port ids.

`DevsExecutor` consumes the plan for routing and scheduling. The source model
tree remains the source of truth for editing and inspection.

The first implementation keeps the plan single-node and deterministic. It does
not yet choose calendar queues, partition the graph, or serialize the plan.
Those are later compiler/backend passes and must preserve the plan's source
paths and route semantics.

## Consequences

- The runtime no longer depends on recursive model traversal or string lookup
  in the event hot path.
- Flat runtime ids provide a stable place for source mapping, profiling, and
  future conservative partitioning.
- Existing DEVS-lite and opt-in PDEVS models continue to share the executor.
- The plan borrows atom objects, so its lifetime must remain inside the model
  tree lifetime; ownership transfer is intentionally not part of this layer.

## Verification

`kernel/tests/test_devs.cpp` checks hierarchy paths, root routes, route target
identity, and repeat compilation stability. The complete Windows test gate
must remain green before any later execution backend is added.
