# ADR 0056: Durable DEVS evidence archive store

## Context

LPEV made causal evidence portable, but callers still had to implement file
installation and corruption handling themselves. That encourages inconsistent
durability behavior in incident tooling.

## Decision

`FileEvidenceArchiveStore` provides a small filesystem boundary around LPEV. It
writes a temporary archive, stages the previous file as a backup, installs the
new file, and restores the backup if installation fails. Loads enforce the
archive byte limit, decode the checksum-protected LPEV payload, and restore
recorder sequence/cardinality invariants.

The store is intentionally local-file only; object storage, encryption, and
OS-specific fsync remain separate storage/transform seams.

## Consequences

Evidence capture can be handed directly to an offline postmortem workflow with
atomic replacement semantics. A corrupt archive never replaces the in-memory
trace, and a failed write leaves the previous archive recoverable.
