# ADR 0024: Queue/Wait checkpoint bundle

## Context

Queue and Wait blocks can own timeout events, preemption admission markers,
priority/comparison ordering, and alternate output queues. Saving only their
generic input buffer loses the timeout and victim-selection state needed for an
exact resume.

## Decision

`WaitBlock` uses a versioned `LPWQ` bundle containing the buffered state,
sorted timeout and admitted-waiter ids, alternate outputs, the most recent
arrival id, and timeout/preemption counters. The engine admits both `queue`
and `wait` kinds only through this explicit codec.

## Consequences

Timeout and preemption-enabled waiting stages can be resumed without duplicate
timeouts or changed victim selection. Stable ordering is preserved by the
serialized deque order and deterministic sorting of unordered id sets.
