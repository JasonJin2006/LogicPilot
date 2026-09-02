# ADR-0098: Builtin Canvas and Model Composition Seams

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8 builtin plugin migration and lint closure

## Decision

DES block definitions, canvas insertion/icon adapters, builtin panel
implementations and properties editors are wired through neutral composition
entrypoints under `plugins/builtin`. Workbench, state, project and AI layers
consume those seams rather than importing `model/*` or `sysml/*` directly.

The seam modules are the only place allowed to bind concrete builtin
implementations. They do not change the generic panel, canvas or registry
contracts and do not add paradigm branches to the Shell.

## Consequences

The architectural import rule is now enforced with zero lint warnings. A
builtin paradigm can be removed or replaced by changing its composition module
and contributions, while tests and consumers retain stable neutral imports.
