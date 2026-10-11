// Registers the SysML v2 visual-subset catalog into the Workbench palette
// (plan §5/§9.3). Items are DECLARATION kinds, not executable blocks: while
// a .sysml document is active, double-click / drop inserts a typed
// declaration into the source through sysmlEditBridge (text stays
// authoritative); on the model canvas these items do nothing.
//
// Icons come from the same notation glyph set the canvas/outline use, so
// palette, diagram and outline read as one language instead of generic
// fallback blocks.

import type { ComponentType } from 'react';
import { PALETTE_CONTRIBUTIONS, type PaletteItem } from '../workbench/palette';
import { SysMLElementIcon } from './sysmlIcons';
import { insertFromPalette } from './sysmlEditBridge';
import type { SysMLVisualKind } from './sysmlProjection';

function item(kind: string, name: string, declaration: 'def' | 'usage', hint: string): PaletteItem {
  return {
    kind: `${kind}${declaration === 'def' ? ':def' : ':usage'}`,
    library: 'sysml',
    name,
    hint,
  };
}

/** `'part:def'` -> the notation glyph of `part`. */
function sysmlIcon(entry: PaletteItem): ComponentType<{ size?: number }> | undefined {
  const base = entry.kind.split(':')[0]!;
  return ({ size }) => <SysMLElementIcon kind={base as SysMLVisualKind} size={size ?? 12} />;
}

export function registerSysmlPaletteContribution(): () => void {
  return PALETTE_CONTRIBUTIONS.register({
    id: 'sysml.visual-subset',
    library: { id: 'sysml', name: 'SysML' },
    // The SysML library only belongs to a .sysml document: the .lp model
    // canvas must not offer SysML declarations.
    context: { documentTypes: ['sysml'] },
    iconFor: sysmlIcon,
    insert: (entry) => {
      const [baseKind, declarationKind] = entry.kind.split(':');
      const declaration = declarationKind === 'def' ? 'def' : 'usage';
      insertFromPalette(baseKind!, declaration);
    },
    items: [
      item('package', 'Package', 'def', 'namespace container'),
      item('part', 'Part Definition', 'def', 'reusable component type'),
      item('part', 'Part Usage', 'usage', 'typed part instance'),
      item('item', 'Item Definition', 'def', 'flowing item type'),
      item('attribute', 'Attribute', 'usage', 'value property'),
      item('enum', 'Enumeration', 'def', 'named value set'),
      item('port', 'Port Definition', 'def', 'interaction point'),
      item('interface', 'Interface Definition', 'def', 'port pairing'),
      item('flow', 'Flow', 'usage', 'item flow edge'),
      item('requirement', 'Requirement', 'usage', 'stated need'),
      item('analysis', 'Analysis Case', 'usage', 'analysis record'),
      item('verification', 'Verification Case', 'usage', 'verification case'),
      item('action', 'Action Definition', 'def', 'reusable behavior'),
      item('action', 'Action Usage', 'usage', 'behavior occurrence'),
      item('calculation', 'Calculation', 'def', 'pure function'),
      item('state', 'State', 'usage', 'state machine state'),
      item('constraint', 'Constraint', 'usage', 'boolean condition'),
      item('interaction', 'Interaction', 'def', 'sequence of messages'),
      item('actor', 'Actor', 'usage', 'external role (stick figure)'),
      item('usecase', 'Use Case', 'usage', 'goal scenario'),
      item('stakeholder', 'Stakeholder', 'usage', 'interested party'),
      item('occurrence', 'Occurrence', 'usage', 'individual happening'),
      item('snapshot', 'Snapshot', 'usage', 'occurrence state at a time'),
      item('timeslice', 'Timeslice', 'usage', 'occurrence time window'),
      item('view', 'View', 'usage', 'stakeholder viewpoint render'),
      item('viewpoint', 'Viewpoint', 'usage', 'view specification'),
    ],
  });
}
