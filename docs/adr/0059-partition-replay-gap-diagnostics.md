# ADR 0059: Partition replay gap diagnostics

## Context

The partition replay window removed duplicate frames but treated a sequence
jump as an ordinary accepted event. A lost frame therefore looked like a valid
run until a later checkpoint or metric mismatch exposed it.

## Decision

`PartitionReplayWindow::observe` tracks the highest sequence per epoch/source
and reports an `Observation` containing accepted/duplicate/gap state and the
expected/observed sequence numbers. `RingPartitionTransport` still delivers a
new frame so callers can decide whether to request replay, but marks the
transport unhealthy with a stable sequence-gap diagnostic. When a
`PartitionPeerControl` is attached, it also publishes a fixed-width
`PartitionReplayRequest` containing the epoch, source/target partitions, and
missing sequence range.

## Consequences

Recovery coordinators can trigger checkpoint/event replay as soon as a gap is
seen, while duplicate suppression and deterministic ordering remain unchanged.
Out-of-order frames are not silently promoted to a healthy stream; the
transport's health flag makes the missing-range condition explicit.
