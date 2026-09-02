# ADR-0088: Cross-Surface Artifact Graph Migration

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 3 cross-surface migration slice

## Decision

The Artifact Graph is the durable transaction boundary for all currently
supported IDE mutation and execution surfaces:

- AI model patches and one-shot model proposals;
- source patches and SysML typed source edits;
- AI SysML layout changes;
- explicit user project saves as semantic-model snapshots; and
- simulation runs and SysML execution evidence, bound to the model revision
  known at execution time.

The browser may update its local projection immediately for responsiveness, but
configured app-server deployments must propose/validate/approve/commit through
the Node store. A failed commit never silently claims durability; mutation
surfaces either restore the exact version they changed or report a structured
sync gap without overwriting a concurrent edit.

## Consequences

The old in-memory editor history remains a local undo mechanism, not a second
durable source of truth. Layout and evidence sidecars remain portable project
projections and are recoverable from the graph after restart. Full direct
manual-canvas event streaming and multi-process locking remain follow-up work;
Save is the explicit durability boundary for those high-frequency local edits.
