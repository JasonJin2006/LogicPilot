# ADR 0057: Shared scheduler event budget

## Context

Zero-time self-scheduling methods can create an infinite event cascade. A
next-event loop that waits for the queue to drain has no opportunity to return a
diagnostic from such a model, so a malformed plugin can hang a host process.

## Decision

`ReplicationConfig.max_events` defaults to 50 million and bounds one
`SimulationKernel::run` or `SimulationSession::advance` call. The shared
dispatcher counts every popped event; on exhaustion it stops dispatching,
returns KR1017, and lets the runtime manager shut down normally. A value of zero
means no events are permitted. The limit is a host/run policy, not a
method-specific arrival count.

## Consequences

Event storms become bounded, diagnosable failures instead of hangs. Callers can
raise the limit for large models or use session slices for interactive control.
Legacy batch-only engines retain their existing budgets and are not silently
changed by the shared-queue guard.
