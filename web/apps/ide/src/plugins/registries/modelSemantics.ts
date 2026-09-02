import {
  BLOCK_DEFS,
  CANVAS_CONTAINER_KINDS,
  blockPorts,
  isExecutableProcessKind,
  portGlyphPoint,
} from '../../model/blockDefs';

export interface ModelSemanticProvider {
  readonly id: string;
  readonly blockPorts: typeof blockPorts;
  readonly isExecutableProcessKind: typeof isExecutableProcessKind;
  readonly portGlyphPoint: typeof portGlyphPoint;
}

/** Runtime seam for model-semantic contributions. The Process provider is the
 * initial builtin implementation; future Process/Statechart/Agent plugins can
 * register providers without changing state or canvas consumers. */
export const PROCESS_MODEL_SEMANTIC_PROVIDER: ModelSemanticProvider = Object.freeze({
  id: 'logicpilot-process',
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
  return modelSemanticProviders()[0]?.blockPorts(kind) ?? [];
}

export function modelIsExecutableProcessKind(kind: string): boolean {
  return modelSemanticProviders()[0]?.isExecutableProcessKind(kind) ?? false;
}

export function modelPortGlyphPoint(
  kind: string,
  port: string,
  direction: Parameters<typeof portGlyphPoint>[2],
) {
  return (
    modelSemanticProviders()[0]?.portGlyphPoint(kind, port, direction) ??
    (direction === 'in' ? [7, 20] : [33, 20])
  );
}

export { BLOCK_DEFS, CANVAS_CONTAINER_KINDS };
