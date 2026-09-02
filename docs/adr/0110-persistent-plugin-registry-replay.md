# ADR-0110: Persistent Plugin Registry Replay History

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 2B registry live-update durability

## Decision

The Node bridge persists a bounded, validated `PluginRegistry` snapshot history
beside the PackageStore. The file is replaced atomically and is loaded when the
Node runtime starts. SSE clients can replay generations after reconnecting;
the in-memory list remains only the hot delivery cache.

Malformed history fails closed during runtime startup rather than emitting an
unvalidated registry. Persistence failures do not terminate an already-live
stream; they are logged and retried by the next generation snapshot.

## Consequences

Restarting the desktop app no longer erases the replay window. This slice does
not yet sign registry snapshots or publish them to an external registry; key
rotation and remote distribution remain separate security work.
