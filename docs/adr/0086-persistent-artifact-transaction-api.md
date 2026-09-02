# ADR-0086: Persistent Artifact Transaction API

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 3 Artifact Graph transaction boundary

## Context

ADR-0078 introduced the in-memory `RevisionStore` and ADR-0084 added a
validated filesystem graph. The app-server initially exposed only a read-only
graph view, leaving AI proposals and editor commits on separate state paths.
That would allow a stale proposal to bypass approval and revision-head checks.

## Decision

`FileSystemArtifactStore` now owns the same lifecycle as the reference
`RevisionStore`:

```text
propose -> validate -> approve -> commit
```

Every transition rewrites one validated graph state atomically. `commit`
requires the transaction's expected artifact head and rejects stale writers,
duplicate revisions, missing artifacts and unapproved transactions. Operation
validation is injected by the host so the store remains independent of any
particular paradigm.

The Node app-server exposes this boundary through `POST /api/artifact-graph`
with an explicit `action` (`create-artifact`, `propose`, `validate`, `approve`,
or `commit`). Responses contain only the resulting validated entity and stable
error status; filesystem exception text and paths are not returned.

## Consequences

AI, editor and plugin workflows have one persistence and concurrency boundary.
The browser can recover the graph after restart and can present conflict or
validation errors without knowing filesystem details. A future database or
remote adapter can implement the same store lifecycle without changing the
frozen Artifact/Revision/Transaction contracts.

Cross-process locking and multi-artifact atomic conflict resolution remain
follow-up hardening items; the current app-server serializes requests in one
Node process and uses atomic state replacement plus optimistic head checks.
