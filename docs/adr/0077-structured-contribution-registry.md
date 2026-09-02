# ADR-0077: Structured Contribution Registry and Package Bridge

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 2C first slice

## Decision

Plugins publish one optional `contributions.json` beside `plugin.json`. The
file is validated as `PluginContributionSet`, whose knowledge, diagnostics and
view entries reuse the existing domain contracts; skills, instructions,
palettes and tools have strict contribution definitions. Natural-language
corpus blobs and unknown fields are rejected.

`ContributionRegistry` uses the same generation discipline as the runtime:
sets are validated and deduplicated during `prepare`, then atomically exposed
only by `commit`. A malformed package contribution is isolated and audited;
it cannot partially mutate an active generation.

The Node runtime loads contribution files only for lockfile-approved catalog
entries whose package digest matches. The local `GET /api/plugin-registry`
bridge exposes the active generation and sanitized contribution data to the
IDE. Absolute local paths in provenance/media fields are redacted before the
HTTP boundary.

## Consequences

Contribution data is now a versioned, inspectable building block rather than a
prompt corpus. Future IDE registries can consume the same envelope for
knowledge, diagnostics, views and palettes. Executable entrypoints remain
separate: they can request capability RPCs, but cannot bypass contribution
validation or lockfile approval.
