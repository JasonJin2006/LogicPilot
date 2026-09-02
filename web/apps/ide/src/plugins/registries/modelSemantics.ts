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
const processProvider: ModelSemanticProvider = Object.freeze({
  id: 'logicpilot-process',
  blockPorts,
  isExecutableProcessKind,
  portGlyphPoint,
});

const providers = new Map<string, ModelSemanticProvider>([[processProvider.id, processProvider]]);

export function registerModelSemanticProvider(provider: ModelSemanticProvider): () => void {
  if (providers.has(provider.id))
    throw new Error(`model semantic provider '${provider.id}' already exists`);
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

export function modelSemanticProviders(): readonly ModelSemanticProvider[] {
  return [...providers.values()];
}

export function modelBlockPorts(kind: string) {
  return providers.values().next().value?.blockPorts(kind) ?? [];
}

export function modelIsExecutableProcessKind(kind: string): boolean {
  return providers.values().next().value?.isExecutableProcessKind(kind) ?? false;
}

export function modelPortGlyphPoint(
  kind: string,
  port: string,
  direction: Parameters<typeof portGlyphPoint>[2],
) {
  return (
    providers.values().next().value?.portGlyphPoint(kind, port, direction) ??
    (direction === 'in' ? [7, 20] : [33, 20])
  );
}

export { BLOCK_DEFS, CANVAS_CONTAINER_KINDS };
