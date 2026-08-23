# ADR 0046: Variable snapshot semantic migration plan

## Context

Cross-model migrations commonly rename shared variables or change a value type.
Hand-written callbacks can silently drop declarations or create duplicate names.

## Decision

Add `VariableSnapshotMigrationPlan` with explicit rename and typed converter
operations. Applying a plan preserves declaration metadata, rejects name
collisions, and reports converter failures before the target snapshot is
committed.

## Consequences

Session migration callbacks can reuse a deterministic, testable semantic
adapter for shared variables. Complex domain transformations remain explicit
callbacks; no implicit name or type coercion is introduced.
