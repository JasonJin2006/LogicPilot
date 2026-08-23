# ADR 0063: Cross-method logical-step trace channel

## Context

`TraceRecorder` originally counted scheduler events. Agent ticks and accepted
Continuous integration steps are deterministic execution units too, but they
are not scheduler events, so their traces previously collapsed to final metric
bits and could not explain a same-seed divergence.

## Decision

Add an orthogonal `record_logical_step` channel to `TraceRecorder`. It folds a
domain separator, exact simulation time, method-specific logical-step type,
and step ordinal into the deterministic hash while maintaining the legacy
`event_count()` for scheduler events. `logical_step_count()` exposes the new
count.

Agent records one marker per accepted tick; Continuous records one marker per
accepted fixed or adaptive RK4 step. Trial retries, rejected adaptive steps,
and failed numerical attempts are intentionally not recorded as accepted
steps. Callers may opt into a bounded readable record list; the hash remains
complete when the list truncates. `LogicalTraceComparator` reports the first
time/type/payload divergence.

## Consequences

- Same-seed Agent/Continuous runs can compare both hash and logical-step count.
- Existing scheduler event-count consumers remain compatible.
- Debuggers can retain a bounded prefix without allowing long simulations to
  turn trace capture into an unbounded memory sink.
- The bounded records have a portable `LPLT` archive codec with version,
  maximum byte/record limits, and checksum validation, so CI and offline tools
  can exchange evidence without loading the simulation process.
- `FileLogicalTraceArchiveStore` installs LPLT archives through a temp file,
  backup, and replacement sequence, restoring the previous file on install
  failure.
- Checkpoint replay can compare the logical continuation once a caller supplies
  a trace recorder for the resumed segment.
- The channel is deliberately compact; full causal explanations remain the
  responsibility of DEVS evidence and `DebugRecorder`.
