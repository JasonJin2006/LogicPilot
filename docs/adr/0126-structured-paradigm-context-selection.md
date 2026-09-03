# ADR-0126: Structured Paradigm Context Selection

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 4/6/8 knowledge and instruction migration

## Decision

Builtin DES and SysML contribution packages publish trusted, provenance-bearing
knowledge blocks, structured skills, prioritized instructions and diagnostic
definitions. The context builder derives the Process/SysML paradigm id from
the active document type when the host has not supplied one, and instruction
selection matches either document type or paradigm id.

The context compiler continues to emit bounded JSON blocks only; display prose
is not used as the knowledge store. Draft blocks remain excluded until review.

## Consequences

AI receives paradigm-specific rules and diagnostic definitions from the same
contribution registry used by views and palettes. Adding a new paradigm does
not require editing the global prompt builder; it contributes its own blocks
and scope.
