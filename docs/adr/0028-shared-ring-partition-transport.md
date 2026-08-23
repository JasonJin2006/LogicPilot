# ADR 0028: Bounded shared-memory partition ring

## Context

The serialized event frame now has a stable wire contract, but an IPC
transport also needs bounded backpressure and allocation-free handoff. An
unbounded queue would turn a partition skew into uncontrolled memory growth.

## Decision

Add `PartitionFrameRing<Capacity, FrameBytes>`, a fixed-capacity sequence-number
ring with atomic producer/consumer cursors. `RingPartitionTransport` encodes
events into the ring, reports full/empty conditions explicitly, and decodes
frames at the barrier. The ring is layout-stable enough to be placement-created
inside a shared-memory mapping; process-shared atomic semantics remain a
platform integration responsibility.

## Consequences

Transport pressure is observable and bounded, and the hot handoff path performs
no allocation after ring construction. The current implementation is still a
same-process adapter; OS mapping, peer liveness, retries, and recovery epochs
must be added before enabling cross-process execution.
