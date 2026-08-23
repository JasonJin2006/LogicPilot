# ADR 0025: MoveTo spatial checkpoint bundle

## Context

MoveTo removes an entity from its input buffer, retains it in an in-service
queue, and schedules a departure at a sampled travel time. Speed mode may use
the immutable spatial graph's shortest-path distance. A generic buffered
snapshot would lose the in-flight traveler even though the engine still owns
its departure event.

## Decision

MoveTo uses a versioned `LPMV` bundle containing the buffered state and ordered
in-service entities. The engine's existing departure-event table restores the
remaining travel time. Spatial nodes and path distances are immutable model
configuration, so they remain attached to the same model instance rather than
being duplicated in every checkpoint.

## Consequences

Explicit trip-time and speed/path travel can resume exactly, including the
remaining event time and final coordinates. Checkpoints are intentionally
model-instance scoped; a future portable checkpoint format should add a
spatial-configuration fingerprint before restoring into a different model.
