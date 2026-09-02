# ADR-0073: Controlled Package-Tree Transactions and Management Query

Date: 2026-09-02  
Status: Accepted  
Implements: `docs/architecture/next-generation-plugin-platform.md` §16 Phase 2B-2 (third slice)

## Decision

`FileSystemPackageStore` owns two additional directories below its dedicated
store root: `plugins/` for installed package trees and `.plugin-staging/` for
short-lived transaction state. Install and upgrade first recompute the
canonical bounded package digest, copy the complete tree without following
symlinks, and then atomically rename the staged tree into place. The previous
tree is retained as a tombstone until the lockfile write succeeds. A failed
lockfile write restores that tombstone; a successful write finalizes it.

Uninstall uses the same move-to-tombstone protocol. The package manager only
invokes these hooks when a store advertises them, so in-memory stores remain
valid test doubles, but a supplied `packagePath` is rejected if the store
cannot provide directory transactions. No executable module is loaded by this
slice.

The Node bridge exposes `GET /api/plugins` as a read-only management view. It
contains the validated catalog, installed lock entries, package directory
names and sanitized audit metadata. Source paths and free-form audit details
are omitted before crossing the HTTP boundary.

## Security and recovery invariants

- Package ids and all transaction paths are simple children contained below
  the store root; symlink entries are rejected.
- The source manifest must validate, match the requested manifest exactly, and
  produce the requested digest before copying begins.
- Staging and lockfile replacement are separate filesystem operations; the
  manager compensates a lockfile failure by rolling back the package tree.
  Crash recovery for a process that dies between those operations remains a
  follow-up journal/recovery slice.
- Dynamic ESM/WASM/native loading is not part of this endpoint or store.

## Gate evidence

- Package-tree stage/commit/finalize/rollback/removal tests pass.
- PackageManager verifies rollback on a failed lockfile write.
- The management bridge test verifies catalog response shape and path
  redaction.
