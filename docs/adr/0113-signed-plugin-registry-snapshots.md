# ADR-0113: Signed Plugin Registry Snapshots

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 2B registry security hardening

## Decision

`PluginRegistry` optionally carries an integrity envelope containing a
canonical SHA-256 digest, signature and signing key id. The digest is computed
over the complete registry with `integrity` removed and with recursively
sorted object keys. The Node bridge signs snapshots when
`LOGICPILOT_PLUGIN_REGISTRY_SIGNING_PRIVATE_KEY` is explicitly configured;
unsigned local development remains supported.

The existing rotatable public-key keyring verifies both package manifests and
registry integrity envelopes. A signature mismatch, digest mismatch or unknown
key is rejected by the verifier. The browser registry continues to validate
the structural contract first; external deployments should call the verifier
before applying untrusted remote snapshots.

## Consequences

Registry replay history and live SSE updates can be authenticated without
including private keys in the payload. Key rotation is an explicit keyring
operation, and old keys may remain during a migration window. External
registry publication and browser-side asynchronous key distribution remain
deployment-specific follow-up work.
