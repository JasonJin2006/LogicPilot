// Panel registry: panel definitions (title / area / component). Layout and
// content are decoupled - the Workspace renders whatever is registered, so
// adding a panel (model tree, palette, properties, diagnostics) never
// touches the layout system. See docs/specs/ide-layout.md.

import type { ComponentType } from 'react';
import { Boxes, Palette, Play } from 'lucide-react';
import { AIPanel } from '../ai/AIPanel';
import { QueueView } from '../run/QueueView';
import { ConsolePanel } from './ConsolePanel';
import { ModelInfoPanel } from './ModelInfoPanel';
import { PalettePanel } from './PalettePanel';
import { RunInfoPanel } from './RunInfoPanel';

export type AreaId = 'left' | 'center' | 'right' | 'bottom';

export type PanelId = 'queue' | 'ai' | 'console' | 'modelInfo' | 'palette' | 'runInfo';

export interface PanelDef {
  title: string;
  area: AreaId;
  component: ComponentType;
}

export const PANELS: Record<PanelId, PanelDef> = {
  // center: the visualization/model workspace.
  queue: { title: 'Queue', area: 'center', component: QueueView },
  // right: the AI copilot panel.
  ai: { title: 'AI', area: 'right', component: AIPanel },
  // bottom: diagnostics / event stream.
  console: { title: 'Console', area: 'bottom', component: ConsolePanel },
  // left: side panels switched by the activity bar (VS Code style).
  modelInfo: { title: 'Model', area: 'left', component: ModelInfoPanel },
  palette: { title: 'Palette', area: 'left', component: PalettePanel },
  runInfo: { title: 'Run', area: 'left', component: RunInfoPanel },
};

/** Activity-bar views map 1:1 onto the left side panels. */
export const ACTIVITY_VIEWS: Array<{
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  panel: PanelId;
}> = [
  { id: 'model', label: 'Model', icon: Boxes, panel: 'modelInfo' },
  { id: 'palette', label: 'Palette', icon: Palette, panel: 'palette' },
  { id: 'run', label: 'Run', icon: Play, panel: 'runInfo' },
];

/** Default per-area layout: which panels live where, and the active tab. */
export const DEFAULT_LAYOUT: Record<AreaId, { panels: PanelId[]; active: PanelId }> = {
  left: { panels: ['modelInfo', 'palette', 'runInfo'], active: 'modelInfo' },
  center: { panels: ['queue'], active: 'queue' },
  right: { panels: ['ai'], active: 'ai' },
  bottom: { panels: ['console'], active: 'console' },
};
