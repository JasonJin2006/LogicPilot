# ADR 0062: Streaming gateway shares the scheduler event budget

## Context

The live gateway and method runtimes advance schedulers incrementally instead
of always calling `SimulationKernel`. Before this decision, the M/M/c
`SimRunner` and generic `ProcessFlowSim` could dispatch indefinitely, so a
zero-time event storm in a browser run could starve the worker even though the
batch/session runtimes already enforced `ReplicationConfig.max_events`
(KR1017). Statecharts also have immediate branch/history transitions and
condition polls that can generate work without an ordinary timed event.

## Decision

`StreamRunConfig.max_events` defaults to 50 million and counts every event
dispatched by one streaming replication, independent of telemetry slices or
wall-clock pacing. `0` rejects the first event. Immediate statechart transition
steps consume the same bound, preventing a zero-time branch cycle from
escaping the scheduler guard. The WebSocket `start` command
accepts `maxEvents`; the standalone gateway exposes the equivalent
`--max-events` option. The same cumulative budget is enforced by the
incremental `QueueingFlowSim`, `ProcessFlowSim`, and
`StatechartReplicationModel` loops. A statechart network deterministically
partitions the configured budget across its child charts so the aggregate
cannot exceed the requested limit. Agent runtimes interpret the same value as
an accepted tick cap; Continuous runtimes interpret it as an accepted RK4
step cap (adaptive trial retries remain an internal numerical guard).

When the limit is reached, the runtime stops before dispatching the next event,
retains deterministic state for diagnostics (including checkpoint round trips),
and the worker emits
`RunFinished.status = Failed` with the KR1017 reason. A client `stop` remains a
separate Cancelled status.

## Consequences

- Browser/gateway execution and the event-driven flow/statechart engines now
  have the same
  scheduler safety contract as the batch and session APIs.
- Event-budget failures are observable and machine-classifiable instead of
  looking like user cancellation.
- The budget is per replication; precision runs receive the same bound on every
  attempted replication. Checkpoint schema versions advance so the cumulative
  dispatch count and configured limit cannot be silently reset on restore.
- Tick and RK4-step exhaustion are reported as KR1017 rather than being
  confused with numerical integration errors or user cancellation.
