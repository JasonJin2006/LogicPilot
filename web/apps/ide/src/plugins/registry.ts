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

export interface PluginRegistryStreamOptions {
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: (
    url: string,
    init?: { headers?: Readonly<Record<string, string>>; signal?: AbortSignal },
  ) => Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly body: ReadableStream<Uint8Array> | null;
  }>;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
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
  private stopStream: (() => void) | null = null;

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
    if (value.generation === this.value.generation) return this.value;
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

  /** Start a reconnecting full-snapshot SSE stream. Applying a malformed or
   * stale snapshot is fail-closed and does not disturb the active generation. */
  startLive(options: PluginRegistryStreamOptions = {}): () => void {
    this.stopLive();
    const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) throw new Error('no fetch implementation available for plugin registry stream');
    const controller = new AbortController();
    let stopped = false;
    let retry = 0;
    const base = options.retryBaseMs ?? 250;
    const max = options.retryMaxMs ?? 10_000;
    if (!Number.isFinite(base) || base < 0 || !Number.isFinite(max) || max < base) {
      throw new Error('plugin registry stream retry bounds are invalid');
    }
    const wait = (delay: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    const consume = async (): Promise<void> => {
      while (!stopped) {
        try {
          const response = await fetchImpl(options.url ?? '/api/plugin-registry/stream', {
            headers: {
              ...(options.headers ?? {}),
              'last-event-id': String(this.value.generation),
            },
            signal: controller.signal,
          });
          if (!response.ok || response.body === null) {
            throw new Error(`plugin registry stream responded with HTTP ${response.status}`);
          }
          retry = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!stopped) {
            const next = await reader.read();
            buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const payload = line.startsWith('data:') ? line.slice(5).trim() : '';
              if (payload) this.apply(JSON.parse(payload));
            }
            if (next.done) break;
          }
          if (buffer.startsWith('data:')) this.apply(JSON.parse(buffer.slice(5).trim()));
          if (!stopped) throw new Error('plugin registry stream ended');
        } catch (error) {
          if (stopped || controller.signal.aborted) return;
          retry += 1;
          await wait(Math.min(max, base * 2 ** Math.min(retry - 1, 8)));
          void error;
        }
      }
    };
    this.stopStream = () => {
      stopped = true;
      controller.abort();
      this.stopStream = null;
    };
    void consume();
    return this.stopStream;
  }

  stopLive(): void {
    this.stopStream?.();
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

export function startPluginRegistryLive(options: PluginRegistryStreamOptions = {}): () => void {
  return PLUGIN_REGISTRY.startLive(options);
}

export function stopPluginRegistryLive(): void {
  PLUGIN_REGISTRY.stopLive();
}
