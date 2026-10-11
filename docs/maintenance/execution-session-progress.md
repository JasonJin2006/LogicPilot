# Execution session and gateway migration progress

Plan: [统一执行会话与 Gateway 收口实施计划](../architecture/execution-session-gateway-plan.md)

This file records implementation evidence for the plan. A planned item is not
complete until a command, test, or rendered runtime behavior proves it.

## Current baseline

- Date: 2026-09-05
- HEAD at first audit: `debbac2`
- Worktree: already contained broad uncommitted runtime, plugin, contract,
  IDE, desktop, and documentation changes. No pre-existing changes were
  reset, staged, or overwritten.
- G0 status: `DONE`
- G1 status: `IN_PROGRESS`
- G2-G9 status: `TODO`

## G0 evidence

Inspected entry points:

- Canvas run: `RunDialog` → `connectionStore` → `SimClient` → `lp-server` WebSocket.
- AI run: `handleAiRun` → `runModelDsl` → supervised `lpcli` execution.
- Plugin execution: `/api/execution` → `ExecutionTargetRegistry` → Node runtime
  provider; the current endpoint waits for a final result.
- Native kernel: `SimulationKernel` owns the shared scheduler and
  `SimulationSession` supports incremental `start`/`advance`/`finish` and
  checkpoints. `finish()` drains the scheduler, so it is not a cancellation
  primitive.
- Desktop startup: `app/server.mjs` starts an `lp-server` child and injects a
  token-bound WebSocket URL through `/api/config`/Tauri `app_config`.

Confirmed migration risks:

1. The live gateway rejects mixed-method models; batch `SimulationKernel` is a
   separate path.
2. The registry has final-result `execute()` but no public live session handle.
3. `PluginRuntimeSession` is a generation-bound capability credential, not a
   simulation run session.
4. Node runtime execution is currently opt-in through
   `LOGICPILOT_ENABLE_NODE_PLUGINS=1` and store/lockfile configuration.
5. Existing evidence contracts do not yet represent Statechart or a complete
   multi-method evidence set.

Commands run for this audit:

- `pnpm docs:build` — PASS (2026-09-05).
- `pnpm exec prettier --check docs/architecture/execution-session-gateway-plan.md docs/README.md` — PASS.

G0 completion note: all three execution entry points, the native session, the
desktop gateway startup and the current plugin runtime boundary have an owner
and migration destination in the plan. The remaining runtime gaps are now
recorded as implementation work rather than assumptions.

These commands validate documentation only; they do not prove runtime
migration completion.

## Decision record

The target protocol and migration invariants are recorded in
[ADR-0136](../adr/0136-unified-execution-session-protocol.md).

## G1 evidence

- Added `schemas/contracts/execution-session.schema.json` and its frozen
  baseline with session state, provider capabilities, commands, acknowledgements
  and sequenced events.
- Added optional provider capabilities to `ExecutionTarget`; generated TS and
  C++ contract consumers with `node scripts/gen-contracts.mjs`.
- Added strict contract tests for valid session envelopes and invalid command
  actions/state guards.
- `node scripts/check-contract-conform.mjs` — PASS (18 schemas / 124 definitions).
- `pnpm --filter @logicpilot/contracts run test` — PASS (19 tests).
- `pnpm typecheck` — PASS (all workspace TypeScript projects).
- `./scripts/windows-build.ps1 -Preset windows-msvc-dev -Configure -Test` — PASS
  (504/504 native tests; generated C++ contracts compiled and linked).
- `pnpm --filter @logicpilot/plugin-host run build` — PASS.
- `pnpm --filter @logicpilot/plugin-host run test` — PASS (94 tests), including
  the lifecycle handle and generation-drain test.
- Added the first `ExecutionService` orchestration layer on top of the same
  registry: server run id assignment, request idempotency, active-run quota,
  command state-version checks, and capability-gated controls.
- `ExecutionService` tests cover identical retry, payload conflict and an
  unsupported pause command; the legacy `execute()` path delegates through the
  same registry session adapter.
- `/api/execution` now accepts `action: "start"` and `action: "command"` when
  the Node runtime is enabled, and `GET /api/execution?runId=...` returns a
  session snapshot plus bounded `events`, `nextSeq` and `gap` cursor fields.
  `start` returns HTTP 202 with a session and archives the eventual result in
  the background; `execute` remains the compatibility wait-for-result action.
- Runtime target manifests declare provider capabilities, and runtime result
  IDs honor the service-assigned `request.runId` when present.
- `node scripts/test-execution-boundary.mjs` — PASS, including the real HTTP
  start/query/cursor path and legacy execute path.
- `node scripts/test-node-runtime-e2e.mjs` — PASS after the shared run-id path;
  it now exercises both legacy registry execution and ExecutionService start/
  wait, and asserts the completed session is present in the filesystem store.
- `pnpm --filter @logicpilot/plugin-catalog run test` — PASS (66 tests).
- Added `FileSystemExecutionRunStore`: atomic, lock-protected session snapshots
  with contract validation and restart recovery of non-terminal sessions as
  explicit failed/interrupted records. It is injected through
  `LOGICPILOT_EXECUTION_RUN_STORE_ROOT` so development can opt in without
  silently changing existing app data directories.
- `FileSystemExecutionRunStore` tests — PASS (2 tests); plugin-catalog total
  is now 68 tests after the store slice.
- `pnpm test:app-server` — PASS after mounting the shared execution service
  and query/start endpoint paths.
- ExecutionService now retains a bounded in-memory event window with monotonic
  `seq`; the execution query returns `events`, `nextSeq`, and `gap` for cursor
  recovery. Terminal state events are emitted after result validation.
- `node scripts/test-execution-boundary.mjs` — PASS with state/terminal cursor
  assertions.
- Added same-origin `/api/execution/events` WebSocket subscription. The server
  performs session-token/origin/host validation, sends a snapshot plus cursor
  window, then streams future state/terminal events; commands remain HTTP.
- `pnpm desktop:test-staged` — PASS with a real raw WebSocket handshake and
  snapshot containing `state` and `terminal` events (79 staged files).
- `pnpm desktop:stage` / `pnpm desktop:test-staged` — PASS after the staged
  app-server derives `plugin-store/execution-runs` when Node plugins are
  enabled; the staged test now exercises HTTP start/query and verifies the
  completed session snapshot on disk (78 staged files).
- `./scripts/windows-build.ps1 -Preset windows-msvc-dev -Configure -Test` — PASS
  again after the optional request `runId` contract change (504/504; 196.60s).
- Added native `SimulationSession::advance_events()` and `abort()`: event-step
  dispatches at most the requested number of scheduler events, while abort
  shuts down the active world without calling `finish()` or draining pending
  work.
- `./scripts/windows-build.ps1 -Preset windows-msvc-dev -Configure -Test` — PASS
  after the session control change (505/505; 178.84s), including the new
  event-step/abort regression test.
- `pnpm test` — PASS; workspace contracts/protocol/artifact/plugin/editor,
  plugin-catalog (68 tests), and IDE (391 passed / 1 skipped) all green. This
  was run immediately before the final persisted-recovery test was added;
  the plugin-host package was re-run afterward with 94/94 green.
- The trusted single-method and generic runtime target manifests now declare honest initial
  capabilities: snapshot is supported; cancel and live telemetry remain
  unsupported until their providers implement them.

G1 remains `IN_PROGRESS`: a provider may now expose a real session handle, but
the native/ESM providers still use the compatibility adapter and do not yet
implement live control or telemetry subscriptions. G2 is `IN_PROGRESS`: the
in-memory orchestration and HTTP start/command/query plus WebSocket event
subscription now exist, and the durable store is used by staged desktop.
Canvas migration, provider live controls, and broader desktop data-directory
policy remain.
G3 is `IN_PROGRESS`: the native session now has precise event-step and abort
primitives; shared replication orchestration, native sidecar IPC, and the
retirement of duplicated `SimRunner` business logic remain.

## G4 evidence

- Added `kernel/apps/lp-session-host`: a private stdin/stdout JSON-line host
  that reuses `SimulationKernel` and `SimulationSession` for `start`,
  event-step, horizon advance, snapshot, abort, finish and shutdown. It opens
  no network port and never duplicates method algorithms.
- Added `scripts/test-session-host.mjs`; Debug and Release binaries pass a real
  start → step → abort → restart → finish protocol test.
- Added `lp-session-host` to the CMake build and release staged runtime.
- Windows Release native gate: PASS (506/506, including the new host target).
- Windows Release native gate: PASS again after the protocol handshake change
  (506/506; `lp-session-host` rebuilt and tested).
- Windows Release native gate: PASS after method telemetry collection changes
  (506/506; Process/Agent/Continuous/Statechart telemetry compiles in the
  release runtime).
- `pnpm desktop:stage` / `pnpm desktop:test-staged`: PASS with 81 staged files,
  including the native provider module and session host executable.

G4 remains `IN_PROGRESS`, but the first provider slice is real:
`native-session-provider.mjs` spawns the host, performs start/finish/step/abort
RPC, binds the service runId, and is registered as
`logicpilot.native.session` when `LOGICPILOT_ENABLE_NATIVE_SESSION_HOST=1`.
The staged E2E now runs this native target to completion and exercises animated
pause/resume/event-step/cancel. Provider step/advance responses flow into
ExecutionService telemetry events and the cursor/WebSocket stream. Remaining
work is richer native telemetry frames and method-specific projection. The
provider applies the request wall budget to host cancellation; staged host
framing is line-bounded and stderr is capped.

The staged native E2E also runs the five-method `SmartFactory` model through
the same host, proving the first native provider slice is not limited to a
single Process method.

The animated native path now drives an actual advance loop and supports
pause/resume/step/cancel through HTTP commands; staged E2E verifies the state
transitions and telemetry. The RunStore lock recovery window was tightened for
its short atomic upsert critical section, and staged restart after a failed
process now recovers instead of remaining permanently busy.
The RunStore lock retry budget is 2 seconds to tolerate concurrent terminal
snapshot and command writes without turning a valid stop command into HTTP 500.

The host/provider protocol now has a `logicpilot.native-session/v1` hello
handshake with declared version/capabilities; the provider rejects a mismatch
before starting a model. Native stderr is drained and capped at 1 MiB, while
the host's input line reader remains capped at 256 KiB.

Desktop Tauri startup now derives a writable per-user LogicPilot data root,
copies the signed staged system lockfile on first launch, and injects plugin,
artifact, draft, execution-store and native-session-host paths into the
app-server. Ordinary desktop users no longer need development environment
variables; development builds without a staged lockfile keep plugins disabled
safely.

When both Node plugins and the native session host are enabled, app-server now
skips launching the legacy `lp-server` entirely; Tauri accepts an empty WS
endpoint in this native-only mode. Browser/development mode still starts and
uses the legacy gateway through the existing fallback path.

## G6 first slice evidence

Added the neutral IDE [ExecutionClient](../../web/apps/ide/src/client/executionClient.ts)
for start/query/command and cursor WebSocket subscription. It has no paradigm
branches and is not wired into the legacy canvas store yet; its two tests lock
the unified HTTP envelope and structured error behavior. The next slice will
add a run projection store and migrate RunDialog behind an explicit capability
gate.

The neutral `executionStore` now projects session snapshots, bounded events,
cursor gaps, terminal session payloads and cross-run filtering. Its tests cover
duplicate/out-of-order events and a missing cursor gap; it still runs beside
the legacy `connectionStore` for gateway fallback.

RunDialog now detects the declared `logicpilot.native.session` target and uses
ExecutionClient/ExecutionStore when it is available. The existing gateway path
remains the fallback when no native target is advertised. Native RunDialog
controls route pause/resume/step/stop through versioned HTTP commands, while
the store receives the WebSocket event stream.

RunDialog no longer starts an implicit served model when the canvas is empty.
The Start action requires a real canvas document, and the empty state explains
that a model must be added or opened first. The browser gate covers this
negative case; the live telemetry cases below continue to exercise actual
canvas and method-family runs.

App startup now probes execution targets before auto-connecting the legacy
gateway: a native target suppresses unnecessary gateway auto-connect, while
browser/zero-plugin mode still falls back to the existing WebSocket path.
`pnpm test:browser` remains PASS after this selection gate.

Added a transport-only `executionProjector`: it updates renderer time and
refresh version from native telemetry without interpreting Process, Agent,
Statechart, Continuous or DEVS fields. Method-specific interpretation is
registered by the corresponding built-in paradigm packs, while the legacy
gateway projectors remain available during migration.

Built-in plugin lifecycle now registers method-specific telemetry projectors
for Process block counters, Agent population/tick, Continuous values/time,
Statechart summary and DEVS timing. The shell only owns projector registration;
the key namespaces and field interpretations stay in the corresponding
paradigm pack.

IDE evidence: full IDE suite is now 68 test files / 397 passed / 1 skipped,
and the production IDE build plus staged desktop build both pass after the
RunDialog capability gate and telemetry projector registration. Staged desktop
now contains 84 files.

ConsolePanel and StatusBar now consume native execution session events/status
alongside the legacy gateway stream. This keeps the old connection store only
as a fallback source while native runs are visible in the same diagnostics and
status surfaces.

All UI imports now enter the legacy gateway implementation through the explicit
`state/legacyGateway.ts` compatibility facade. The concrete `connectionStore`
remains isolated for fallback until its LPWR-specific projection and compile
continuation logic are fully retired.

The AI `/api/ai-run` path now has an explicit typed bridge into the same
ExecutionService for `process`, `devs`, `continuous`, `agent`, and `generic`
runs. The
runtime package preserves method-specific result payloads (metrics, trajectory,
diagnostics, experiment) alongside canonical run/evidence, so the AI response
keeps its existing result shape while also returning `execution.run` and
`execution.evidence`. Generic/mixed evidence carries a `methods` list and does
not invent a single `runtimeKind`.

Added `logicpilot.runtime.generic`: one more manifest generated from the same
entrypoint template. Its kernel service path calls the shared `runModelDsl`
driver without a single-method preflight, so SmartFactory-style mixed models
run through the same registry/service/lockfile path. Node runtime E2E asserts
that mixed evidence includes both Process and Agent methods. The execution run
store now reclaims a dead-owner mutex immediately (still never stealing a
live PID), so a crashed staged app can restart without a two-second false busy
window.

## G5 HTTP/WS adapter evidence

The execution boundary now exposes explicit route shapes in addition to the
temporary compatibility endpoint: `GET /api/execution/targets`,
`POST /api/execution/runs`, `GET /api/execution/runs/:runId`, and
`POST /api/execution/runs/:runId/commands`. These routes all delegate to the
same `ExecutionService`; no business logic is duplicated in the HTTP adapter.
The old `/api/execution` query/action form remains only as a migration wrapper.
`GET /api/execution/runs` returns the service-owned session collection for
run history and activity surfaces.
Run IDs are decoded and checked against command payloads, so a command cannot
be redirected to another run by changing the URL. The IDE `ExecutionClient`
uses the explicit routes, while its WebSocket subscription remains
`/api/execution/events` with the same origin/session-token checks.

`node scripts/test-execution-boundary.mjs` now covers the modern create,
query, and command routes as well as the compatibility path. IDE typecheck and
the ExecutionClient tests pass after the route migration.
The staged desktop E2E also creates and queries a real run through the modern
routes, then compares the modern target list with the compatibility response.
Root `pnpm test` remains green after the route, settings, schema, and AI
result-payload changes; contracts are 20/20, plugin-catalog 68/68,
plugin-host 94/94, and IDE is 398 passed / 1 skipped. The staged runtime now
contains 86 files including the generic package and passes the real desktop
E2E after restart/lock recovery.
`pnpm docs:build` also passes after updating the runtime/gateway guidance.

The Vite Connect middleware now restores the mounted `/api/execution` prefix
before invoking the shared handler. This keeps development and production
route parsing identical; without it, `/runs/:id` was silently interpreted as
the target-list route in dev mode.

## G7 settings evidence

The Settings category is now named `运行环境` and describes the managed local
execution session instead of presenting a standalone “Simulation gateway” as
the product architecture. When `logicpilot.native.session` is advertised it
shows ready/running/paused state and no editable gateway endpoint. The legacy
WebSocket URL and Connect/Disconnect controls are behind an explicitly labeled
`兼容传输（开发模式）` disclosure only when the native target is absent.
The browser gate covers the fallback disclosure and still verifies the legacy
development connection; native desktop startup remains gateway-free.

## Next action

Next: migrate AI parameter variation and optimize/sweep evaluation groups to
the same `ExecutionService`; then
migrate the remaining canvas live renderer, add reconnect/gap acceptance, and
retire the corresponding `connectionStore`/legacy gateway branches. The
durable store, cursor query, same-origin WebSocket stream, native mixed-method
start/step/pause/resume/abort path, explicit HTTP routes, managed runtime
settings, and typed AI run bridge are now present. Do not delete the remaining
gateway implementation until generic AI, canvas, and reconnect acceptance
passes.
