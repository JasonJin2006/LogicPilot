# ADR-0125: Built-in Structured Contributions

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 4/5/8 structured knowledge/view migration

## Decision

Process and SysML builtin plugin packages carry validated
`contributions.json` files. Their ViewDefinition, NotationPack, CreateAction
and structured palette metadata are registered through the local
`PluginRegistryStore` contribution lifecycle when the plugin activates and
removed when it stops. Remote registry snapshots remain authoritative for
remote plugins; local contributions are merged without changing the remote
generation.

The initial files intentionally contain no executable tools or unreviewed
knowledge blocks. Runtime tool/semantic providers remain separate capability
contributions and all mutations still pass the existing host/transaction
gates.

## Consequences

The same structured contribution contract now describes builtin and external
plugins. View/notation consumers can exercise builtin packs through the
registry, and plugin unload removes their structured metadata as well as UI
seams.
