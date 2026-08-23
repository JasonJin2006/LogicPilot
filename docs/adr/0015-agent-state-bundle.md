# ADR-0015: Versioned Agent Population Checkpoint Bundle

- **Status**: Accepted; Agent runtime implementation landed
- **Date**: 2026-08-22

## Decision

The Agent method checkpoint serializes a deterministic population snapshot:

- population count, tick budget, current tick, and bounce behavior;
- each live SoA position, velocity, and flags word;
- each cold `ModelAgentState` value, sorted by variable name;
- a versioned little-endian type-tagged encoding for bool/int64/double values.

Restore clears and rebuilds the `AgentRuntime`, recreates cold components and
handles, then the Method Runtime cancels/recreates its tick event. This keeps
entity state and the scheduler event boundary together without copying EnTT
object memory.

The bundle is currently supported by a single Agent `SimulationSession`.
Multi-method snapshots still require a shared message/variable and scheduler
bundle contract.
