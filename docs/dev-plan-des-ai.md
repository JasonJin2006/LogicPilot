# DES-first / AI-first development plan

Status: active (2026-08-08)

## Product target

The next releasable slice is not "support every simulation paradigm". It is a
dependable DES workbench in which a user can describe a queueing process,
review and edit the resulting model, run experiments, understand the result,
and ask the assistant to make a local change without destroying unrelated
work.

The primary reference for DES behavior is the local AnyLogic Process Modeling
Library documentation. Compatibility means matching observable modeling
semantics, not cloning AnyLogic's Java API or editor.

## Required user journey

1. Create `Source -> Queue -> Service -> Sink` by canvas or natural language.
2. Edit arrivals, capacity, service time, resources, routing, and run settings.
3. Validate the model before running and show diagnostics at the responsible
   block/property.
4. Compile and run deterministic replications.
5. Show per-block flow, occupancy, utilization, timeout, and preemption data.
6. Ask a result-grounded question and receive an explanation tied to metrics.
7. Ask for a modification, preview a small ModelPatch, apply it as one undoable
   transaction, and rerun.

## Delivery sequence

### M1 — Canonical DES acceptance suite

- Turn the compatibility ledger into golden scenarios for Source, Queue,
  Service, Sink, and ResourcePool.
- Cover property editor -> DSL -> IR -> runtime, including negative tests for
  unsupported modes and invalid connections.
- Add statistical acceptance where an analytic result exists (M/M/1 and
  M/M/c), and deterministic event assertions for semantic edge cases.

Exit criterion: the supported MVP property matrix has no silent no-op field.

Progress (2026-08-08): deterministic golden models now verify Source
generation, Service `numberOfUnits`, queue occupancy, utilization, Sink
completion, Queue timeout/preemption, FIFO/LIFO ordering, priority/comparison
victim identity (including newcomer self-preemption), and arbitration between
multiple Service blocks sharing a healthy fixed ResourcePool. Invalid Queue
modes and incomplete comparison expressions now fail at compile time. The MVP
property editor badges partial and non-executed AnyLogic fields. Remaining M1
work includes the wider unsupported-property matrix and correct pool-wide
interruption semantics when a failure-enabled ResourcePool is shared by
multiple consumers.

### M2 — AI modeling tool loop

- Treat `ModelPatch v1` as the only mutating command boundary.
- Expose tools for inspect-model, propose/apply patch, validate, compile, run,
  and query block metrics.
- Return a patch preview and concise rationale before mutation; preserve IDs,
  layout, unrelated blocks, and undo history.
- Keep whole-DSL generation only as a bootstrap/fallback path.

Exit criterion: create, modify, repair, and rerun scenarios pass without
replacing unrelated canvas content.

Progress (2026-08-08): the first modify-and-rerun slice now passes. Common
DES parameter requests update the supplied model without regenerating
unrelated blocks or couplings. The IDE derives and previews a minimal
ModelPatch, highlights removals/disconnections, rejects stale proposals, and
applies the patch as one undo step. After application, the independent
`ai-run` tool validates, compiles, and runs the exact DSL regenerated from the
accepted canvas, so displayed metrics cannot refer to a stale AI candidate.
Existing models now use a native `propose-model-patch` function tool with
stable IDs; parameter changes and block add/remove/connect operations no
longer require full-DSL regeneration. Result questions now use a grounded
`query-metrics` tool over the last completed run instead of regenerating and
running another model. Existing-model changes retain a baseline run and use a
structured `compare-metrics` tool after application, with identical run
settings and per-block deltas. Remaining M2 work is richer structural intent
coverage. Applied tool turns are now persisted per project/model with the
exact patch and grounded outcome; follow-up requests can resolve prior targets
without guessing from free-form chat alone. The offline structured provider
also supports parameterized Source/Queue/Service/Resource creation,
connections, disconnections, removals, and model renames; ambiguous targets
remain an explicit user-facing diagnostic rather than an arbitrary choice.

### M3 — Experiment and explanation quality

- ✅ Unify IDE, gateway and AI run settings; the AI backend no longer hides a
  fixed seed/sample size/warm-up/confidence level.
- ✅ Add declared Simulation experiments (`seed`, fixed `replications`) to
  DSL → IR → `lpcli run --experiment`, while command-line values remain
  explicit overrides.
- ✅ Expose configurable confidence intervals and paired-seed before/after
  inference; conclusions explicitly distinguish supported changes from
  random-noise/inconclusive results.
- ✅ Add AnyLogic-style varying replications (minimum/maximum/error percent)
  and unique random seed mode across DSL/IR/CLI/gateway/IDE/AI. Random/adaptive
  AI baselines freeze the resolved seed/sample count for valid paired inference.
- ✅ Add range-based, multi-axis Parameter Variation execution and IDE results:
  typed top-level parameter overrides, Cartesian combinations, concurrent
  iterations, fixed/precision replications, fixed/random seeds and confidence
  intervals. Freeform value sets and Monte Carlo sampling remain separate work.
- Continue grounding explanations in topology plus structured metrics.

Exit criterion: AI answers "where is the bottleneck and what change helped?"
from two reproducible experiment results.

### M4 — Desktop delivery and resilience

- ✅ Bundle the frontend, local service runtime, `lp-server`, `lpcli`, and
  required native libraries as version-matched Tauri resources.
- ✅ Remove runtime reliance on repository build directories and machine-wide
  Node/MSYS installations; validate manifest hashes and a real AI DES run with
  an isolated PATH, including a non-ASCII path.
- ✅ Generate an NSIS installer and verify isolated installation plus first
  launch starts bundled Node, `lp-server`, and WebView2; the staged full AI DES
  flow also passes from a non-ASCII path.
- Test abnormal crash cleanup, fully offline use, and upgrade compatibility.

Exit criterion: a clean Windows machine can install and complete the required
user journey without a developer toolchain.

## Deferred until the DES loop is solid

- Hybrid DES/agent/system-dynamics synchronization UX.
- New modeling paradigms and arbitrary user code execution.
- Distributed simulation, GPU execution, and marketplace-scale library work.
- Broad Process Modeling Library surface expansion beyond validated user
  scenarios.

The IR and runtime should retain method/plugin boundaries for these future
capabilities, but they must not delay the DES/AI product loop.
