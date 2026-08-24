// Registers the SysML v2 visual-subset catalog into the Workbench palette
// (plan §5/§9.3). Items are DECLARATION kinds, not executable blocks: while
// a .sysml document is active, double-click / drop inserts a typed
// declaration into the source through sysmlEditBridge (text stays
// authoritative); on the model canvas these items do nothing.

import { PALETTE_CONTRIBUTIONS, type PaletteItem } from '../workbench/palette';

function item(
  kind: string,
  name: string,
  declaration: 'def' | 'usage',
  hint: string,
): PaletteItem {
  return {
    kind: `${kind}${declaration === 'def' ? ':def' : ':usage'}`,
    library: 'sysml',
    name,
    hint,
  };
}

PALETTE_CONTRIBUTIONS.register({
  id: 'sysml.visual-subset',
  library: { id: 'sysml', name: 'SysML' },
  items: [
    item('package', 'Package', 'def', 'namespace container'),
    item('part', 'Part Definition', 'def', 'reusable component type'),
    item('part', 'Part Usage', 'usage', 'typed part instance'),
    item('item', 'Item Definition', 'def', 'flowing item type'),
    item('port', 'Port Definition', 'def', 'interaction point'),
    item('interface', 'Interface Definition', 'def', 'port pairing'),
    item('attribute', 'Attribute', 'usage', 'value property'),
    item('enum', 'Enumeration', 'def', 'named value set'),
    item('requirement', 'Requirement', 'usage', 'stated need'),
    item('action', 'Action Definition', 'def', 'reusable behavior'),
    item('action', 'Action Usage', 'usage', 'behavior occurrence'),
    item('calculation', 'Calculation', 'def', 'pure function'),
    item('state', 'State', 'usage', 'state machine state'),
    item('constraint', 'Constraint', 'usage', 'boolean condition'),
    item('usecase', 'Use Case', 'usage', 'goal scenario'),
    item('view', 'View', 'usage', 'stakeholder viewpoint render'),
  ],
});
