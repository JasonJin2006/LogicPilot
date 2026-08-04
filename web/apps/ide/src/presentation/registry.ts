// Presentation registry (AnyLogic-style): every model element type registers
// a rendering component. The model-root canvas composes the presentations of
// its elements, and the same registry drives block icons in the editor.

import type { ComponentType } from 'react';
import type { VizAgent } from '../state/vizState';

export type SceneElementKind = 'source' | 'queue' | 'service' | 'resource' | 'sink';

export interface SceneElement {
  id: string;
  kind: SceneElementKind;
  name: string;
  x: number;
  y: number;
}

/** Runtime state sampled from telemetry frames (shared viz state). */
export interface PresentationRuntime {
  agents: ReadonlyMap<string, VizAgent>;
  servers: number;
  busy: boolean;
  downServers: number;
}

export interface PresentationProps {
  element: SceneElement;
  runtime: PresentationRuntime;
}

export type PresentationComponent = ComponentType<PresentationProps>;

export const PRESENTATIONS: Record<SceneElementKind, PresentationComponent> = {
  source: () => null,
  queue: () => null,
  service: () => null,
  resource: () => null,
  sink: () => null,
};

export function registerPresentation(
  kind: SceneElementKind,
  component: PresentationComponent,
): void {
  PRESENTATIONS[kind] = component;
}
