# ADR-0075: WASM Host ABI, Capability Imports and Runtime Quotas

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 2B-3 WASM/runtime hardening

## ABI v1

The WASM module is instantiated with the `logicpilot` import namespace. Every
import is deny-by-default and is available only when both the host provides an
implementation and the plugin has an explicit matching grant:

| Import                  | Capability       | Signature                          |
| ----------------------- | ---------------- | ---------------------------------- |
| `logicpilot.log`        | `runtime.log`    | `(level: i32, value: i32) -> void` |
| `logicpilot.random_u32` | `runtime.random` | `() -> i32`                        |

The lifecycle exports are `logicpilot_activate() -> void` and optional
`logicpilot_deactivate() -> void`. ABI version is `1`. No WASI imports,
filesystem handles, sockets, process APIs or arbitrary host callbacks are
available in v1.

The canonical table and import filtering implementation live in
`web/packages/plugin-catalog/src/wasm-abi.ts`; this ADR is the human-readable
contract and must change together with that table and its tests.

## Runtime quotas

- WASM artifact: 16 MiB default (`maxWasmBytes` configurable per host).
- WASM linear memory: optional `maxWasmMemoryBytes` checked immediately after
  instantiation.
- ESM artifact: optional `maxModuleBytes`.
- Activation/instantiation: optional `activationTimeoutMs`; timeout timers are
  cleared after completion.
- Registry polling: bounded interval, minimum 100 ms, default 2 s.

Timeouts protect asynchronous ESM activation and WASM instantiation. A
synchronous infinite loop cannot be pre-empted on the Node event loop; a future
worker-based WASM runtime is required for hard CPU pre-emption. Native loading
and unrestricted host ABI are explicitly out of scope.

## Consequences

`NodePluginRuntime` now composes scanner, trust-gated ESM/WASM loaders and the
existing `PluginHost`, with polling refresh and revision subscriptions. A
refresh builds and activates a new host before stopping the previous one; a
failed candidate leaves the previous host intact.

The production app-server wiring is opt-in via
`LOGICPILOT_ENABLE_NODE_PLUGINS=1`. Its default trust is `t0`, so executable
ESM/WASM remains disabled unless the operator explicitly raises
`LOGICPILOT_NODE_PLUGIN_TRUST` (ESM requires T4, WASM requires T2).
