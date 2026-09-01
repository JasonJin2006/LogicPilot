// Deterministic plugin dependency resolution with cycle detection.
// Implements the Phase 1 "dependency cycle" gate: manifests whose requires
// graph contains cycles, or that depend on missing non-optional plugins, are
// rejected before activation.
import type { PluginManifest } from './generated/contracts.js';

export interface ResolutionInput {
  readonly id: string;
  readonly version: string;
  readonly provides: readonly string[];
  readonly requires: readonly {
    readonly id: string;
    readonly range?: string;
    readonly optional?: boolean;
  }[];
}

export type ResolutionResult =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly missing: readonly string[]; readonly cycles: readonly string[] };

export function toResolutionInput(manifest: PluginManifest): ResolutionInput {
  return {
    id: manifest.id,
    version: manifest.version,
    provides: manifest.provides,
    requires: manifest.requires,
  };
}

/** Resolves activation order (dependencies first). Deterministic: stable by plugin id. */
export function resolveActivationOrder(plugins: readonly ResolutionInput[]): ResolutionResult {
  const byId = new Map<string, ResolutionInput>();
  for (const plugin of [...plugins].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (byId.has(plugin.id)) {
      return { ok: false, missing: [], cycles: [`duplicate plugin id: ${plugin.id}`] };
    }
    byId.set(plugin.id, plugin);
  }

  const missing: string[] = [];
  for (const plugin of byId.values()) {
    for (const dep of plugin.requires) {
      if (dep.optional || byId.has(dep.id)) continue;
      missing.push(`${plugin.id} -> ${dep.id}`);
    }
  }
  if (missing.length > 0) return { ok: false, missing, cycles: [] };

  // Cycle detection via DFS with an on-stack marker.
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  const cycles: string[] = [];
  const stack: string[] = [];

  const visit = (id: string): void => {
    const marker = state.get(id);
    if (marker === 'done') return;
    if (marker === 'visiting') {
      const start = stack.indexOf(id);
      cycles.push(
        stack
          .slice(start >= 0 ? start : 0)
          .concat(id)
          .join(' -> '),
      );
      return;
    }
    const plugin = byId.get(id);
    if (!plugin) return;
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of plugin.requires) {
      visit(dep.id);
    }
    stack.pop();
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of byId.keys()) visit(id);

  if (cycles.length > 0) return { ok: false, missing: [], cycles };
  return { ok: true, order };
}

/** Satisfies a version range: exact, caret (^), tilde (~), >=, or *. */
export function satisfiesRange(version: string, range: string | undefined): boolean {
  if (range === undefined || range === '*' || range === '') return true;
  const parse = (v: string): readonly number[] | undefined => {
    const core = v.split('-')[0] ?? '';
    const parts = core.split('.');
    if (parts.length !== 3) return undefined;
    const nums = parts.map((p) => Number.parseInt(p, 10));
    if (nums.some((n) => Number.isNaN(n))) return undefined;
    return nums;
  };
  const target = parse(version);
  const bound = parse(range.replace(/^[^0-9]*/, ''));
  if (!target || !bound) return false;
  const [targetMajor = 0, targetMinor = 0] = target;
  const [boundMajor = 0, boundMinor = 0] = bound;
  const compare = (a: readonly number[], b: readonly number[]): number => {
    for (let i = 0; i < 3; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      if (ai !== bi) return ai - bi;
    }
    return 0;
  };
  if (range.startsWith('^')) {
    return compare(target, bound) >= 0 && targetMajor === boundMajor;
  }
  if (range.startsWith('~')) {
    return compare(target, bound) >= 0 && targetMajor === boundMajor && targetMinor === boundMinor;
  }
  if (range.startsWith('>=')) {
    return compare(target, bound) >= 0;
  }
  return compare(target, bound) === 0;
}
