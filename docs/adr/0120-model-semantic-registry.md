# ADR-0120: Runtime Model Semantic Registry

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8/10 semantic coupling migration

## Decision

Model consumers use `src/plugins/registries/modelSemantics.ts` instead of
importing the built-in forwarding module or a concrete palette implementation.
The registry exposes provider-owned port discovery, executable-kind checks and
notation port geometry, with lifecycle registration/disposal for future
Process, Statechart and Agent semantic providers.

The initial provider delegates to the existing Process catalog so the migration
does not change model behavior. Replacing this provider with a fully packaged
plugin contribution is a later deletion step; no new consumer may bypass the
registry.

## Consequences

ModelStore, DSL outline and mutation tools now depend on a neutral registry and
can be tested without knowing the plugin directory layout. Provider lifecycle
is explicit, making unload and paradigm replacement possible without changing
the consumers.
