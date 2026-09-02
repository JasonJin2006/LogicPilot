# ADR-0115: Artifact Store Cross-Process Concurrency

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 3 Artifact durability hardening

## Decision

`FileSystemArtifactStore` protects atomic state replacement with a filesystem
mutex. A stale mutex may be reclaimed only after the configured timeout. Every
read-modify-write API captures the canonical state version it read; the write
rechecks that version while holding the mutex and returns a conflict when
another process changed the graph.

The public `version()` method exposes the same canonical token for callers
that need to coordinate a longer operation. Snapshot restore also uses the
current version, so it cannot overwrite a concurrent update silently.

## Consequences

Concurrent app-server processes no longer lose Artifact Graph updates through a
last-writer-wins race. Callers must handle `conflict` by re-reading and
re-proposing; the store never guesses how to merge semantic operations.
Server-side durable outbox/recovery remains a separate layer for scheduling
retries after process termination.
