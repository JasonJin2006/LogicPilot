import type { PluginContributionSet, PluginRegistry } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';

export interface PluginRegistrySnapshot {
  readonly generation: number;
  readonly plugins: readonly string[];
  readonly contributions: readonly PluginContributionSet[];
}

export interface PluginRegistryFetchOptions {
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: (
    url: string,
    init?: { headers?: Readonly<Record<string, string>> },
  ) => Promise<{
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
  }>;
}

export interface StructuredPaletteItem {
  readonly kind: string;
  readonly library: string;
  readonly name: string;
  readonly hint: string;
}

/** Browser-side generation store. A complete payload is validated before the
 * active snapshot changes, so a broken update cannot partially remove or add
 * UI/knowledge contributions. */
export class PluginRegistryStore {
  private value: PluginRegistrySnapshot = { generation: 0, plugins: [], contributions: [] };
  private readonly listeners = new Set<() => void>();

  snapshot(): PluginRegistrySnapshot {
    return this.value;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  apply(payload: unknown): PluginRegistrySnapshot {
    const validated = validateContract('PluginRegistry', payload);
    if (!validated.ok)
      throw new Error(`invalid plugin registry payload: ${validated.errors.join('; ')}`);
    const value: PluginRegistry = validated.value;
    for (const contribution of value.contributions) {
      if (!value.plugins.includes(contribution.pluginId)) {
        throw new Error(`invalid plugin contribution: unknown plugin '${contribution.pluginId}'`);
      }
    }
    if (value.generation < this.value.generation)
      throw new Error('stale plugin registry generation');
    this.value = {
      generation: value.generation,
      plugins: value.plugins,
      contributions: value.contributions,
    };
    for (const listener of this.listeners) listener();
    return this.value;
  }

  async refresh(options: PluginRegistryFetchOptions = {}): Promise<PluginRegistrySnapshot> {
    const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) throw new Error('no fetch implementation available for plugin registry');
    const response = await fetchImpl(options.url ?? '/api/plugin-registry', {
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    });
    if (!response.ok)
      throw new Error(`plugin registry bridge responded with HTTP ${response.status}`);
    return this.apply(await response.json());
  }

  paletteItems(): readonly StructuredPaletteItem[] {
    return this.value.contributions.flatMap((set) =>
      set.palettes.map((item) => ({
        kind: item.itemKind,
        library: `${set.pluginId}:${item.id}`,
        name: item.label,
        hint: item.semanticType,
      })),
    );
  }
}

export const PLUGIN_REGISTRY = new PluginRegistryStore();

export function structuredPaletteItems(): readonly StructuredPaletteItem[] {
  return PLUGIN_REGISTRY.paletteItems();
}

export function subscribePluginRegistry(listener: () => void): () => void {
  return PLUGIN_REGISTRY.subscribe(listener);
}

export function pluginRegistryGeneration(): number {
  return PLUGIN_REGISTRY.snapshot().generation;
}
