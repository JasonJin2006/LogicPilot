# ADR-0119: Remove Built-in Forwarding Seams

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8/10 legacy deletion

## Decision

The empty forwarding modules under `plugins/builtin` for model semantics,
palette, panels and properties are deleted. Callers use the owning model,
SysML and workbench modules directly while the contribution registries remain
the runtime extension boundary. No new forwarding files are added merely to
preserve an obsolete import path.

The remaining direct semantic imports are tracked migration debt and must be
replaced by runtime contribution registries before the final Phase 10 gate;
this slice only removes modules that added no behavior or lifecycle.

## Consequences

The source tree no longer suggests that a re-export file is a plugin boundary
when it is only a compatibility alias. Palette and panel behavior already
flows through contribution hooks; future semantic registries can replace the
remaining direct model/SysML imports without another forwarding layer.
