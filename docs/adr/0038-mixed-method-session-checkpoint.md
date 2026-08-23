# ADR 0038: Mixed-method session checkpoint coordination

## Context

SimulationSession shares one scheduler and clock across Process, Statechart,
DEVS, Agent, and System Dynamics methods. A method-local checkpoint is not
enough if another method still owns pending events on the shared queue.

## Decision

`SimulationSessionCheckpoint` captures one versioned `MethodCheckpoint` per
attached method and one shared `now`. Restore resets the shared clock first,
then restores method bundles in stable method order; each method rebuilds only
its own scheduler tokens. Composite Statechart networks now participate with
schema version 2.

## Consequences

Mixed Process + Statechart sessions can pause and replay with identical
per-method departures, final values, and global horizon. Method identity and
bundle count are validated before restore. Cross-method side effects must be
encoded in the method contract or shared stores, not inferred from event order.
