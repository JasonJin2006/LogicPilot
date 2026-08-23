# ADR 0022: Routing and split checkpoint bundles

## Context

Routing blocks usually have configuration-only decisions, but `split` can
create a fresh clone whose output is temporarily rejected by downstream
backpressure. That clone lives in a private port-aware retry queue and is not
part of the generic buffered input/output state.

## Decision

`GenericBlock` uses a versioned `LPGN` bundle containing the normal buffered
state plus every pending clone and its `outCopy` port. The engine now admits
split and the configuration-only SelectOutput variants (`selectOutput`,
`selectOutput5`, `selectOutputIn/Out`, `count`, `hold`, and time-measure
blocks) because their runtime state is fully covered by the base entity codec or
the explicit clone queue.

## Consequences

Routed flows can resume while an output branch is back-pressured without
duplicating or losing clones. Unsupported blocks with private event state (for
example spatial movement or assembler internals) remain rejected until they
receive an equivalent explicit bundle.
