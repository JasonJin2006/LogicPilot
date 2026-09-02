# ADR-0105: Serialized Background Artifact Sync

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 3 background layout/run/evidence hardening

## Decision

Background Artifact Graph writes for layout snapshots, simulation runs and
execution evidence pass through one FIFO `ArtifactSyncQueue`. Each task still
executes the normal `propose → validate → approve → commit` lifecycle and a
failed task does not poison later tasks. Foreground model/source edits retain
direct transactions so optimistic conflicts remain visible to the user.

## Consequences

Rapid layout drags or repeated runs cannot race their own artifact heads. The
queue is in-memory and flushable; a future durable outbox can replace it
without changing the transaction contract or payloads.
