# ADR 0034: Checkpoint journal compaction

## Context

Append-only recovery journals grow indefinitely and may retain a corrupt tail
after a crash. Long-running simulations need bounded storage without losing the
latest valid recovery state.

## Decision

`DevsCheckpointJournal::compact_latest()` scans the newest valid archive,
writes a one-record temporary journal, stages the old file as a backup, then
installs the compacted file. Rename failures attempt to restore the backup.
Writers must be coordinated around this offline maintenance operation.

## Consequences

Journal size becomes proportional to one checkpoint after compaction, while a
failed replacement has a recovery path. Filesystem-specific atomicity and
durable fsync guarantees remain deployment responsibilities.
