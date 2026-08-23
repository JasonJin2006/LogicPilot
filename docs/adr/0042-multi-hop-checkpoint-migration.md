# ADR 0042: Multi-hop method checkpoint migration

## Context

Checkpoint schemas evolve over multiple releases. Requiring every runtime to
implement every historical version pair creates brittle migration code and
encourages unsafe ad-hoc decoding.

## Decision

`MethodCheckpointMigrationRegistry` stores explicit directed migrations and
searches a bounded schema graph for a deterministic multi-hop path. Each step
must return the same method identity and the declared target schema; failed or
missing paths reject the restore.

## Consequences

Methods can maintain incremental migrations (v3→v2→v1) while the session keeps
strict model fingerprint validation. Migration callbacks remain responsible
for semantic compatibility and must not perform I/O or mutate live runtime
state.
