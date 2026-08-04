// Panel registry: panel definitions (title / area / component). Layout and
// content are decoupled - the Workspace renders whatever is registered, so
// adding a panel (model tree, palette, properties, diagnostics) never
// touches the layout system. See docs/specs/ide-layout.md.

import type { ComponentType } from 'react';
import { Boxes, Palette } from 'lucide-react';
import { AIPanel } from '../ai/AIPanel';
import { ModelCanvas } from '../model/ModelCanvas';
import { VisualizationCanvas } from '../presentation/VisualizationCanvas';
import { ConsolePanel } from './ConsolePanel';
import { ModelInfoPanel } from './ModelInfoPanel';
import { PalettePanel } from './PalettePanel';

export type AreaId = 'left' | 'center' | 'right' | 'bottom';

export type PanelId = 'queue' | 'model' | 'ai' | 'console' | 'modelInfo' | 'palette';

export interface PanelDef {
  title: string;
  area: AreaId;
  component: ComponentType;
}

export const PANELS: Record<PanelId, PanelDef> = {
  // center: the visualization/model workspace.
  queue: { title: 'Visualization', area: 'center', component: VisualizationCanvas },
  model: { title: 'Model', area: 'center', component: ModelCanvas },
  // right: the AI copilot panel.
  ai: { title: 'AI', area: 'right', component: AIPanel },
  // bottom: diagnostics / event stream.
  console: { title: 'Console', area: 'bottom', component: ConsolePanel },
  // left: side panels switched by the activity bar (VS Code style).
  modelInfo: { title: 'Project', area: 'left', component: ModelInfoPanel },
  palette: { title: 'Palette', area: 'left', component: PalettePanel },
};

/** Activity-bar views map 1:1 onto the left side panels. */
export const ACTIVITY_VIEWS: Array<{
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  panel: PanelId;
}> = [
  { id: 'model', label: 'Project', icon: Boxes, panel: 'modelInfo' },
  { id: 'palette', label: 'Palette', icon: Palette, panel: 'palette' },
];

/** Default per-area layout: which panels live where, and the active tab. */
export const DEFAULT_LAYOUT: Record<AreaId, { panels: PanelId[]; active: PanelId }> = {
  left: { panels: ['modelInfo', 'palette'], active: 'modelInfo' },
  center: { panels: ['queue', 'model'], active: 'queue' },
  right: { panels: ['ai'], active: 'ai' },
  bottom: { panels: ['console'], active: 'console' },
};
