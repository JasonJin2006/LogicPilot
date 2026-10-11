# ADR-0135: Maintenance, Evidence and Contract Boundaries

Date: 2026-09-04  
Status: Accepted

## Decision

The 2026-09 maintenance pass separates executable behavior from historical completion claims.
The authoritative implementation status lives in `architecture/current-state.md`; plans and
accepted ADRs describe decisions, not proof of acceptance.

- Runtime package entrypoint code has one source template and is copied into self-contained
  package directories at build time. Staging only grants the explicit system service permission;
  it must reject a changed permission manifest rather than grant every requested capability.
- `/api/execution` uses the active plugin registry exclusively. Legacy static target aliases are removed.
- IR method compatibility is checked before kernel execution. A dedicated target rejects mixed-method IR.
- Evidence conformance is the conjunction of real checks. Variable names cannot establish the assumptions
  of M/M/1 theory or an analytic ODE, and an empty LPLT archive cannot establish a DEVS transition trace.
- Replication counts remain caller-controlled. Replay uses the effective first-run seed/count and shares
  its wall-time budget. Scientific reference cases are evaluated separately from generic runtime validity.
- `PluginPaletteContribution.canvas` now references `CanvasEngineId`. This intentionally breaks the old
  `2d | 3d | flow` field and updates only that baseline property. Old `2d` packages must explicitly choose
  Graph2D or Scene2D; the host must not guess a migration.
- MSVC configure/build use English `/showIncludes` output to keep Ninja header dependencies valid.

## Consequences

Full protocol, artifact pinning, integrity and lifecycle regression tests are required for these boundaries.
The cleanup does not certify the remaining OS sandbox, checkpoint replay, full scientific thresholds,
UI package independence or cross-process artifact transactions. Those remain visible in the status page.
