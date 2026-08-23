# ADR 0053: Deterministic continuous zero-crossing observation

## Context

Continuous integration can step over a state boundary between two accepted
ODE states. Without recording that boundary, a hybrid adapter cannot explain
when a guard became true, and checkpoint replay can lose the diagnostic trail.

## Decision

When the continuous node sets `detect_zero_crossings = 1`, each accepted RK4
step compares every state before and after integration. A sign transition is
recorded with the variable, before/after values, direction, and a deterministic
linear interpolation of the crossing time inside the accepted interval. The
bounded crossing log is part of the continuous checkpoint and is exposed by
`ContinuousReplicationModel::zero_crossings()`. A cold-path observer callback
can consume each accepted crossing immediately after it is recorded.

Adaptive nodes may additionally set `stop_at_zero_crossings = 1`. The
preflight controller clips the next accepted step at the first localized
crossing, so the shared scheduler can stop at that boundary. This option
requires detection and does not alter the default fixed-step trajectory.

This is an observation and localization contract, not a claim that a discrete
callback has already fired. Future hybrid adapters can use the localized record
to schedule a guarded event without changing the numerical archive format.

## Consequences

Crossing diagnostics survive pause/replay and remain deterministic across fixed
and adaptive paths. The explicit opt-in avoids changing existing trajectories or
allocating an unbounded event log for models that do not need boundary data.
