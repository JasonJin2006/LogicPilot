# ADR 0030: Epoch-tagged partition replay recovery

## Context

Heartbeat and failed-state detection identify a dead peer, but a restarted
peer can leave old frames in a shared ring. Retrying a frame can also deliver
the same event twice unless delivery identity is explicit.

## Decision

Partition frames carry a recovery epoch. `PartitionReplayWindow` keeps a fixed
bounded set of `(epoch, source_partition, sequence)` identities and drops
duplicates or stale epochs. `RingPartitionTransport` can enable this window;
peer-bound transports also reject frame epochs that differ from the active
control epoch.

## Consequences

Reconnects require a new epoch and cannot consume stale frames from the prior
run. Retries within the bounded replay window are idempotent. The window is
intentionally finite; a higher-level checkpoint/replay protocol must coordinate
window rollover and durable recovery beyond its capacity.
