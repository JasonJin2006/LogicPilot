# ADR-0070: Transactional Plugin Host with Cordis-Compatible Lifecycle

Date: 2026-09-02
Status: Accepted
Implements: `docs/architecture/next-generation-plugin-platform.md` §16 Phase 2

## Context

ADR-0068 moved paradigm wiring behind Workbench registries, but activation was
still a static side-effect import list. Importing a builtin module registered
its document types, palette, validators and panels even when the paradigm was
nominally disabled. There was no discovery layering, dependency ordering,
permission/trust gate, scoped cleanup, installation audit or reliable
zero-paradigm shell gate.

The platform plan recommends the useful Cordis/DeepSeek Harness primitives:
an `apply(ctx)`-style entrypoint, explicit services, events, effects and
configuration-level composition. Directly coupling LogicPilot plugins to the
developer-preview Cordis API would, however, leak a TypeScript-specific
framework into the language-neutral manifest, trust, Artifact Graph and native
runtime contracts frozen by ADR-0069.

## Decision

1. `@logicpilot/plugin-host` is the fixed-core TypeScript host. It consumes the
   generated `PluginManifest v2` and lockfile contracts from
   `@logicpilot/contracts`; it does not invent parallel manifest types.
2. The lifecycle is Cordis-compatible in shape but has no Cordis runtime
   dependency in Phase 2:
   - plugin modules expose `activate(ctx)` and optional `deactivate()`;
   - `ctx.service/provide` supplies services;
   - `ctx.on/emit` supplies events;
   - `ctx.effect` registers automatic reverse-order cleanup.
3. Discovery is layered `system -> user -> workspace`. Later scopes override
   earlier scopes by plugin id; duplicate ids inside one scope fail. Every
   discovery source in a scope participates, and the source—not package data—
   is authoritative for the effective scope.
4. Activation is deterministic and dependency ordered. Manifest validation,
   API-version checks, dependency ranges, permission filtering and trust gates
   run before plugin code. Startup is transactional: a failed activation
   cleans its own effects and rolls back every previously activated plugin.
5. Contribution modules have no registration side effects at module evaluation
   time. Registration occurs only inside plugin activation and every registry
   disposer is attached to the plugin effect scope.
6. The IDE awaits PluginHost activation before importing `App` and the
   persisted layout store. This guarantees that initial layout validation sees
   the complete active panel/document registry. Host failure rolls back and
   then boots the fixed shell without paradigm contributions.
7. Package install, upgrade, uninstall and rollback operate through injected
   storage, a contract-shaped lockfile and an append-only audit log. Dependency
   presence, cycles and version ranges are checked before a lockfile write.
8. `VITE_ZERO_PLUGINS=1` is a product gate, not merely a build option. The
   browser test asserts both visible shell operation and empty paradigm
   registries, then edits a plain file.

## Consequences

- Importing a builtin entrypoint no longer activates it; tests and hosts must
  explicitly register or start the plugin.
- Plugin deactivation removes document, diagnostic, outline, palette, panel,
  properties, focus and problem-source contributions instead of relying on a
  process reload.
- The browser bundle still contains statically mapped builtin entrypoints in
  Phase 2. Filesystem/package discovery and true dynamic import are later
  slices of the same phase; their manifests and lifecycle do not change.
- Cordis can still replace the internal service/event/effect implementation
  behind an adapter after a parity spike. Business plugins must not import
  Cordis directly.
- Model-canvas ownership that remains in the shell is transitional debt for
  the Artifact/View phases; this ADR does not redefine it as permanent core.

## Gate evidence

- Plugin Host unit gate covers layered discovery, multiple sources per scope,
  malformed manifests, dependency order/cycles/ranges, permissions, trust,
  services/events/effects, transactional rollback, audit and package-manager
  operations.
- IDE host tests cover builtin manifests, activation/deactivation and empty
  registries under a zero-plugin host.
- `web/apps/ide/scripts/zero-paradigm-verify.mjs` boots Vite with an empty
  discovery table, verifies empty contribution registries, renders the shell
  and edits a plain file without leaving a background server.
