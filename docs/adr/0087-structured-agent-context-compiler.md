# ADR-0087: Structured Agent Context Compiler

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 6 Context Compiler first slice

## Context

The plugin registry already carries structured knowledge, skills, instructions
and diagnostic definitions. The assistant previously selected only a static
skill-name list and rendered knowledge ad hoc, which made ordering,
applicability and size limits implicit and allowed draft knowledge to be
accidentally included by future callers.

## Decision

The IDE compiles one immutable plugin-registry generation into bounded JSON
sections for the assistant context. The compiler:

- includes only `trusted` knowledge blocks applicable to the current paradigm
  and domain;
- orders skills by stable ID;
- orders instructions by descending priority then stable ID, with wildcard or
  document-specific scope matching;
- filters diagnostic definitions by paradigm; and
- truncates only at complete JSON item boundaries, never in the middle of a
  formula or structured value.

The compiler emits the registry generation alongside the sections. The server
assistant renderer accepts these sections as additional context but does not
execute declarative skill steps; executable tools remain host-registered and
permission-gated.

## Consequences

Knowledge, skills, instructions and error explanations now travel as auditable
building blocks instead of an unstructured corpus. A later provider adapter or
Agent SDK can consume the same compiled context. Plugin-contributed executable
tools still require a host implementation and capability grant before they can
be mounted.
