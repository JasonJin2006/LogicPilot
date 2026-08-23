# ADR-0012: Explicit State Contracts for DEVS Checkpoints

- **Status**: Accepted; executor and IR Atomic implementation landed
- **Date**: 2026-08-22

## Context

Replayable simulation needs more than an event hash. A checkpoint must restore
model state and the scheduler boundary without relying on C++ object layout or
guessing how a third-party runtime stores state.

## Decision

`AtomicModel` exposes opt-in `checkpoint_save` and `checkpoint_restore` hooks.
The executor checkpoint stores:

- the compiled atom paths;
- simulation time and transition counters;
- the internal-transition budget;
- each atom's last-transition time and opaque state bytes.

Restoration validates the plan shape and paths, requires that all live
scheduler events are executor-owned, cancels the old internal events, restores
atom state, resets the clock/counters, and rebuilds one internal event per
atom from its restored `time_advance()`.

Models that do not implement the hooks fail checkpoint creation explicitly.
The initial concrete implementation serializes IR Atomic's bool/int/float
state in a sorted, versioned little-endian format.

## Consequences

- Checkpoint correctness has an explicit capability boundary and no undefined
  object-memory copying.
- A restored continuation can be compared by evidence hash and metrics.
- External scheduler events and arbitrary cross-runtime state are not silently
  included; those require later shared checkpoint contracts.
