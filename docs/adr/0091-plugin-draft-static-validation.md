# ADR-0091: Plugin Draft Static Validation Gate

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 7 schema/lint/conformance gate first slice

## Decision

`PluginDraftValidationRunner` is a side-effect-free pre-publication gate. It
validates the generated draft envelope, contribution ownership/version,
duplicate IDs, permission declaration closure, trust requirements for each
entrypoint and diagnostic explanation/fix references. It never imports or
executes an entrypoint and never writes the package store.

The report is deterministic and contains named check results plus bounded
diagnostic strings. An approval UI can display the report together with the
permission/trust diff before allowing publication.

## Consequences

Malformed or internally inconsistent drafts fail before any runtime boundary.
The next step is to connect this runner and the filesystem draft store to an
app-server draft API, then run generated conformance tests and package
builder/signing before handing an approved draft to `PackageManager`.
