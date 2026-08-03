# ADR-0003: Minimal C++ Dependency Set

- **Status**: Accepted
- **Date**: 2026-08-03
- **Deciders**: LogicPilot Phase 0

## Context

Kernel build times, attack surface and cross-platform portability scale with
the number of third-party dependencies. LogicPilot aims for a 1M-agent kernel
with strict latency budgets, so every dependency must earn its place.

## Decision

The approved C++ dependency set is fixed at:

| Dependency    | Role                                        |
| ------------- | ------------------------------------------- |
| EnTT          | ECS core for agent storage / iteration      |
| FlatBuffers   | IR + wire serialization (see ADR-0004)      |
| Boost.Beast   | WebSocket / HTTP transport for lp-server    |
| fmt           | String formatting                           |
| spdlog        | Structured logging                          |
| Catch2        | Unit testing                                |
| benchmark     | Micro-benchmarking (perf budget gates)      |

**Rule**: adding any new third-party C++ dependency requires a new ADR
documenting why no existing dependency or in-repo code can cover the need.

## Consequences

- Positive: small, auditable dependency graph; fast vcpkg installs; stable ABI
  surface.
- Negative: some conveniences (e.g. CLI parsing, JSON) are written in-repo or
  deferred until justified by an ADR.
