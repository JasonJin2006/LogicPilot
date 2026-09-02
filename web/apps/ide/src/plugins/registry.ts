import type { PluginContributionSet } from '@logicpilot/contracts';
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
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('invalid plugin registry payload');
    }
    const value = payload as Record<string, unknown>;
    if (
      value.schema !== 'logicpilot.plugin-registry/v1' ||
      value.contractVersion !== 1 ||
      typeof value.generation !== 'number' ||
      !Array.isArray(value.plugins) ||
      !Array.isArray(value.contributions)
    ) {
      throw new Error('invalid plugin registry envelope');
    }
    const contributions: PluginContributionSet[] = [];
    for (const raw of value.contributions) {
      const validated = validateContract('PluginContributionSet', raw);
      if (!validated.ok)
        throw new Error(`invalid plugin contribution: ${validated.errors.join('; ')}`);
      if (!value.plugins.includes(validated.value.pluginId)) {
        throw new Error(
          `invalid plugin contribution: unknown plugin '${validated.value.pluginId}'`,
        );
      }
      contributions.push(validated.value);
    }
    const plugins = value.plugins.filter((plugin): plugin is string => typeof plugin === 'string');
    if (plugins.length !== value.plugins.length) throw new Error('invalid plugin registry ids');
    if (value.generation < this.value.generation)
      throw new Error('stale plugin registry generation');
    this.value = { generation: value.generation, plugins, contributions };
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
}

export const PLUGIN_REGISTRY = new PluginRegistryStore();
