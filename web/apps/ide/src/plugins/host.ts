// IDE PluginHost wiring (Phase 2): the composition root is no longer a
// static import list (ADR-0068 is superseded by the plugin platform plan).
// Builtin paradigms ship as PluginManifest v2 packages under plugins/builtin
// and activate through @logicpilot/plugin-host with dependency-resolved,
// deterministic ordering, trust gating and an append-only audit trail.
//
// The browser shell has no filesystem; discovery is a static in-memory
// source over the bundled manifests (system scope). A zero-paradigm build
// (empty discovery table) must still boot, render the shell and edit plain
// text files - that is the Phase 2 gate.

import {
  PluginHost,
  type DiscoveredPlugin,
  type DiscoverySource,
  type PluginModule,
  type PluginScope,
} from '@logicpilot/plugin-host';
import type { PluginManifest } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

// Builtin web entrypoints. Bundlers resolve these statically; the manifest
// `entrypoints.web` field documents the mapping for the packaged (non-bundled)
// host, which loads modules dynamically instead.
import { activateDesPlugin } from './builtin/des/activate';
import desManifestJson from './builtin/des/plugin.json';
import { activateSysmlPlugin } from './builtin/sysml/activate';
import sysmlManifestJson from './builtin/sysml/plugin.json';

interface BuiltinPlugin {
  readonly manifestJson: unknown;
  readonly load: () => PluginModule;
}

const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = [
  { manifestJson: desManifestJson, load: activateDesPlugin },
  { manifestJson: sysmlManifestJson, load: activateSysmlPlugin },
];

/** Validates a bundled manifest against the frozen Phase 1 contract and
 *  fails the build-time caller loudly on drift (never silently skip). */
export function parseBuiltinManifest(json: unknown): PluginManifest {
  const validated = validateContract('PluginManifest', json);
  if (!validated.ok) {
    throw new Error(`builtin plugin manifest rejected: ${validated.errors.join('; ')}`);
  }
  return validated.value;
}

/** Turns a builtin package list into a system-scope discovery source. */
function builtinSourceFor(builtins: readonly BuiltinPlugin[], scope: PluginScope): DiscoverySource {
  return {
    scope,
    discover: () => {
      const discovered: DiscoveredPlugin[] = [];
      for (const builtin of builtins) {
        discovered.push({
          manifest: parseBuiltinManifest(builtin.manifestJson),
          scope,
          load: () => builtin.load(),
        });
      }
      return discovered;
    },
  };
}

export interface IdePluginHostOptions {
  /** Empty table = zero-paradigm shell (the Phase 2 gate exercises this). */
  readonly builtins?: readonly BuiltinPlugin[];
}

let host: PluginHost | null = null;
let startPromise: Promise<PluginHost> | null = null;

/** Starts the IDE plugin host. Idempotent: a second call returns the active
 *  host (React StrictMode double-mounts effects in development). */
export async function startIdePluginHost(options: IdePluginHostOptions = {}): Promise<PluginHost> {
  if (host && host.phaseValue === 'active') return host;
  if (startPromise) return startPromise;

  const builtins =
    options.builtins ??
    // Zero-paradigm gate switch (Phase 2): an env flag strips every builtin
    // from discovery so the shell can be exercised with NO plugins at all.
    // Build tooling inlines import.meta.env flags; the default keeps the
    // bundled paradigms.
    (import.meta.env.VITE_ZERO_PLUGINS === '1' || import.meta.env.VITE_PLUGINS === '0'
      ? []
      : BUILTIN_PLUGINS);
  const candidate = new PluginHost({
    sources: [builtinSourceFor(builtins, 'system')],
    onAudit: (entry) => {
      // Expose a neutral event until the shell grows a persistent audit
      // surface. Dev tools and future audit panels can subscribe without the
      // host taking a dependency on a UI/store module.
      if (import.meta.env.DEV) {
        globalThis.dispatchEvent(new CustomEvent('logicpilot:plugin-audit', { detail: entry }));
      }
    },
  });
  host = candidate;
  startPromise = candidate
    .start()
    .then(() => candidate)
    .finally(() => {
      startPromise = null;
    });
  return startPromise;
}

/** Test/zero-paradigm gate helper: boots a host with an EMPTY discovery
 *  table. The shell must still construct and edit plain files. */
export async function startZeroPluginHost(): Promise<PluginHost> {
  return startIdePluginHost({ builtins: [] });
}

/** Stops the active host (tests, HMR teardown). */
export async function stopIdePluginHost(): Promise<void> {
  if (!host) return;
  const current = host;
  host = null;
  if (startPromise) {
    try {
      await startPromise;
    } catch {
      // start() already rolled back partial activation.
    }
  }
  if (current.phaseValue === 'active') {
    await current.stopAll();
  }
}
