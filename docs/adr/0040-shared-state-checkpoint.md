# ADR 0040: Shared Variable/Message checkpoint state

## Context

Mixed methods communicate through the session-owned `VariableStore` and
`MessageStore`. Saving only private method bundles leaves shared inventory,
message envelopes, and message IDs inconsistent after restore.

## Decision

`SimulationSessionCheckpoint` snapshots shared variables (declarations,
permissions, typed values) and the ordered message arena. `LPMC` serializes
both stores with explicit variant tags, bounded lists, and blob lengths.
Restore rebuilds shared stores before method state and preserves message IDs.

## Consequences

Cross-method state now participates in deterministic pause/replay. Invalid
duplicate variable names, malformed variant tags, oversized lists, or corrupt
archives are rejected. Shared state migration remains tied to model
fingerprints and future schema migration hooks.
