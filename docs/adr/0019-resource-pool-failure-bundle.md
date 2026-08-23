# ADR-0019: Shared ResourcePool Failure/Repair Bundle

- **Status**: Accepted; initial shared-pool implementation landed
- **Date**: 2026-08-22

## Decision

For Service blocks without task preemption or timeout, checkpointing may now
include a shared ResourcePool. The bundle stores:

- available and busy units;
- pool down flag, down units, and generation;
- busy/down area accumulators;
- pending pool failure and repair events;
- Service in-service entities and pool-down entity ids.

Pool failure/repair events are restored with their original payloads and
absolute timestamps, preserving generation validation and preemptive-repeat
service restart behavior.

Task-level preemption, Seize-held resources, timeout plus pool failure, and
multiple advanced block combinations remain unsupported until their event
ownership contracts are encoded together.
