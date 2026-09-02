# ADR-0080: Trusted Structured Knowledge in Assistant Context

Date: 2026-09-02  
Status: Accepted  
Implements: Phase 4 context compiler first slice

## Decision

The IDE assistant context builder reads only `trusted` KnowledgeBlocks from the
generation-aware plugin registry. It sends a bounded JSON projection containing
block id/type/owner/scope, structured content, formula AST, provenance and
verification metadata. Draft blocks are never included in the default context.

The projection is optional and bounded independently from the DSL/model
summary. The model receives compact structured blocks rather than the complete
knowledge corpus; display localization remains separate from semantic fields.

## Consequences

Knowledge updates arrive through the same registry generation as views,
diagnostics and tools. A registry refresh atomically changes the next assistant
turn's knowledge selection. Future ranking/retrieval can be added behind the
same `renderKnowledge` seam without changing the assistant protocol.
