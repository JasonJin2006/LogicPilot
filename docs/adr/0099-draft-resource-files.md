# ADR-0099: Bounded Draft Resource Files

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 7 structured resource packaging

## Decision

`PluginDraft.files` carries optional UTF-8 or base64 data assets such as
formula render inputs, notation metadata and images. Every relative path is
validated against traversal, absolute paths, reserved manifest names and a
4 MiB total budget; each value is capped by the frozen schema. The validator
reports file failures before approval or packaging.

The package builder materializes only validated files, includes them in the
existing canonical payload digest, and signs the resulting digest. Existing
content-addressed package directories are immutable and are never replaced.

## Consequences

Structured expert assets can travel with a draft without becoming an
unbounded natural-language corpus or allowing filesystem escape. Binary assets
are represented as bounded base64 strings for now; a future artifact/blob store
may replace inline values without changing approval semantics.
