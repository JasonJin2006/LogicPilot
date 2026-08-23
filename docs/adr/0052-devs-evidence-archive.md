# ADR 0052: Portable DEVS evidence archive

## Context

`DevsEvidenceRecorder` already records causal paths, transition kinds, input
sources, and outputs, but its vector was process-local. A hash alone can prove
that two runs differ; it cannot be handed to an incident-analysis tool for
inspection or replay.

## Decision

Add the versioned LPEV archive format through `DevsEvidenceCodec`. The format is
little-endian and length-delimited, contains all evidence scalars and port
events, and ends with an FNV-1a checksum over the archive body. Decoder limits
bound archive bytes, records, events, and atom-path sizes before allocation.
Decoded records can be restored into a recorder only when sequence numbers and
input/source cardinalities are valid.

## Consequences

Evidence can be persisted and exchanged without FlatBuffers model bindings or
the live simulator. Corruption and resource-exhaustion inputs fail before a
trace is accepted. The archive is an observation artifact: it does not replace
the checkpoint protocol or claim to contain mutable atom state.
