# ADR-0095: View Planner and Extended Canvas Contract

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 5 View Resolver first slice

## Decision

`ViewDefinition.canvas` formally includes `flow`, `statechart`, `sequence`,
`stock-flow` and `causal-loop` in addition to graph2d/scene2d/scene3d,
timeline, table, chart and text. These are generic representation surfaces;
they do not encode a particular paradigm.

The IDE `View Planner` scores only installed ViewDefinitions against structured
intent (purpose, requested artifact kinds and preferred canvas). It returns
deterministic candidates, gives explicit user selection precedence, and never
creates a view or assumes a renderer is installed. A host may therefore add a
new notation/view plugin without changing the planner or Shell.

## Consequences

2D/3D/flow and future representation choices can follow the active problem and
paradigm through declared views rather than hardcoded panel branches. Canvas
implementations still need to register their renderer and inverse-edit support;
an uninstalled or unsupported canvas remains unavailable to the planner.
