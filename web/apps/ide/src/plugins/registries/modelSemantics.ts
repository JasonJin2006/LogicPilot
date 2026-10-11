import {
  BLOCK_DEFS,
  CANVAS_CONTAINER_KINDS,
  blockPorts,
  isExecutableProcessKind,
  portGlyphPoint,
} from '../../model/blockDefs';

export interface ModelSemanticProvider {
  readonly id: string;
  /** Returns whether this provider owns the semantic kind. Providers that do
   * not declare a resolver remain usable as the sole provider for legacy
   * fixtures, but are never allowed to win a multi-provider dispatch by map
   * insertion order. */
  readonly supports?: (kind: string) => boolean;
  readonly blockPorts: typeof blockPorts;
  readonly isExecutableProcessKind: typeof isExecutableProcessKind;
  readonly portGlyphPoint: typeof portGlyphPoint;
}

/** Runtime seam for model-semantic contributions. The Process provider is the
 * initial builtin implementation; future Process/Statechart/Agent plugins can
 * register providers without changing state or canvas consumers. */
export const PROCESS_MODEL_SEMANTIC_PROVIDER: ModelSemanticProvider = Object.freeze({
  id: 'logicpilot-process',
  supports: (kind: string) => BLOCK_DEFS.some((definition) => definition.kind === kind),
  blockPorts,
  isExecutableProcessKind,
  portGlyphPoint,
});

const providers = new Map<string, ModelSemanticProvider>();
let fallbackEnabled = true;

export function registerModelSemanticProvider(provider: ModelSemanticProvider): () => void {
  if (providers.has(provider.id))
    throw new Error(`model semantic provider '${provider.id}' already exists`);
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

/** Controls the local fallback used by isolated model tests. Zero-paradigm
 * boot disables it so no Process semantics survive without a plugin. */
export function setModelSemanticFallbackEnabled(enabled: boolean): void {
  fallbackEnabled = enabled;
}

export function modelSemanticProviders(): readonly ModelSemanticProvider[] {
  if (providers.size > 0) return [...providers.values()];
  return fallbackEnabled ? [PROCESS_MODEL_SEMANTIC_PROVIDER] : [];
}

export function modelBlockPorts(kind: string) {
  return resolveProvider(kind)?.blockPorts(kind) ?? [];
}

export function modelIsExecutableProcessKind(kind: string): boolean {
  return resolveProvider(kind)?.isExecutableProcessKind(kind) ?? false;
}

export function modelPortGlyphPoint(
  kind: string,
  port: string,
  direction: Parameters<typeof portGlyphPoint>[2],
) {
  return (
    resolveProvider(kind)?.portGlyphPoint(kind, port, direction) ??
    (direction === 'in' ? [7, 20] : [33, 20])
  );
}

function resolveProvider(kind: string): ModelSemanticProvider | undefined {
  const candidates = modelSemanticProviders();
  if (candidates.length === 1) return candidates[0];
  const matches = candidates.filter((provider) => provider.supports?.(kind) === true);
  if (matches.length > 1) {
    throw new Error(`ambiguous model semantic kind '${kind}'`);
  }
  return matches[0];
}

export { BLOCK_DEFS, CANVAS_CONTAINER_KINDS };
