# ADR-0128: Multi-Paradigm Data Pack Template

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8 built-in paradigm migration

## Decision

Agent, Continuous, DEVS and C4 are introduced as independent data-first
PluginManifest v2 packs. Each pack ships its own structured knowledge,
workflow skill, scoped instruction, diagnostic definition, ViewDefinition and
NotationPack. A shared `activateDataPack` helper only registers validated data;
it does not merge the paradigms or duplicate runtime execution.

The packs use distinct paradigm ids and canvases: Agent sequence, Continuous
chart, DEVS flow and C4 Graph2D. Their runtime providers remain explicit
execution-target work for the next migration slice.

## Consequences

The context compiler and view planner can now discover all planned paradigm
families from the same registry contract. Adding a runtime implementation later
does not require changing the shell or the structured knowledge format.
