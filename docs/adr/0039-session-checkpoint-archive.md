# ADR 0039: Mixed-method session checkpoint archive

## Context

`SimulationSessionCheckpoint` coordinated in-memory method bundles, but a
mixed-method session could not be persisted or transferred as one validated
artifact.

## Decision

Add a versioned `LPMC` archive codec containing the shared session time and an
ordered list of method identity, schema version, method time, and state blob.
`SimulationSession` exposes bytes save/restore adapters that validate the
archive before touching method runtimes.

## Consequences

Process + Statechart (and future Agent/SD/DEVS combinations) can cross a
storage or transport boundary as one checkpoint. Corruption and method-count /
identity mismatches fail before state mutation; transform and blob-store
layers can wrap the archive uniformly.
