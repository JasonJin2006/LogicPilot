# ADR 0048: Migration audit storage adapter

## Context

Migration audit records need to survive process shutdown and be available to
operations tooling, but the kernel should not depend on a logging backend.

## Decision

`FileMigrationAuditStore` wraps the atomic blob store and
`MigrationAuditCodec`, providing save/load of the ordered audit archive. The
same interface pattern can target a journal, object store, or remote audit
service later.

## Consequences

Migration provenance can be persisted independently from checkpoint contents.
Storage replacement and access policy remain deployment concerns.
