# ADR-0107: Rotatable Plugin Signature Keyring

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 7 signing key rotation

## Decision

`PluginSignatureKeyring` verifies manifest signatures by `signedBy` key id and
supports explicit add/remove rotation. The app-server may load multiple PEM
public keys from `LOGICPILOT_PLUGIN_SIGNING_PUBLIC_KEYS`; the signing private
key is used only to build a package, while installation verifies against the
keyring before staging or lockfile mutation.

Unknown, malformed or retired key ids fail closed. Package content digests do
not change during key rotation because signatures live in the manifest
integrity envelope excluded from canonical payload hashing.

## Consequences

Operators can overlap old/new public keys during rotation and retire an old
key without rebuilding every package. Key storage and distribution remain
deployment responsibilities; private keys never enter drafts, packages or
client payloads.
