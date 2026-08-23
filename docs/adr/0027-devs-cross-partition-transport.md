# ADR 0027: Deterministic cross-partition event transport

## Context

The PDEVS barrier previously appended routed outputs directly into target
input bags. That was correct in-process but left no explicit seam for an IPC or
network transport and made event ordering an implementation detail of the
coordinator loop.

## Decision

Introduce `IDevsPartitionTransport` and `DevsPartitionEvent`, carrying
timestamp, source/target partitions and atoms, target port, payload, and a
coordinator sequence. `DeterministicPartitionTransport` is the current local
implementation: it buffers sends and returns a target partition's events in
`(time, sequence, source, target)` order at the barrier.

## Consequences

The current executor remains single-process and deterministic, while future
shared-memory, IPC, or network transports can replace the local implementation
without changing atom semantics. Remote delivery, serialization, failure
recovery, and optimistic rollback are intentionally not claimed yet.
