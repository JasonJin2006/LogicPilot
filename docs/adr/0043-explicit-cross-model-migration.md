# ADR 0043: Explicit cross-model session migration

## Context

Model fingerprints correctly reject restoring a checkpoint into a different
model, but controlled migrations sometimes need to carry state across a
deliberate model revision.

## Decision

`SessionCheckpointMigrationRegistry` registers migrations keyed by source and
target model fingerprints. The default restore path remains strict; the new
overload invokes a caller-supplied policy, then revalidates the produced target
fingerprint, method identities, schemas, and shared state before commit.

## Consequences

Cross-model migration is explicit and auditable rather than an accidental
side-effect of weak validation. Migration callbacks own semantic mapping of
renamed/removed entities and must produce a complete target checkpoint; the
kernel never guesses how to map model state.
