// Panel registry: panel definitions (title / area / component). Layout and
// content are decoupled - the Workspace renders whatever is registered, so
// adding a panel (model tree, palette, properties, diagnostics) never
// touches the layout system. See docs/specs/ide-layout.md.
//
// The registry is open (plan §13: no core table of language panels): built-in
// shell panels register below, language extensions add theirs through
// registerPanel() from their own contribution modules.

import type { ComponentType } from 'react';
import { Boxes, Files, Palette, Puzzle } from 'lucide-react';
import { AIPanel } from '../ai/AIPanel';
import { DslEditor, ModelWorkspace } from '../plugins/registries/panelComponents';
import { ConsolePanel } from './ConsolePanel';
import { ExplorerPanel } from './ExplorerPanel';
import { ModelInfoPanel } from './ModelInfoPanel';
import { PalettePanel } from './PalettePanel';
import { ProblemsPanel } from './ProblemsPanel';
import { PropertiesHost } from './PropertiesHost';
import { WelcomePanel } from './WelcomePanel';
import { useModelStore } from '../state/modelStore';
import { PluginDraftsPanel } from './PluginDraftsPanel';

export type AreaId = 'left' | 'center' | 'right' | 'bottom';

/** Open-ended panel id: built-ins below plus anything registered through
 *  registerPanel() by language contributions. */
export type PanelId = string;

export interface PanelDef {
  title: string;
  area: AreaId;
  component: ComponentType;
  /** Selection-driven focus probe. When it returns true the workspace brings
   *  this panel forward; checked over the registry before falling back to
   *  the area's default tab. Lets a language own its properties-panel rule
   *  instead of the workspace branching on selections. */
  focus?: () => boolean;
}

/** Extra focus probes contributed by plugins (plan §5.1: the shell never
 *  names a paradigm). Each probe participates in focusedPanelId(); plugins
 *  register theirs alongside their panels so a language owns its
 *  properties-panel rule without a core edit. */
const contributedFocusProbes = new Set<() => boolean>();

/** Register a focus probe from a plugin contribution. Returns its disposer. */
export function registerFocusProbe(probe: () => boolean): () => void {
  contributedFocusProbes.add(probe);
  return () => {
    contributedFocusProbes.delete(probe);
  };
}

const registry: Record<PanelId, PanelDef> = {
  // center: the modeling workspace.
  model: { title: 'Model', area: 'center', component: ModelWorkspace },
  dsl: { title: 'DSL', area: 'center', component: DslEditor },
  welcome: { title: 'Welcome', area: 'center', component: WelcomePanel },
  // right: the AI copilot panel.
  ai: { title: 'AI', area: 'right', component: AIPanel },
  // right: properties host - one Properties tab whose content the active
  // document kind decides; focused while any known selection store has a
  // selection (probes from plugins add their own rules below).
  properties: {
    title: 'Properties',
    area: 'right',
    component: PropertiesHost,
    focus: () => useModelStore.getState().selectedId !== null,
  },
  // bottom: diagnostics / event stream.
  console: { title: 'Console', area: 'bottom', component: ConsolePanel },
  // bottom: aggregated, navigable problems across document kinds.
  problems: { title: 'Problems', area: 'bottom', component: ProblemsPanel },
  // left: side panels switched by the activity bar (VS Code style).
  explorer: { title: 'Explorer', area: 'left', component: ExplorerPanel },
  modelInfo: { title: 'Project', area: 'left', component: ModelInfoPanel },
  palette: { title: 'Palette', area: 'left', component: PalettePanel },
  pluginDrafts: { title: 'Plugin Drafts', area: 'left', component: PluginDraftsPanel },
};

/** Register a panel at runtime (language contributions). Duplicate ids are
 *  rejected so two contributions cannot silently steal one tab. */
export function registerPanel(id: PanelId, definition: PanelDef): () => void {
  if (id in registry) {
    throw new Error(`panel '${id}' is already registered`);
  }
  registry[id] = definition;
  return () => {
    delete registry[id];
  };
}

/** The visible panel table (built-ins + registered contributions). */
export const PANELS = registry as Readonly<Record<PanelId, PanelDef>>;

/** First panel in `area` whose focus probe fires (panel probes plus any
 *  plugin-contributed probes), or null when nothing claims focus (the
 *  workspace then falls back to its default tab). */
export function focusedPanelId(area: AreaId): PanelId | null {
  for (const [id, definition] of Object.entries(PANELS)) {
    if (definition.area === area && definition.focus?.()) {
      return id;
    }
  }
  if (area === 'right') {
    for (const probe of contributedFocusProbes) {
      if (probe()) return 'properties';
    }
  }
  return null;
}

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
  { id: 'plugin-drafts', label: 'Plugin Drafts', icon: Puzzle, panel: 'pluginDrafts' },
];

/** Default per-area layout: which panels live where, and the active tab. */
export const DEFAULT_LAYOUT: Record<AreaId, { panels: PanelId[]; active: PanelId }> = {
  left: { panels: ['explorer', 'modelInfo', 'palette'], active: 'explorer' },
  center: { panels: ['model', 'dsl'], active: 'model' },
  right: { panels: ['ai', 'properties'], active: 'ai' },
  bottom: { panels: ['problems', 'console'], active: 'problems' },
};
