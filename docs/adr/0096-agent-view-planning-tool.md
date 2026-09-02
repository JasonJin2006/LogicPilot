# ADR-0096: Agent View Planning Tool

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 5/6 view selection integration

## Decision

The IDE mounts a read-only `plan_view` capability. It accepts structured
purpose, artifact-kind, preferred-canvas and optional explicit-view inputs and
returns candidates from the installed `ViewDefinition` registry. The planner
uses deterministic scoring and always gives explicit user selection precedence.

The tool cannot create views, load a renderer, execute inverse edits or widen
the installed registry. A separate user action remains responsible for
activating a selected view.

## Consequences

2D/3D/Flow/Statechart/Table choices can be proposed by the Agent from declared
semantics while the Shell remains paradigm-neutral. Missing or uninstalled
canvas implementations result in no candidate instead of a fabricated view.
