# ADR 0041: Explicit method checkpoint schema evolution

## Context

Method bundles carry schema versions, but a session previously either passed a
version to a runtime or failed without a formal migration seam. Silent
reinterpretation would be unsafe; permanent rejection would block controlled
schema upgrades.

## Decision

`SimulationMethod` exposes `checkpoint_schema_version()` and an explicit
`migrate_method_checkpoint()` hook. Session restore compares each bundle to the
runtime's current schema and invokes migration only when the method provides
one; otherwise it fails before method state restore.

## Consequences

Schema evolution is opt-in, auditable, and method-local. Existing methods keep
strict version matching, while future runtimes can implement deterministic
migrations without weakening model fingerprint validation.
