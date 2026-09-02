# ADR-0121: SysML and Panel Registry Seams

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8/10 coupling cleanup

## Decision

The SysML semantic export surface is owned by
`src/plugins/registries/sysmlSemantics.ts`; SysML state and Agent tools import
that surface rather than a `builtin/sysml` forwarding path. Built-in panel
components are isolated in the composition-root `panelComponents` registry so
the workbench panel table consumes opaque component references.

These registries are transitional composition seams: they are the only places
where concrete Process/SysML implementation modules are wired. The final
plugin-pack migration can replace their providers without changing state or
workbench consumers.

## Consequences

The IDE lint gate now reports zero direct paradigm-import warnings. Remaining
work is to make the registries lifecycle-owned by installed plugin manifests,
then remove the built-in providers when external packs are available.
