# ADR-0132: Kernel Runtime Target Family

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 9 runtime provider migration

## Decision

The app-server exposes separate execution target ids for Process, DEVS,
Continuous and Agent (`logicpilot.*.runtime`) even though the first adapter
routes them through the shared, real `runModelDsl`/lpcli kernel path. Each
target remains independently lockable, auditable and replaceable by a native or
WASM provider. C4 is intentionally a non-executable architecture notation and
has no runtime target.

All targets return the same revision-bound run/evidence contract and sanitize
compiler/CLI failures before crossing the HTTP boundary.

## Consequences

The execution target graph now reflects paradigm ownership without duplicating
simulation engines. A later provider migration can replace one family at a time
and retain the same AI/tool and Artifact contracts.
