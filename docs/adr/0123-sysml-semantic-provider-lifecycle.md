# ADR-0123: SysML Semantic Provider Lifecycle

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8/10 SysML plugin migration

## Decision

SysML projection, parser index, lowering, execution evidence and layout
functions dispatch through `SysMLSemanticProvider`. The SysML plugin registers
the builtin provider as a PluginHost effect and its disposer removes it.
Outside a normal plugin lifecycle a temporary fallback keeps isolated tests
usable; zero-paradigm boot disables that fallback and all SysML dispatch fails
closed.

## Consequences

SysML semantic state and AI tools now have a revocable provider boundary. A
future installed SysML package can replace the provider without changing its
consumers, and unloading the plugin cannot leave a hidden parser/lowering
implementation active.
