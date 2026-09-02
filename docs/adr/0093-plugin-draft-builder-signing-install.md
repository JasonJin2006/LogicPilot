# ADR-0093: Signed Plugin Draft Packaging and Installation

Date: 2026-09-03  
Status: Accepted  
Implements: Phase 7 package builder/signing first slice

## Decision

`PluginDraftPackageBuilder` materializes an approved or published draft into a
minimal package containing `plugin.json` and `contributions.json`. It computes
the existing manifest-bound content digest, signs that digest with an injected
Ed25519 signer, writes the signature and key id into `manifest.integrity`, and
publishes the package under its digest as the content-addressed directory.

The app-server `install` action requires an approved/published draft, a
configured signing key and `FileSystemPackageStore`; it then calls the existing
`PackageManager.install` with approved permission grants. Build/signing failure
or package-store failure leaves the lockfile unchanged. `PackageManager` now
requires an injected verifier for any manifest that declares a signature, so a
signature is checked before package staging. The private key is never persisted
in the draft or package.

## Consequences

An approved structured draft can now cross the same digest, trust, permission,
dependency and lockfile gates as any other plugin. The builder currently
materializes data contributions only; arbitrary assets, registry publishing and
key rotation remain follow-up work.
