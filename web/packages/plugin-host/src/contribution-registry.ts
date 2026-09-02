import type { PluginContributionSet } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface ContributionRegistrySnapshot {
  readonly generation: number;
  readonly sets: readonly PluginContributionSet[];
}

export interface PreparedContributionGeneration {
  readonly generation: number;
  readonly sets: readonly PluginContributionSet[];
}

/** Atomic registry for structured plugin contributions. It is deliberately
 * independent of rendering or transport: the IDE bridge and a Node host use
 * the same validate/prepare/commit semantics. */
export class ContributionRegistry {
  private activeValue: ContributionRegistrySnapshot = { generation: 0, sets: [] };
  private readonly listeners = new Set<(snapshot: ContributionRegistrySnapshot) => void>();

  snapshot(): ContributionRegistrySnapshot {
    return this.activeValue;
  }

  subscribe(listener: (snapshot: ContributionRegistrySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  prepare(input: readonly unknown[]): PreparedContributionGeneration {
    const sets: PluginContributionSet[] = [];
    const pluginIds = new Set<string>();
    const contributionIds = new Set<string>();
    for (const raw of input) {
      const validated = validateContract('PluginContributionSet', raw);
      if (!validated.ok)
        throw new Error(`invalid plugin contributions: ${validated.errors.join('; ')}`);
      const set = validated.value;
      if (pluginIds.has(set.pluginId))
        throw new Error(`duplicate contribution plugin '${set.pluginId}'`);
      pluginIds.add(set.pluginId);
      for (const id of allContributionIds(set)) {
        if (contributionIds.has(id)) throw new Error(`duplicate contribution id '${id}'`);
        contributionIds.add(id);
      }
      sets.push(set);
    }
    return { generation: this.activeValue.generation + 1, sets };
  }

  commit(prepared: PreparedContributionGeneration): ContributionRegistrySnapshot {
    if (prepared.generation !== this.activeValue.generation + 1) {
      throw new Error('stale contribution generation');
    }
    const snapshot: ContributionRegistrySnapshot = {
      generation: prepared.generation,
      sets: prepared.sets,
    };
    this.activeValue = snapshot;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Registry observers cannot break an atomic commit.
      }
    }
    return snapshot;
  }
}

function allContributionIds(set: PluginContributionSet): readonly string[] {
  return [
    ...set.knowledge.map((item) => item.id),
    ...set.skills.map((item) => item.id),
    ...set.instructions.map((item) => item.id),
    ...set.diagnostics.map((item) => item.id),
    ...set.views.map((item) => item.id),
    ...set.palettes.map((item) => item.id),
    ...set.tools.map((item) => item.id),
  ];
}
