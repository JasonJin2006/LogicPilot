# ADR-0076: Capability Broker and Generation-Bound RPC Sessions

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 2B-3D-1

## Decision

`CapabilityBroker` is the single authorization gate for isolated plugin
runtimes. It accepts only the frozen `CapabilityRpcEnvelope` contract and
returns a `CapabilityRpcResponse`; transports (Worker MessagePort, child
process IPC and future browser bridges) are adapters, not policy owners.

Each runtime receives a short-lived `PluginRuntimeSession` bound to one plugin,
lockfile digest, trust level and registry generation. Every request must match
that session and generation, meet its absolute deadline, fit the payload and
in-flight quotas, and carry a granted PermissionId for the requested
capability. Unknown capabilities and stale sessions fail closed.

`runtime.wasm.build` remains a build-time permission. Runtime imports use the
fine-grained permissions in `permission-trust.schema.json`; existing old
lockfiles do not silently gain those grants.

## Quotas and audit

The broker enforces maximum in-flight requests per session, a bounded JSON
payload, deadline timeout and structured allow/deny/timeout/error audit events.
Handlers are transport-independent and cannot mutate session state.

## Consequences

WASM and ESM loaders may be replaced without changing authorization semantics.
Generation changes revoke old sessions by policy, so a retired registry cannot
continue using capabilities. Hard CPU pre-emption remains the responsibility
of the Worker/process supervisor; the broker only bounds the RPC surface.
