# ADR-0114: Browser Registry Signature Verification

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 2B registry security hardening

## Decision

The app-server publishes the configured public-key map through the authenticated
`/api/config` response. The IDE constructs a WebCrypto Ed25519 verifier and
uses `applyVerified` for the initial registry fetch and every SSE replay/live
snapshot. Structural contract validation happens before signature verification;
neither failure is allowed to mutate the active snapshot.

Tauri bootstrap still returns only its endpoint/token wire contract. The IDE
performs an authenticated second config request to obtain public keys, so the
native client does not need to embed or serialize key material in Rust.

When no public key map is configured, local unsigned development snapshots
remain supported. A deployment that enables signed snapshots must configure
the matching public and private key maps; unknown key ids, digest changes and
invalid signatures fail closed.

## Consequences

Signed registry data is now verified at the browser boundary rather than merely
retained as metadata. Public-key rotation can overlap old/new key ids in the
map, while removing an old id immediately rejects snapshots signed by it.
