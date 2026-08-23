# ADR 0047: Message envelope semantic migration plan

## Context

Message IDs are stable within a session, but message type URIs and schema
payloads evolve independently. Restoring an old envelope without an explicit
conversion can make downstream methods interpret bytes incorrectly.

## Decision

Add `MessageSnapshotMigrationPlan` with explicit type URI renames and per-type
envelope converters. The plan preserves ordering and rejects conversion
failures or empty target types before a target message arena is committed.

## Consequences

Cross-method message migrations can be composed with session model migration
callbacks. Payload semantics remain owned by the application/domain adapter;
the kernel performs no implicit byte or schema coercion.
