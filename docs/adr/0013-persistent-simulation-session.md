# ADR-0013: Persistent Shared-Event-Queue Simulation Sessions

- **Status**: Accepted; initial session implementation landed
- **Date**: 2026-08-22

## Context

The one-shot `SimulationKernel::run()` API is convenient for batch
replications, but it cannot represent pause, step, inspection, or a future
checkpoint while preserving one shared world. Reinitializing method runtimes
between slices would change scheduler state and invalidate causal evidence.

## Decision

Add `SimulationSession`, created from a verified `SimulationKernel` model. It
owns one replication's clock, scheduler, handler registry, variable store and
`RuntimeManager`, and exposes:

```text
start(config)
advance(until)  // repeatable
finish()        // drain + shutdown + metrics
```

Sessions require every attached method to declare `kSharedEventQueue`. The
legacy six-argument `SimulationKernel::run()` remains available and a new
evidence-aware overload is additive.

## Consequences

- Pause/step and WebSocket control layers can observe one persistent world.
- Evidence and profiler state span multiple `advance()` calls.
- The first checkpoint slice is available for a single checkpointable DEVS
  runtime. Multi-method checkpoint bundles remain explicitly rejected until
  every method supplies a versioned state contract.
- Batch-only runtimes remain explicitly rejected for multi-method sessions.
