# ADR-0130: Execution Target Provider Registry

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 9 native/runtime plugin boundary

## Decision

`ExecutionTargetRegistry` is the host-owned boundary for runtime plugins. A
provider registers a contract-validated `ExecutionTarget`, receives only a
matching `ExecutionRequest`, and must return a contract-validated
`ExecutionRun` plus optional `ExecutionEvidence` bound to the same target and
run id. Cancellation is routed through the registered provider and disposal
removes the target.

Permissions, Artifact revision binding, crash isolation and runtime-specific
quotas remain outside provider business logic and are enforced by the host or
loader before registration/execution.

## Consequences

Native, WASM, interpreter and external runtimes can converge on one execution
protocol. A provider cannot report a run or evidence for another target, and a
future C ABI/WASM adapter can be added without changing the shell or AI tools.
