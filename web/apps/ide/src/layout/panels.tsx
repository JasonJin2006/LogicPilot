// Panel registry: panel definitions (title / area / component). Layout and
// content are decoupled - the Workspace renders whatever is registered, so
// adding a panel (model tree, palette, properties, diagnostics) never
// touches the layout system. See docs/specs/ide-layout.md.

import type { ComponentType } from 'react';
import { Boxes, Files, Palette } from 'lucide-react';
import { AIPanel } from '../ai/AIPanel';
import { DslEditor } from '../model/DslEditor';
import { ModelWorkspace } from '../model/ModelWorkspace';
import { ConsolePanel } from './ConsolePanel';
import { ExplorerPanel } from './ExplorerPanel';
import { ModelInfoPanel } from './ModelInfoPanel';
import { PalettePanel } from './PalettePanel';
import { PropertiesPanel } from '../model/PropertiesPanel';
import { WelcomePanel } from './WelcomePanel';

export type AreaId = 'left' | 'center' | 'right' | 'bottom';

export type PanelId =
  | 'model'
  | 'ai'
  | 'console'
  | 'dsl'
  | 'explorer'
  | 'modelInfo'
  | 'palette'
  | 'properties'
  | 'welcome';

export interface PanelDef {
  title: string;
  area: AreaId;
  component: ComponentType;
}

export const PANELS: Record<PanelId, PanelDef> = {
  // center: the modeling workspace.
  model: { title: 'Model', area: 'center', component: ModelWorkspace },
  dsl: { title: 'DSL', area: 'center', component: DslEditor },
  welcome: { title: 'Welcome', area: 'center', component: WelcomePanel },
  // right: the AI copilot panel.
  ai: { title: 'AI', area: 'right', component: AIPanel },
  // right: selected block properties.
  properties: { title: 'Properties', area: 'right', component: PropertiesPanel },
  // bottom: diagnostics / event stream.
  console: { title: 'Console', area: 'bottom', component: ConsolePanel },
  // left: side panels switched by the activity bar (VS Code style).
  explorer: { title: 'Explorer', area: 'left', component: ExplorerPanel },
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
  { id: 'explorer', label: 'Explorer', icon: Files, panel: 'explorer' },
  { id: 'model', label: 'Project', icon: Boxes, panel: 'modelInfo' },
  { id: 'palette', label: 'Palette', icon: Palette, panel: 'palette' },
];

/** Default per-area layout: which panels live where, and the active tab. */
export const DEFAULT_LAYOUT: Record<AreaId, { panels: PanelId[]; active: PanelId }> = {
  left: { panels: ['explorer', 'modelInfo', 'palette'], active: 'explorer' },
  center: { panels: ['model', 'dsl'], active: 'model' },
  right: { panels: ['ai', 'properties'], active: 'ai' },
  bottom: { panels: ['console'], active: 'console' },
};
