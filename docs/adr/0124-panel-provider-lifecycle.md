# ADR-0124: Panel Provider Lifecycle

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8/10 UI plugin lifecycle migration

## Decision

The open panel registry supports `replacePanel`, which records the previous
fallback definition and restores it when the plugin disposer runs. The DES
plugin binds the model and DSL panel implementations through this lifecycle;
SysML already contributes its own `sysml` panel with `registerPanel`.

The workbench keeps stable panel ids/layout slots, but no longer assumes that
the implementation behind a panel is permanent. Future external packs may
replace or remove these providers without editing the shell layout.

## Consequences

Panel replacement and unload are testable state transitions rather than static
imports. A zero-paradigm shell can retain generic layout metadata while its
semantic panel providers are absent.
