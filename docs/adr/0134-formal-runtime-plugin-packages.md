# ADR-0134: Formal Runtime Plugin Packages

Date: 2026-09-03  
Status: Accepted

## Decision

Process, DEVS, Continuous, Agent and Generic mixed-method execution targets
are delivered as independent Node plugin packages. Each package declares its
`PluginManifest.executionTargets`, exports `execute(request)` from its Node
entrypoint, and delegates kernel execution through the host-owned
`logicpilot.execution.kernel` service.

`NodePluginRuntime` is the only owner of the active execution target registry
when Node plugins are enabled. It registers targets after successful plugin
activation and revokes them during refresh/stop. The app-server HTTP endpoint
does not maintain a second production registry.

Updated by [ADR-0135](0135-maintenance-evidence-and-contract-boundaries): the
in-process kernel target table has been removed. All deployments using
`/api/execution` must enable Node plugins and provide a lockfile.

## Consequences

- Target availability follows package installation, lockfile approval, trust and
  plugin lifecycle.
- Staged desktop builds generate the approved single-method packages plus one
  generic mixed-method package from one entrypoint template and a system-scope
  lockfile with manifest-bound package digests.
- Runtime implementations may share the host kernel service initially, but
  their target identities and lifecycle are independent; replacing one with a
  native or WASM implementation does not change the HTTP contract.
- The kernel compile command can emit a small `logicpilot.ir-methods/v1`
  summary. Adapters use that summary to bind the requested runtime kind to the
  methods actually lowered into FlatBuffers IR; source-text heuristics are not
  authoritative.
- The desktop shell generates the `logicpilot:plugin@1.0.0` Component Model
  binding from `schemas/wasm/logicpilot-plugin.wit` with `wit-bindgen`. A Node
  raw-WASM loader remains wire-compatible during migration; any Component
  Model execution entrypoint must register through the same
  `ExecutionTargetRegistry`.
