# ADR-0133: Runtime Target Conformance Gate

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 9 runtime migration acceptance

2026-09-04 clarification: this gate originally demonstrated routing only; it
did not prove independent scientific conformance of four paradigms. Current
fixtures and limitations are described in [current state](../architecture/current-state).

## Decision

The staged desktop smoke executes the real kernel-backed provider separately
through the Process, DEVS, Continuous and Agent target ids. Each invocation
must return a completed target-matching run and evidence bound to that run.
Target discovery is also asserted from the production app-server tree with no
repository `node_modules` dependency.

This proves independent target routing and contract binding while the first
implementation still shares `runModelDsl`; later WASM/C ABI replacements must
retain the same gate.

## Consequences

Runtime target registrations cannot pass acceptance merely by listing ids.
Each family needs a real execution proof before its provider is switched or
its default runtime is changed.
