# ADR-0105: Serialized Background Artifact Sync

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 3 background layout/run/evidence hardening

## Decision

Background Artifact Graph writes for layout snapshots, simulation runs and
execution evidence pass through one FIFO `ArtifactSyncQueue`. Inputs are kept
in a bounded browser outbox before dispatch. Each task still executes the
normal `propose → validate → approve → commit` lifecycle; successful tasks are
removed, while unavailable-server failures remain for a later `drain()`.
Each failure increments a persisted attempt counter; after the bounded retry
limit the item moves to an explicit dead-letter set and can only be requeued by
`retryDeadLetters()`.
Foreground model/source edits retain direct transactions so optimistic
conflicts remain visible to the user.

## Consequences

Rapid layout drags or repeated runs cannot race their own artifact heads. The
current outbox uses browser storage and is flushable; a future server-side
durable outbox can replace it without changing the transaction contract or
payloads.
