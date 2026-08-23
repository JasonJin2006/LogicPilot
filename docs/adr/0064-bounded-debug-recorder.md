# ADR 0064: Bounded DebugRecorder capture

## Context

`DebugRecorder` exposes the ordered scheduler stream for debugger and profile
work. Its historical unbounded vector was convenient for short tests but could
turn a long production run into an avoidable memory sink when debugging was
enabled.

## Decision

`DebugRecorder` accepts an optional maximum event count. The default zero keeps
the existing unbounded behavior for source compatibility. A positive limit
retains the deterministic prefix, sets `truncated()`, and continues allowing
the simulation/profile to complete. `set_max_events()` resets the captured
prefix and truncation state.

## Consequences

- Debug capture can be safely enabled for long runs with an explicit memory
  budget.
- `SimulationProfile.events_dispatched` still reports the full execution;
  `DebugRecorder.event_count()` reports only retained records.
- Truncation is explicit and machine-readable rather than silently losing
  debugger evidence.
