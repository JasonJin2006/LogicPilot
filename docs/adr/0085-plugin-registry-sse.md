# ADR-0085: Live Plugin Registry SSE Stream

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 2C live registry update

## Decision

Expose `GET /api/plugin-registry/stream` as a local, session-protected SSE
transport. It sends a complete validated `PluginRegistry` snapshot initially
and after every committed Node runtime generation. The existing GET endpoint
and IDE polling client remain the reconnect/fallback path.

The bridge owns a client set and unsubscribes it on response close. Runtime
shutdown closes all clients and removes the generation subscription. Every
payload uses the same path-redaction and contribution validation rules as the
ordinary registry endpoint.

## Consequences

Installed plugin, lockfile, trust, grant and contribution changes can reach the
IDE immediately after a generation commit without exposing filesystem paths or
transport-specific policy. Deltas are intentionally deferred until the full
snapshot protocol has sufficient telemetry and replay tests.
