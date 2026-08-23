# ADR 0023: Assembler checkpoint bundle

## Context

Assembler combines a main stream with a part stream and may hold a resource
while an assembled entity is in service. Its state is split across two input
queues, an in-service queue, entity resource maps, and engine departure events.
A generic buffered snapshot cannot reconstruct that state.

## Decision

Assembler uses a versioned `LPAS` bundle containing the buffered counters and
outputs plus ordered main, parts, and in-service entity queues. The process
engine admits assembler blocks and reuses the existing engine-level departure
and resource-pool event snapshots.

## Consequences

Checkpoints can be taken while an assembler waits for parts or while it holds
resource units. Restoring preserves pairing, service completion time, and
resource availability. Pool failure combinations remain governed by the
engine's existing event metadata checks.
