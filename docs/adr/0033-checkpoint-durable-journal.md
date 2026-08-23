# ADR 0033: Append-only checkpoint journal

## Context

The portable checkpoint archive can cross a process boundary, but writing a
single file in place is vulnerable to a crash between truncation and rewrite.
Recovery needs the last complete valid checkpoint, not merely the last file
bytes.

## Decision

Add `DevsCheckpointJournal`, an append-only `LPJR` record stream. Each record
stores an archive length and the checksummed `LPCD` payload. `load_latest()`
scans records in order, returns the newest valid one, and reports a truncated
or corrupt tail while retaining earlier records.

## Consequences

Checkpoint persistence is crash-tolerant at the record level and naturally
supports multiple recovery epochs. The current implementation flushes the
stream but leaves OS-specific fsync, compaction, encryption, and transactional
storage policy to the deployment layer.
