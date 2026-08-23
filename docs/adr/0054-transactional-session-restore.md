# ADR 0054: Transactional multi-method session restore

## Context

A session checkpoint contains shared state and several method bundles. Restoring
them independently can leave a mixed world if an earlier method accepts its
bundle and a later method rejects a corrupt or incompatible bundle. Stale
scheduler events make that partial state even harder to diagnose.

## Decision

`SimulationSession::restore_method_checkpoint` first captures the current
variable/message snapshots, clock, and every attached method's versioned
checkpoint. Methods apply their normal token cancellation while the target
world is restored, preserving deterministic event-sequence semantics. If shared
state or any method restore fails, it restores the saved
shared state and clock, and restores every method bundle. Failure is reported as
KR1016 and includes whether rollback succeeded.

The scheduler exposes a cold-path `clear()` operation for custom rollback
adapters; normal event processing remains unchanged. A method that cannot produce a
rollback checkpoint is rejected before the target world is mutated.

## Consequences

Checkpoint restore is all-or-nothing for built-in shared-event runtimes. A
failure cannot silently combine target state from one method with pre-restore
state from another. Custom schedulers should override `clear()` when they
participate in session rollback; the default interface implementation preserves
source compatibility for legacy schedulers.
