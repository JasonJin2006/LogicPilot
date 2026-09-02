# ADR-0078: Unified Artifact Revision and Transaction Store

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 3 Artifact Graph first slice

## Decision

The editor package exposes `RevisionStore`, an in-memory reference
implementation over the frozen `Artifact`, `Revision` and `Transaction`
contracts. All model, source, SysML, layout and AI edits use the same protocol:

```text
propose → validate → approve → commit
```

Commit is optimistic: the artifact head named by the proposal must still be
the current head. A stale head rejects the commit instead of overwriting a
newer revision. Operation semantics remain typed by `opType`; the store does
not embed paradigm-specific logic.

## Consequences

The maps are intentionally replaceable by a persistent Artifact Graph adapter.
The same revision id can later bind view layouts, knowledge packs, execution
targets, diagnostics and evidence. Validation and approval remain explicit, so
AI proposals cannot mutate project state without the caller's approval.
