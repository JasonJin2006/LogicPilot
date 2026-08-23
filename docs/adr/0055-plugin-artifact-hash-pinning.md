# ADR 0055: Optional plugin artifact hash pinning

## Context

Method manifests identify a plugin by package, method, entrypoint, and ABI, but
an artifact path can be replaced after a manifest is reviewed. The host needs a
portable integrity check without pretending that a digest is a publisher
signature or a trust chain.

## Decision

Manifest runtime objects may include `artifactSha256`, a 64-character hex
SHA-256 digest. The C ABI and WASM loaders hash the resolved artifact before
loading or compiling it and reject mismatches (`MP1108` / `MP1211`). Hashes are
normalized to lowercase during manifest parsing. When omitted, loading keeps
backward-compatible behavior for existing packages.

The digest implementation is dependency-free and bounded to 256 MiB per
artifact. It is an integrity pin only; publisher signatures, key distribution,
revocation, and policy enforcement remain outside this change.

## Consequences

A deployment can detect accidental or malicious artifact replacement before
native code is loaded. Package tooling can calculate the digest independently
and record it in the manifest. Operators must still establish a trusted source
for the manifest itself.
