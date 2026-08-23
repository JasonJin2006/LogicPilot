# ADR 0037: Composite Statechart network checkpoint

## Context

Standalone statecharts already had versioned state bundles, but a root with
multiple coupled charts was explicitly unsupported. Its runtime state spans
every child machine, child timers, chart identities, and the message-routing
topology.

## Decision

`StatechartNetworkReplicationModel` now emits an `LPSN` bundle containing the
replication configuration, stable chart names, and each child chart's existing
checkpoint blob. `StatechartRuntime` exposes it as method checkpoint schema
version 2 and restores all children against the shared scheduler.

## Consequences

Coupled statechart methods can be paused and replayed without losing timer or
message-transition state. Chart names are validated during restore, and the
network routing graph remains immutable model configuration. Cross-process
transport of the method bundle uses the general checkpoint archive pipeline.
