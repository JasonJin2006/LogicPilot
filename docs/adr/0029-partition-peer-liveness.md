# ADR 0029: Partition peer liveness and recovery epochs

## Context

A shared ring can distinguish empty from full, but cannot by itself tell the
difference between a temporarily idle peer and a dead or restarted peer.
Reusing a ring after a restart also risks accepting stale frames from the
previous simulation.

## Decision

Add `PartitionPeerControl`, a pointer-free atomic control word containing the
current epoch, heartbeat timestamp, active/failed status, and sent/received
counters. `RingPartitionTransport` optionally binds to it and rejects sends or
receives when the epoch mismatches, the peer is explicitly failed, or the
heartbeat exceeds the configured simulation-time timeout.

## Consequences

Restarted peers require a new epoch, preventing stale event acceptance. Peer
failure and timeout become explicit transport errors instead of silent empty
queues. OS-level process liveness, wall-clock heartbeats, retry policy, and
checkpoint recovery remain integration responsibilities above this kernel
contract.
