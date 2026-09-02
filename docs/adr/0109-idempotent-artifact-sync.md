# ADR-0109: Idempotent Artifact Sync Transactions

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 3 background artifact durability (idempotency slice)

## Decision

Background artifact writes derive a stable SHA-256 identity from
`artifactId + operationType + payload`. The operation id and proposal
`idempotencyKey` are derived from that identity rather than random process
state. The browser outbox may replay a proposal after a crash without creating
a second logical transaction.

`FileSystemArtifactStore.propose` returns the original transaction when the
same idempotency key and canonical payload are presented again; reusing a key
with a different payload fails closed. `validate`, `approve` and `commit` are
safe to repeat for an already completed transaction, and an idempotent commit
returns the original revision after verifying artifact and digest identity.

## Consequences

An outbox item that survives a process crash can be drained safely even if the
previous process completed the server commit immediately before dying. This
does not yet provide cross-process locking or a server-side durable outbox;
those remain separate operational concerns.
