import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { PluginContributionSet, PluginManifest, PluginScope } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import type { PluginCatalogEntry } from '@logicpilot/plugin-host';
import type { PluginRootConfig } from './catalog.js';

export interface ContributionLoadResult {
  readonly sets: readonly PluginContributionSet[];
  readonly errors: readonly string[];
}

/** Reads the optional package-local contributions.json for approved catalog
 * entries. The file is data-only; executable plugins still activate through
 * their loader and cannot smuggle arbitrary contribution objects across the
 * bridge. */
export function loadContributionSets(
  entries: readonly PluginCatalogEntry[],
  roots: readonly PluginRootConfig[],
): ContributionLoadResult {
  const rootsById = new Map<string, string>();
  const counters = new Map<PluginScope, number>();
  for (const root of roots) {
    const index = (counters.get(root.scope) ?? 0) + 1;
    counters.set(root.scope, index);
    rootsById.set(`${root.scope}:${index}`, resolve(root.path));
  }
  const sets: PluginContributionSet[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    const root = rootsById.get(entry.rootId);
    if (!root) continue;
    let packageDir: string;
    try {
      packageDir = realpathSync(resolve(root, entry.path));
      const rel = relative(resolve(root), packageDir);
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('outside root');
    } catch {
      continue;
    }
    const path = join(packageDir, 'contributions.json');
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      const validated = validateContract('PluginContributionSet', parsed);
      if (!validated.ok) throw new Error(validated.errors.join('; '));
      if (
        validated.value.pluginId !== entry.manifest.id ||
        validated.value.version !== entry.manifest.version
      ) {
        throw new Error('pluginId/version does not match manifest');
      }
      sets.push(validated.value);
    } catch {
      errors.push(`plugin '${entry.id}' contributions are invalid`);
    }
  }
  return { sets, errors };
}

export type ContributionManifest = PluginManifest;
