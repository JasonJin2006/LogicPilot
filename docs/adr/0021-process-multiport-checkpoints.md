# ADR 0021: Multi-port process checkpoint bundles

## Context

`Combine` and `Match` keep waiting entities in two private input queues rather
than in the generic `BufferedBlock::input_` queue. A generic block snapshot
therefore cannot restore a partially synchronized topology: entities would be
lost or paired in a different order after resume. `Match` also has a pending
new-arrival marker that drives conditioned pair evaluation.

## Decision

Both blocks expose deterministic, versioned bundles. The bundle wraps the
existing buffered counters/outputs and adds the ordered `in1` and `in2`
entities. `Match` additionally stores its pending entity id and input port.
The process engine admits these block kinds only when their explicit codec is
available.

## Consequences

Partially synchronized flows can be checkpointed before the second input
arrives and resumed with identical pairing and output timing. The entity codec
continues to preserve nested contents, attributes, resources, and measurement
stamps. Future multi-port blocks must follow the same explicit-state contract
instead of relying on the base buffer.
