# ADR 0032: Portable DEVS checkpoint archive

## Context

In-memory `DevsCheckpoint` objects are useful inside one process but cannot be
stored or sent through the partition transport. Recovery epoch and replay
watermarks also need to travel with atom state and scheduler continuation.

## Decision

Add `DevsCheckpointCodec` with a versioned little-endian `LPCD` archive:
recovery epoch, simulation counters, replay watermarks, atom paths, transition
times, state blobs, length limits, and FNV checksum. `DevsExecutor` exposes
`save_checkpoint_bytes` and `restore_checkpoint_bytes` adapters.

## Consequences

Checkpoints can cross process/storage boundaries with explicit corruption and
size checks. Recovery metadata is no longer lost during archive transfer.
Compression, encryption, durable journal transactions, and schema migration
remain higher-level concerns.
