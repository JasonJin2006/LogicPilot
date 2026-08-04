# ADR-0004: FlatBuffers as the Unified IR + Wire Serialization

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: LogicPilot Phase 0

## Context

LogicPilot needs one model representation that flows through: DSL compiler →
kernel, kernel → web frontend (streaming frames), and persisted model files.
Candidates: Protobuf, Cap'n Proto, FlatBuffers, custom binary, JSON.

The performance budget (docs/performance-budget.md) demands ≤1 MB pushed frames
at 1M agents @ 10 Hz and ≤300 ms end-to-end latency, which rules out formats
that require full parse/copy on the hot path.

## Decision

Use **FlatBuffers** for both:

 1. **IR** (`schemas/ir_v2.fbs`): the lowered form of the DSL model consumed by the
   kernel.
2. **Wire protocol** (`schemas/wire.fbs`): streaming frames and control
   messages between kernel and web clients.

Rationale: zero-copy random access (frontend can render a frame without
decoding all agents), schema evolution via field ids, codegen for C++ and
TypeScript from a single source of truth.

## Consequences

- Positive: single schema source; zero-copy reads; compact payloads.
- Negative: FlatBuffers schema evolution discipline required (never reorder /
  reuse field ids); `.fbs` codegen must run in CI (`pnpm codegen`).
- Note: GPU/distributed extensions are deferred (ADR-0006); the IR keeps
  reserved fields only as placeholders, no speculative complexity.
