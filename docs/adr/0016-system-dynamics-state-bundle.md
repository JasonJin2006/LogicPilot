# ADR-0016: Versioned System-Dynamics State Bundle

- **Status**: Accepted; RK4 runtime implementation landed
- **Date**: 2026-08-22

## Decision

The SD bundle serializes the fixed-step integrator boundary:

- step budget and completed step index;
- current continuous simulation time;
- ordered equation variable names;
- current finite state vector;
- active flag.

Restore validates the equation variable order and finite values, resets the
trajectory cache, and lets the SD runtime recreate its next step event. The
versioned little-endian blob avoids copying expression evaluator internals;
equations and parameters remain immutable model data.

## Boundary

The bundle supports one SD runtime. Coupled SD/Process models still require a
shared method bundle and event-ownership contract before multi-method restore.
