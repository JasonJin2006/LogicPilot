# ADR-0127: Statechart Paradigm Pack

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8 built-in paradigm migration

## Decision

Statechart is introduced as an independent builtin PluginManifest v2 pack. It
ships a validated structured contribution set containing lifecycle knowledge,
workflow skill, deterministic transition instructions, diagnostic definitions,
Statechart ViewDefinition, NotationPack and CreateActions. The kernel remains
the execution provider; this first pack does not duplicate runtime code in the
IDE.

The pack activates through the same PluginHost and local contribution registry
as DES and SysML. Its structured resources are removed on plugin unload and
participate in the normal registry/context compiler gates.

## Consequences

Statechart no longer needs to be treated as an implicit model-library variant
when selecting views or AI context. Agent, Continuous, DEVS and C4 packs will
follow this data-first migration template before their runtime providers are
extracted.
