# ADR 0051: Deterministic adaptive continuous integration

## Context

The SD method previously used only a fixed 10 ms RK4 interval. That is stable
for the small examples in the DSL but can under-resolve rapidly changing or
stiff systems, while changing the global default would break existing
trajectories and golden values.

## Decision

Continuous nodes opt into deterministic step-doubling RK4 with numeric params:
`adaptive = 1`, `absolute_tolerance`, `relative_tolerance`, `minimum_step`,
`maximum_step`, and optional `horizon`. Each trial compares one full RK4 step
with two half steps using a normalized infinity-norm error. Accepted steps use
the refined result; rejected steps shrink deterministically. A retry and
accepted-step bound prevents pathological models from looping forever.

The SD shared-event runtime schedules the next event from the actual proposed
continuous step, not a hard-coded 10 ms delay. Solver state (proposed step,
target horizon, adaptive flag, and observed error) is included in the versioned
continuous checkpoint. The fixed-step path and its existing checkpoints remain
compatible.

## Consequences

Models can request controlled numerical accuracy without sacrificing replay:
the arithmetic and step controller are deterministic. Adaptive trajectories
may contain a different number of samples, so consumers must use the recorded
time coordinate rather than assuming a fixed sample interval.
