# ADR 0020: Seize waiter checkpoint contract

## Context

`Seize` has two kinds of state that are not visible in the generic buffered
block: entity timeout ownership and the set of waiters already admitted to the
embedded preemption queue. Replaying a checkpoint without those sets can fire a
timeout twice or classify an existing waiter as a newcomer, changing the
victim selected by priority preemption.

## Decision

The Seize block uses a versioned `LPSZ` bundle. It stores the buffered base
state, sorted timeout entity ids, sorted admitted-waiter ids, and pending
alternate-port outputs. The process engine stores the corresponding timeout
events and rebuilds them during restore. Seize resource ownership remains on
the entity's resource map and is therefore already covered by the entity codec.

## Consequences

Seize flows with timeout and/or waiting-queue preemption now support exact
mid-run restore. The bundle is deterministic across unordered-container
iteration. Future changes to held-resource preemption must extend the bundle
version rather than silently reusing this contract.
