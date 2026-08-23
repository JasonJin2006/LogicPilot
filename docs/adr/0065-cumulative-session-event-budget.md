# ADR 0065: Cumulative event budget across session slices

## Context

`SimulationSession::advance(until)` is intentionally incremental. A per-call
counter would let a caller reset the shared scheduler safety boundary simply
by advancing in many small slices, unlike the one-shot kernel and method
runtimes.

## Decision

The session keeps a cumulative dispatch counter for the active replication.
`ReplicationConfig.max_events` is checked against that counter on every
advance. The counter is included in `SimulationSessionCheckpoint` and its
portable codec, so restore cannot reset the budget. Legacy version-1 session
archives decode with a zero counter for compatibility.

## Consequences

- Pause/step/slice orchestration cannot bypass KR1017.
- Checkpoint replay resumes with the same remaining event budget.
- Profile/debug counts remain per-call or retained-prefix views; the session
  counter is the authoritative safety counter.
