# ADR-0116: Server Durable Artifact Outbox

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 3 background artifact durability

## Decision

Background layout, evidence and run writes may use the app-server's
`enqueue-background` Artifact Graph action. The server first durably records a
bounded JSON outbox entry with a stable digest/idempotency key, then claims it
and executes the normal `propose → validate → approve → commit` lifecycle.
Completed entries retain their revision id for replay; failed entries retry up
to a configured limit and then enter dead-letter state.

The outbox recovers `processing` entries as `pending` on process start and uses
its own atomic file replacement and mutex. The browser queue remains as a
front-door buffer and safely replays the same key when a response is lost.

## Consequences

An app-server restart no longer loses an accepted background write. Semantic
model edits still use the explicit foreground transaction path and never enter
this implicit runtime-approved queue. A future worker process may drain the
same file without changing the client contract.
