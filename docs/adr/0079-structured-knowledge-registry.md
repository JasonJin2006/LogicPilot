# ADR-0079: Structured Knowledge Registry and Trusted Context Selection

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 4 structured knowledge first slice

## Decision

Knowledge blocks from an approved plugin's `contributions.json` are indexed by
`KnowledgeRegistry` during the same generation prepare/commit cycle as other
contributions. The registry reuses the frozen `KnowledgeBlock` contract,
including scope, formula, provenance, verification and status fields.

Queries are structural: paradigm, domain, type and status filters are applied
before a bounded result limit. The default status is `trusted`; AI-authored
`draft` blocks never enter a normal context query. Promotion to `reviewed` or
`trusted` remains an explicit approval operation.

## Consequences

The context compiler can consume compact blocks instead of a natural-language
corpus. Formula ASTs, assumptions, units, source locators and media provenance
remain inspectable fields. Future persistent storage can replace the in-memory
maps without changing selection or trust semantics.
