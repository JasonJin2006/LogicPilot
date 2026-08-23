# ADR-0018: Basic ProcessFlowSim Bundle Before Full PML Coverage

- **Status**: Accepted; Source/Queue/Sink slice implemented
- **Date**: 2026-08-22

## Decision

The generic Process runtime first supports checkpointing only when every block
is a basic `source`, `queue`, or `sink` and no resource/spatial/pool state is
present. `BufferedBlock` serializes deterministic entity records, input and
outgoing deques, counters, and area integrals. The Engine additionally stores
the RNG, global counters, worklist, source arrival counters, and pending source
arrival timestamps.

Restore cancels the engine-owned source events, restores block/engine state,
resets the clock to the checkpoint timestamp, and schedules the exact source
events again.

Delay, Service, Wait, Seize, Batch, routing, failure, timeout and spatial
blocks remain unsupported until their private state and event maps have their
own snapshot contracts.
