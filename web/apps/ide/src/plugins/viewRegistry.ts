import type { CreateAction, NotationPack, ViewDefinition } from '@logicpilot/contracts';
import { PLUGIN_REGISTRY, subscribePluginRegistry, pluginRegistryGeneration } from './registry';

export function activeViews(): readonly ViewDefinition[] {
  return PLUGIN_REGISTRY.snapshot().contributions.flatMap((set) => set.views);
}

export function activeViewsForCanvas(canvas: ViewDefinition['canvas']): readonly ViewDefinition[] {
  return activeViews().filter((view) => view.canvas === canvas);
}

export function activeNotations(): readonly NotationPack[] {
  return PLUGIN_REGISTRY.snapshot().contributions.flatMap((set) => set.notations);
}

export function activeCreateActions(): readonly CreateAction[] {
  return PLUGIN_REGISTRY.snapshot().contributions.flatMap((set) => set.createActions);
}

export { pluginRegistryGeneration, subscribePluginRegistry };
