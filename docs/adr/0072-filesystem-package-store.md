# ADR-0072: File-System Package Store with Lockfile CAS and Durable Audit

Date: 2026-09-02
Status: Accepted
Implements: `docs/architecture/next-generation-plugin-platform.md` §16 Phase 2B-2 (first slice)

## Context

Phase 2B-1 delivered a read-only catalog scanner and a `PackageManager` whose
storage was only an injected test abstraction. A real desktop installation
needs a crash-safe lockfile, rollback snapshots, optimistic concurrency and a
durable audit trail, while keeping all filesystem access out of the browser.

## Decision

1. `FileSystemPackageStore` lives in the Node-only `@logicpilot/plugin-catalog`
   package. It implements the `PackageStore` contract from
   `@logicpilot/plugin-host`; the browser never imports or receives a
   filesystem handle.
2. The store owns a dedicated directory containing:
   - `logicpilot.lock`;
   - `logicpilot.lock.snapshot`;
   - `plugin-audit.jsonl`;
   - a transient `logicpilot.lock.mutex` during conditional writes.
     Filenames are simple child names; caller-provided separators and dot names
     are rejected.
3. Lockfiles and snapshots are validated against the generated
   `PluginLockfile` contract on every read and write. Invalid JSON or schema
   drift is a typed `invalid-lockfile` error.
4. `readLockfileState()` returns the validated lockfile and a canonical
   SHA-256 version token in one operation. `writeLockfileIfVersion()` obtains
   an OS-exclusive mutex, rechecks the token and performs crash-recoverable
   temporary-file replacement. A stale writer receives a typed `conflict`
   error instead of overwriting a newer lockfile.
5. PackageManager uses the state token and conditional write whenever the
   store supports it; older in-memory test stores use the explicit legacy
   write fallback. PackageManager actions are sent to an optional durable
   `appendAudit` sink after being appended to the in-memory AuditLog.
6. Audit records are JSONL append operations with bounded detail text. Reads
   enforce a byte limit before loading the file, and no raw filesystem paths,
   credentials or tokens are accepted as audit data by the store.
7. Package directory staging and atomic package-tree swap are specified in
   ADR-0073. Cross-scope overlay resolution remains a separate Phase 2B-2
   concern. This ADR does not claim that installing executable code is safe;
   dynamic ESM/WASM loading remains Phase 2B-3.

## Consequences

- Desktop staging can use the same bundled Node scanner and store without
  requiring repository `node_modules`.
- Lockfile formatting changes do not change the version token, while semantic
  lockfile changes do.
- The mutex is transient and is removed in a `finally` path. A future crash
  recovery slice must add stale-mutex ownership/expiry before allowing a
  process to remove another process's lock.
- The current store writes lockfile and package-tree files atomically per
  operation and compensates lockfile failures. ADR-0073 adds a durable
  transaction journal for recovery after process death; stale mutex expiry is
  still a separate hardening item.

## Gate evidence

- FileSystemPackageStore tests cover strict lockfile validation, safe names,
  nested directory creation, canonical version tokens, conditional conflict,
  snapshot/rollback, bounded audit reads and PackageManager audit persistence.
- `pnpm --filter @logicpilot/plugin-catalog test` and
  `pnpm --filter @logicpilot/plugin-host test` pass with the store integration.
- `pnpm desktop:stage` and `pnpm desktop:test-staged` pass with the bundled
  Node runtime; the existing native, IDE and browser gates remain green.
