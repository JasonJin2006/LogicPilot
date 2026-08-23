# ADR 0036: Deterministic RLE checkpoint transform

## Context

The transform boundary needs a reference compression implementation for tests
and small deployments, without introducing a third-party dependency or
pretending that ad-hoc encryption is secure.

## Decision

Provide `RleCheckpointTransform` with a bounded PackBits-style encoding. Runs
of repeated bytes and literal spans have explicit length tokens; incompressible
payloads use a raw fallback. The transform is wrapped by the existing checksummed
`LPAE` envelope.

## Consequences

The pipeline has a real deterministic compression path and a safe fallback.
Production deployments should prefer a reviewed compressor and authenticated
encryption transform through the same interface.
