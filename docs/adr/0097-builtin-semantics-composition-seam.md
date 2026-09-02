# ADR-0097: Builtin Semantics Composition Seam

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 8 builtin plugin migration first slice

## Decision

Paradigm-specific SysML parser, projection, execution, layout and evidence
implementations are wired in `plugins/builtin/semantics.ts`. AI tools and
state stores consume that neutral composition seam instead of importing
`sysml/*` modules directly. The seam exports types and operations only; it
does not make the workbench aware of SysML identifiers or add a second runtime
registry.

## Consequences

The lint rule now enforces the intended dependency direction while preserving
the existing behavior and test contracts. Replacing or removing the builtin
SysML plugin has one explicit composition boundary. The same migration pattern
will be applied to DES block definitions and canvas adapters.
