# LogicPilot Performance Budget

Status: **Accepted** (Phase 0 baseline) · Owner: kernel team

This document is the normative performance contract. CI gates (benchmark jobs)
must fail when a budget is exceeded beyond tolerance. All budgets assume
reference hardware: a current-gen 8-core desktop CPU, 32 GB RAM, no GPU
required for 2D rendering targets.

## Budgets

| # | Metric | Target (production) | MVP baseline | Notes |
|---|--------|--------------------|--------------|-------|
| 1 | Scheduler throughput: `schedule` + `pop` ops | **≥ 10,000,000 ops/s** | ≥ 1,000,000 ops/s | Measured via google/benchmark in `bench/`; conservative single-node, ADR-0007 |
| 2 | End-to-end event throughput | **≥ 5,000,000 events/s** | ≥ 500,000 events/s | DSL model → kernel execution steady state |
| 3 | Memory: 1M agents resident | **≤ 8 GB** RSS | ≤ 8 GB | EnTT layout + arena allocators, ADR-0003 |
| 4 | Pushed frame payload size | **≤ 1 MB** per frame | ≤ 1 MB | 1M agents @ 10 Hz update rate; delta encoding + FlatBuffers, ADR-0004 |
| 5 | Frontend 2D rendering | **1M particles @ 60 fps** | 100k particles @ 60 fps | Web renderer (`web/packages/renderer2d`), WebGL/WebGPU |
| 6 | End-to-end latency (kernel tick → pixel) | **≤ 300 ms** | ≤ 500 ms | WebSocket push, wire.fbs |
| 7 | DSL compile time | **≤ 2 s for 100k lines** | ≤ 5 s | tree-sitter parse + lowering, ADR-0005 |

## Rules

1. Every PR touching the scheduler, wire path, or renderer must run the
   corresponding benchmark gate in CI.
2. Budget #1 has an MVP escape hatch (1M ops/s) only until the Phase 1
   scheduler lands; the production target is the acceptance criterion.
3. Regression tolerance: a single run may deviate ≤ 5%; two consecutive runs
   exceeding tolerance block the merge.
4. Budget changes require an ADR and an update to this file in the same PR.
