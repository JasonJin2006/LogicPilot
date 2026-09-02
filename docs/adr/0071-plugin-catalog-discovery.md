# ADR-0071: Phase 2B-1 Plugin Catalog Discovery - Read-Only Scanner, Local Bridge and Remote Discovery Source

Date: 2026-09-02
Status: Accepted
Implements: `docs/architecture/next-generation-plugin-platform.md` §16 Phase 2 (Phase 2B-1
slice: real `system` / `user` / `workspace` catalog discovery without executing third-party code)

## Context

Phase 2A (`f317ec7`, ADR-0070) delivered a transactional host whose discovery is still a
static bundler import map over the two builtin manifests. There is no directory scanning,
no controlled plugin root layout, no filesystem-controlled catalog and no way for a
workspace to contribute a plugin package.

The next slice (Phase 2B-1) must deliver real discovery with these properties:

- Node/app-server-side read-only catalog scanning; the browser never scans the filesystem.
- Strict `plugin.json` validation against the frozen `PluginManifest v2` contract, content
  sha256, normalized scope, duplicate/override handling and a contract-shaped catalog.
- Broken packages produce structured diagnostics and audit entries instead of blocking
  other packages; the host stays transactional (ADR-0070 §4).
- Data-only and manifest-only packages become discoverable; dynamic ESM/WASM execution is
  deferred to Phase 2B-3.
- No absolute paths, arbitrary `file:` URLs or executable strings reach the browser/model.

## Decision

### 1. Package layout

```text
<plugin-root>/
  <package-directory>/
    plugin.json        # PluginManifest v2 (frozen contract, mandatory)
    ...package files   # data assets, entrypoint modules, tests, docs
```

- A package is any immediate subdirectory of a plugin root that contains `plugin.json`.
- The plugin id comes from the manifest, never from the directory name.
- Entrypoint paths inside the manifest are metadata at scan time; loaders are responsible
  for validating them before importing (Phase 2B-3).

### 2. Root layout and configuration

| Scope | Meaning | Default target path (desktop) | Dev wiring |
| --- | --- | --- | --- |
| `system` | shipped with the app | `<app-resources>/plugins` | none (static import map owns builtins) |
| `user` | machine-wide user plugins | `<config-dir>/LogicPilot/plugins` (Windows: `%LOCALAPPDATA%`) | `LOGICPILOT_PLUGIN_ROOTS` |
| `workspace` | per-workspace plugins | `<workspace>/.logicpilot/plugins` | `LOGICPILOT_PLUGIN_ROOTS` |

Bridge/server configuration is a single environment variable:

```text
LOGICPILOT_PLUGIN_ROOTS={"system":["C:/app/plugins"],"user":["C:/Users/x/.../LogicPilot/plugins"],"workspace":["C:/proj/.logicpilot/plugins"]}
```

- Values are absolute paths, or relative paths resolved against the server cwd.
- Missing roots produce a `warning` diagnostic; they never fail the scan.
- Default (unset) is no roots: the catalog is empty and the shell behaves exactly as today.
- Multiple roots per scope are allowed; a root's position in the list is its priority for
  in-scope duplicate ids (earlier root wins).
- Catalog roots must not contain packages whose ids are already statically bundled
  (`logicpilot.des`, `logicpilot.sysml`). Duplicate ids at system scope fail loudly in the
  host (`duplicate-id`), which is an operator configuration error, not a silent override.

### 3. `@logicpilot/plugin-catalog` (Node package)

A read-only scanner + bridge handler. The scanner:

- resolves and realpaths each root; never writes, moves or deletes anything;
- never follows symbolic links: symlinked package directories, symlinked `plugin.json` and
  symlinked payload files are excluded (an escaping symlink is an `error` diagnostic, a
  contained one is a `warning`);
- verifies containment with `realpath` (canonical, case-accurate on Windows) instead of
  string prefix checks: the package's real path must stay inside the root's real path;
- reads `plugin.json` with a size guard (256 KiB), strict `JSON.parse` and
  `validateContract('PluginManifest', …)`;
- records `unsupported-api-version` as a `warning` (the host keeps the final gate,
  ADR-0070 §7);
- computes the package payload digest and compares it with `manifest.integrity.sha256`.

### 4. Canonical payload digest

- Cover exactly: all regular files under the package directory **excluding `plugin.json`**
  (the manifest is self-referential; excluding it removes the fixpoint), sorted by
  posix-normalized relative path (byte-wise order).
- Framing per file: `"<len(relPath)>:<relPath><len(content)>:<content>"` concatenated in
  order; the result is sha256 hex. Length prefixes make the encoding unambiguous.
- Symlinks, sockets and pipes are excluded from the digest (never followed).
- `manifest.integrity.sha256`, when present, must equal the computed digest. A mismatch is
  an `error` diagnostic (`hash-drift`) and the package is excluded from the catalog.
- When absent, the computed digest is published as the entry's `sha256` — the value a
  lockfile entry (Phase 2B-2) would use.

### 5. Catalog envelope (transport, not a frozen contract)

The catalog envelope is a Phase 2B-1 host-side transport type in `@logicpilot/plugin-host`
(`src/catalog.ts`), built from the frozen `PluginManifest` shapes. It is deliberately not
added to `schemas/contracts/` in this slice; if it needs to cross a process boundary as a
stable protocol, it can be frozen later following the ADR-0069 change process.

```text
PluginCatalog { schema: 'logicpilot.plugin-catalog/v1', contractVersion: 1,
                roots[], entries[], diagnostics[] }
PluginCatalogEntry { id, scope, rootId, path, sha256, manifest }
CatalogDiagnostic { severity: 'error'|'warning', kind, message,
                    scope?, rootId?, path?, pluginId? }
```

- `scope` on an entry is the root's scope; a package cannot claim a scope (plan §三.5 /
  §四.5 authority rule — here enforced by construction).
- `rootId` is `"<scope>:<index>"` (1-based); roots expose only ids in the catalog — **no
  absolute paths leave the server**.
- In-scope duplicate ids: the first root (then first path in sort order) wins; later
  duplicates are excluded with an `error` diagnostic. Cross-scope duplicates are retained —
  the host applies the `system -> user -> workspace` overlay (ADR-0070 §3).

### 6. Bridge protocol

`GET /api/plugin-catalog[?scope=system|user|workspace]` on the Vite dev middleware and on
the production app server (so the IDE and the Tauri host share one client path).

- Response: `application/json`, `Cache-Control: no-store`; the envelope above (filtered by
  `scope` when the parameter is present: entries, roots and diagnostics of that scope).
- `scope` values are restricted to the three known scopes; anything else is a 400.
- Non-GET is a 405; scanner/config errors are a 500.
- The bridge exposes **no file content and no paths**; it is the only catalog entry point
  the browser uses. Rescan per request keeps the catalog fresh; catalogs are tiny in this
  slice (caching is a Phase 2B-2 concern).

### 7. Browser side: `RemoteCatalogDiscoverySource` (in `@logicpilot/plugin-host`)

The IDE constructs one source per scope, pointing at the bridge (`?scope=`). Each source:

- validates the envelope and every entry manifest with the frozen contract validator
  (defense in depth; a malformed bridge response is a transport error, never partial data);
- resolves a module only through an injected loader policy. The default policy: plugins
  with **no** `web`/`node`/`wasm`/`native` entrypoint (data-only, manifest-only) load as a
  no-op module; executable entrypoints are **not loadable yet** and are excluded with a
  `loadable` diagnostic (Phase 2B-3 adds the dynamic loader);
- **projects the loadable set before the host sees it**: entries that are unloadable,
  whose non-optional dependencies are missing, whose dependency version ranges are
  unsatisfied, or that live in dependency cycles are excluded — cascading to their
  dependents. The host therefore only ever receives an internally-consistent set and keeps
  its transactional startup (a bad catalog entry can never roll back builtins);
- injects the scanner-computed `sha256` into `manifest.integrity` so the host's lockfile
  projection is complete without touching the frozen schema;
- records skipped entries and diagnostics, exposed through `excludedEntries()` /
  `diagnostics()`, and reports transport failures through `lastError()` / `onError`
  without throwing (a broken bridge degrades to the bundled plugin set, never to a blank
  host).

Known limitation (documented, accepted): the dependency projection is computed per scope.
A workspace plugin whose non-optional dependency lives in another scope is excluded with a
diagnostic rather than resolved cross-scope. Cross-scope dependency resolution is deferred
to Phase 2B-2 (bridge-side projection with the full overlay).

### 8. Audit

The IDE wrapper appends catalog `error` diagnostics and excluded entries to the host audit
log (`error` / `deny` actions) after start. Warnings stay in the catalog payload for the
future catalog UI. No API keys, tokens or absolute paths are ever written to the audit log.

## Consequences

- The static bundler import map remains the loader for `logicpilot.des` / `logicpilot.sysml`
  (Phase 2B-3 replaces it); manifests remain the source of truth and the host decides
  activation (plan §三.1).
- Browser bundle gains only the remote-source code; `@logicpilot/plugin-catalog` is
  Node-only and never reaches the browser.
- The zero-paradigm gate is unaffected: `VITE_ZERO_PLUGINS=1` skips remote sources
  entirely, and unconfigured roots yield an empty catalog.
- Phase 2B-2 uses the scanner's digest and diagnostics as the inputs of the persistent
  PackageStore; no re-scan design change is expected.

## Gate evidence

- `pnpm --filter @logicpilot/plugin-catalog test` — scanner/bridge: invalid JSON, wrong
  schema, unsupported apiVersion, hash drift, duplicate ids (same root/cross root), symlink
  escape, missing roots, dependency diagnostics, digest determinism, bridge 200/400/405/500.
- `pnpm --filter @logicpilot/plugin-host test` — remote source: scope filtering, loader
  policy, projection cascade (missing dep, cycle, version conflict), transport failures,
  manifest digest canonicalization.
- `pnpm --filter @logicpilot/ide run typecheck` / `pnpm test` / `pnpm build` / `format:check`
  / `lint:ci` / `docs:build` — full Web gate, zero-paradigm and browser E2E unchanged.
