# ADR 0035: Checkpoint transform and blob-store boundaries

## Context

Checkpoint archives need optional compression or authenticated encryption in
production, but the kernel must not ship an ad-hoc cryptographic algorithm or
couple simulation state to one storage vendor.

## Decision

Add `IDevsCheckpointTransform` and a checksummed `LPAE` envelope carrying the
transform name and payload. `IdentityCheckpointTransform` is the reference
implementation. Add `IDevsCheckpointBlobStore` with an atomic
`FileCheckpointBlobStore` implementation for latest-archive storage.

## Consequences

Trusted compression/encryption implementations can plug in without changing
DEVS state or journal semantics. The envelope detects transform mismatch and
corruption; the file adapter replaces the latest blob through a temporary file
and backup. No home-grown encryption is claimed, and deployment-specific key
management remains outside the kernel.
