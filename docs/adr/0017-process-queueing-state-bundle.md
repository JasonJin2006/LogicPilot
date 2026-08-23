# ADR-0017: QueueingFlowSim Process Checkpoint Bundle

- **Status**: Accepted; fast-path implementation landed
- **Date**: 2026-08-22

## Decision

The Process runtime's M/M/1/M/M/c fast path may checkpoint a complete queueing
world. The versioned blob includes:

- replication config and full xoshiro256++ state;
- arrival/service arrays, FIFO queue, server states and customers;
- emitted/in-system/queue/departure counters and dropped entities;
- time-integral and sojourn accumulators;
- pending arrival and per-server depart/fail/repair event time/type/payload.

Restore cancels the engine-owned tokens, restores all state, and schedules the
exact pending events with their saved timestamps. Generic `ProcessFlowSim`
continues to reject checkpointing until entity, resource, timeout and
preemption state receives the same coverage.
