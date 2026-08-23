# ADR 0031: DEVS checkpoint recovery epoch validation

## Context

Transport epochs prevent stale network frames, but a simulation checkpoint
could still be restored into a restarted executor unless the session and
checkpoint share an explicit recovery identity.

## Decision

`DevsCheckpoint` records the executor recovery epoch. `DevsExecutor` assigns a
stable epoch when loading a run, exposes it to the session/partition
coordinator, and rejects checkpoints from a different nonzero epoch. A caller
can set the epoch before loading or restoring after an externally coordinated
recovery; zero remains a backward-compatible legacy marker.

## Consequences

Checkpoint restore is now protected against accidental cross-run state reuse.
The transport epoch and checkpoint epoch can be coordinated by a higher-level
session. Durable replay watermarks and distributed checkpoint storage remain
outside the DEVS atom state bundle for now.
