# ADR-0118: Palette Host Contribution Actions

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 5/8 Canvas and paradigm migration

## Decision

`PaletteContribution` owns not only its item metadata and icon renderer, but
also its insertion action and optional notation-specific port anchors. The
generic `PalettePanel` invokes those callbacks and supplies only the active
canvas position; it no longer imports Process or SysML insertion, glyph or
port implementations. Unregistered/custom items use a generic shell icon and
have no implicit semantic mutation.

Process and SysML contributions therefore define their own CreateAction-like
behavior while sharing one Canvas palette host. A SysML item writes the
authoritative text declaration; a Process item creates a model node at the
mapped graph position.

## Consequences

Palette behavior follows the active contribution and disappears with its
plugin. Further migration can replace the current built-in contribution data
with external `CreateAction` records without changing the panel.
