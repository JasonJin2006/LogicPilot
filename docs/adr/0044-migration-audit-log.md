# ADR 0044: Checkpoint migration audit log

## Context

Cross-model checkpoint migration is deliberately caller-controlled. Production
operations need evidence of which source/target fingerprints were attempted and
whether the semantic migration succeeded.

## Decision

`SessionCheckpointMigrationRegistry` records an in-memory audit entry for every
migration attempt: source fingerprint, target fingerprint, success, and error
message. Callers can clear and inspect the ordered audit log; the registry does
not perform I/O or hide failures.

## Consequences

Migration decisions can be attached to an external durable audit sink by the
caller. The kernel provides provenance without choosing a logging backend or
leaking checkpoint contents.
