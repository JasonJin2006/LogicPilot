# ADR-0082: Canvas/View/Notation Contributions Follow the Active Registry

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 5 canvas/view/notation first slice

## Decision

The IDE exposes view, notation and create-action queries from the active
generation-aware `PluginRegistry`. A view declares its canvas engine (`graph2d`,
`scene2d`, `scene3d`, flow, etc.), artifact query and inverse-edit capability;
the Shell does not infer a paradigm-specific canvas from plugin ids.

Palette metadata follows the same generation. Semantic insertion and rendering
rules remain owned by the plugin's notation/view contribution, while the
generic Palette and canvas hosts only select and route declared entries.

## Consequences

SysML, C4 and future paradigms can share a canvas engine while contributing
different query, notation and create-action rules. Removing a plugin generation
removes its views, notation packs and actions together with its knowledge and
tools.
