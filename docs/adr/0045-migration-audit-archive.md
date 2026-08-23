# ADR 0045: Migration audit archive

## Context

The migration registry records decisions in memory, but production recovery
needs to preserve provenance across process restarts and attach it to an
external audit sink.

## Decision

Add a versioned `LPMT` audit codec carrying source/target fingerprints,
success flags, and error messages with a checksum. The codec is independent of
checkpoint contents and can be written through any existing blob store or
journal adapter.

## Consequences

Migration attempts can be persisted and reviewed without exposing state blobs.
The kernel still leaves retention, privacy, access control, and remote audit
transport to deployment policy.
