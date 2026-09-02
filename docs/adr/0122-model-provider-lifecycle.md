# ADR-0122: Model Provider Lifecycle

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8/10 plugin lifecycle migration

## Decision

The DES plugin registers the Process model semantic provider through the
PluginHost effect system and its disposer removes the provider. The neutral
registry owns port discovery, executable-kind checks and port geometry; model
consumers never call the provider directly.

For isolated legacy/unit-test surfaces a compatibility fallback is enabled by
default. `startIdePluginHost` disables that fallback for zero-paradigm boots,
so an empty plugin table has no Process semantic provider. Normal builtin
activation replaces the fallback with the lifecycle-scoped provider.

## Consequences

The plugin unload path now has a concrete semantic capability to revoke. The
fallback is explicitly temporary and cannot mask the zero-paradigm acceptance
gate; the remaining SysML semantic and panel providers must receive the same
lifecycle treatment before Phase 10 completion.
