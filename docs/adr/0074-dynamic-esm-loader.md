# ADR-0074: Trust-Gated Dynamic ESM/WASM Loaders

Date: 2026-09-02  
Status: Accepted  
Implements: `docs/architecture/next-generation-plugin-platform.md` §16 Phase 2B-3 (first slice)

## Decision

Add Node-only `createDynamicEsmLoader` and `createDynamicWasmLoader` resolvers.
For ESM, catalog entries with a `node` entrypoint are supported. For WASM,
modules must use the fixed capability-free lifecycle ABI described below.
Discovery remains side-effect free: the resolver checks
scope, trust, root/package containment, module extension and the catalog's
manifest-bound package digest, then returns a lazy thunk. The actual `import()`
occurs only when the PluginHost activates the projected entry.

The ESM loader accepts `.mjs`, `.cjs` and `.js` modules exporting either
`activate` directly or a default object with `activate`. Module failures are
wrapped in a typed, path-free error. The existing host lifecycle, capability
grants and trust gate remain authoritative; this loader cannot elevate trust
or bypass permissions.

The WASM loader passes an empty import object, requires
`logicpilot_activate(): void` and optionally calls
`logicpilot_deactivate(): void`. This is a pure sandbox smoke path: it exposes
no host services, WASI, filesystem, network or process imports. A richer WASM
host ABI, native loading and browser filesystem transport require separate
contracts.

## Invariants

- The requested scope must match the catalog entry's authoritative scope.
- Entrypoints are relative and must resolve inside the real package directory.
- The digest is recomputed before import and compared case-insensitively with
  the catalog digest.
- Trust below `manifest.trust.minLevel` excludes the entry before activation.
- No raw filesystem path or loader exception crosses the catalog bridge.

## Gate evidence

- Dynamic loader tests cover lazy import, digest verification, trust denial and
  digest drift.
- Plugin-host tests cover asynchronous lazy-loader activation semantics.
- Existing catalog, host, full build and desktop self-contained gates remain
  required before enabling the loader in a production host.
