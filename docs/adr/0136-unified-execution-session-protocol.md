# ADR-0136: Unified Execution Session Protocol

Date: 2026-09-05  
Status: Accepted for implementation  
Related plan: `docs/architecture/execution-session-gateway-plan.md`

## Context

LogicPilot currently has three execution entry points: the IDE WebSocket
gateway, the HTTP plugin execution endpoint, and AI/CLI batch execution. They
use related runtimes but do not share one lifecycle, run identity, or live
session contract. A plugin runtime capability session is also a different
concept from a simulation run and must not be reused for it.

The native `SimulationSession` already owns one replication world and a shared
event queue. It can start, advance, finish, and checkpoint a world, but its
`finish()` operation drains all pending events and therefore cannot represent
user cancellation.

## Decision

Introduce a versioned execution-session contract above runtime providers.

- A request has an idempotent `requestId`; a server-created `runId` identifies
  the lifetime of one experiment; each replication has its own
  `replicationId`.
- The run pins an artifact revision, target/provider digest, runtime generation,
  compiler/IR digest, effective parameters, and resolved seed before runtime
  side effects begin.
- The public lifecycle is `queued`, `preparing`, `running`, `paused`,
  `finalizing`, `completed`, `cancelling`, `cancelled`, or `failed`.
- Providers declare capabilities. A provider that does not support pause,
  event-step, or live telemetry must not expose those controls in the IDE.
- HTTP creates and controls a run. A same-origin WebSocket is an optional
  subscription transport for snapshots and telemetry; disconnecting a
  subscriber does not cancel the run.
- The existing `PluginRuntimeSession` remains a capability authorization
  record. The execution session gets separate identifiers and contracts.
- The old final-result `execute()` API may remain as a compatibility wrapper,
  but it must call the same `start`/session implementation and may not run a
  second execution algorithm.

## Consequences

The execution service can serve the canvas, AI tools, and batch orchestration
through one registry and one result/evidence path. WebSocket remains useful for
low-latency browser telemetry without making it the simulation engine or the
only internal transport. Runtime updates and uninstall operations can hold a
generation lease until active sessions reach a real terminal state.

The first migration adds contracts and adapters before removing the legacy
gateway. Until later migration stages pass their acceptance matrix, the old
gateway remains a supported compatibility path.

## Rejected alternatives

- Treating every plugin capability session as a simulation session would mix
  permissions, generation lifetime, run state, and artifact identity.
- Maintaining separate browser, desktop, worker, and batch execution engines
  would preserve result drift and make cancellation inconsistent.
- Removing WebSocket immediately would discard the current live telemetry path
  before an equivalent subscription transport exists.
