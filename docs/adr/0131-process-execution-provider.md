# ADR-0131: Kernel-Backed Process Execution Provider

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 9 runtime provider first slice

## Decision

The IDE app-server registers `logicpilot.process.runtime` in the
`ExecutionTargetRegistry`. It accepts a bounded DSL input, invokes the existing
real `lpcli` compile/run path through `runModelDsl`, and returns a validated
`ExecutionRun`. Successful metrics are archived as `ExecutionEvidence` with a
stable digest; compiler/CLI failures become a failed run with a sanitized
contract response rather than leaking temporary command paths.

The provider is an adapter, not a second simulator: kernel/CLI execution and
its conformance tests remain the sole runtime implementation. Future native,
WASM and external providers must use the same target/request/run/evidence
boundary.

## Consequences

There is now a real end-to-end execution path behind the runtime registry, not
only a type-level abstraction. Invalid target ids, malformed inputs and
provider exceptions fail closed at the HTTP boundary.
