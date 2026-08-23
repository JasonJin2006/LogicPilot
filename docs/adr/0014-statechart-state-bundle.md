# ADR-0014: Versioned Statechart Checkpoint Bundle

- **Status**: Accepted; standalone statechart bundle implemented
- **Date**: 2026-08-22

## Decision

`StatechartReplicationModel` provides an explicit versioned checkpoint blob
containing:

- current and last-visited state ids;
- transition and condition-poll counters;
- terminal flag;
- full xoshiro256++ RNG state.

On restore it cancels all current timer/condition events, restores the state
and RNG, and reschedules triggers against the attached scheduler. The caller
must restore the shared simulation clock to the checkpoint timestamp before
continuing.

## Boundary

This first bundle covers one statechart instance. Statechart networks and
cross-method message queues need a higher-level method bundle before they can
participate in `SimulationSession` multi-method checkpointing.

`StatechartRuntime` now wraps this blob in the generic `MethodCheckpoint`
contract, so a single Statechart `SimulationSession` can save and restore it.
Network runtimes still return an explicit unsupported diagnostic.
