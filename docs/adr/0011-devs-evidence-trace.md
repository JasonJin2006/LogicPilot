# ADR-0011: Separate Causal Evidence from Determinism Hashes

- **Status**: Accepted; DEVS transition recorder implemented
- **Date**: 2026-08-22

## Context

`TraceRecorder` deliberately stores only a compact event hash. That is useful
for bit-exact replay tests, but it cannot answer which model produced an input,
which transition handled it, or how a coupled model's hierarchy maps to the
runtime atom id.

## Decision

Add an optional `DevsEvidenceRecorder` to `DevsExecutor`. Each recorded
transition contains:

- deterministic sequence and simulation timestamp;
- flat atom id and compiled hierarchy path;
- internal, external, or confluent transition kind;
- elapsed time since the previous transition;
- input/output port payloads;
- source atom id for each input (`kExternalEvidenceSource` for root injection).

The recorder is opt-in and separate from the hot-path determinism hash. When
disabled, the executor performs no evidence allocations. When enabled, the
records form an inspectable causal chain and expose a stable digest for tests
and later checkpoint anchoring.

## Consequences

- Result explanations can cite model paths and transition evidence rather than
  only aggregate metrics.
- PDEVS bags preserve all source identities, including multiple same-time
  outputs and external injection.
- Arbitrary model state is intentionally not serialized here; checkpointing
  will add an explicit state snapshot capability instead of guessing how to
  copy user-defined state.
