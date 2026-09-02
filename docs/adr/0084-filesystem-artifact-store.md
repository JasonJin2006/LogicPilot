# ADR-0084: Persistent Artifact Graph Store

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 3 Artifact Graph persistence

## Decision

`@logicpilot/artifact-store` provides a Node-only `FileSystemArtifactStore`
over the frozen `Artifact`, `Revision` and `Transaction` contracts. It stores a
complete validated graph in `artifact-graph.json`, supports an atomic snapshot,
rollback and optimistic `compareAndSwap` against an artifact head.

The browser keeps using the editor's in-memory `RevisionStore`; Node/app-server
workflows inject the filesystem adapter. The adapter never accepts an
unvalidated entity and never overwrites a newer head when an AI proposal was
based on an old revision.

## Consequences

Artifact revisions now survive process restarts and can be backed up before
large AI or plugin transactions. A future SQLite/remote adapter can implement
the same state and CAS interface without changing operation schemas or the
assistant protocol.
