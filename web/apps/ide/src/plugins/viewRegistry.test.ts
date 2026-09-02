import { describe, expect, it } from 'vitest';
import { PLUGIN_REGISTRY } from './registry';
import { activeCreateActions, activeNotations, activeViewsForCanvas } from './viewRegistry';

describe('plugin view registry', () => {
  it('selects views by declared canvas and exposes notation/actions', () => {
    PLUGIN_REGISTRY.apply({
      schema: 'logicpilot.plugin-registry/v1',
      contractVersion: 1,
      generation: 99,
      plugins: ['logicpilot.view-test'],
      contributions: [
        {
          schema: 'logicpilot.plugin-contributions/v1',
          contractVersion: 1,
          pluginId: 'logicpilot.view-test',
          version: '1.0.0',
          knowledge: [],
          skills: [],
          instructions: [],
          diagnostics: [],
          views: [
            {
              schema: 'logicpilot.view-definition/v1',
              contractVersion: 1,
              id: 'view.graph',
              owner: 'logicpilot.view-test',
              titleKey: 'view.graph',
              canvas: 'graph2d',
              query: { artifactKinds: ['semantic-model'] },
              interactions: ['select'],
              supportsInverseEdit: false,
              layoutPersistence: 'none',
            },
          ],
          notations: [
            {
              schema: 'logicpilot.notation-pack/v1',
              contractVersion: 1,
              id: 'notation.graph',
              owner: 'logicpilot.view-test',
              glyphs: [],
              edges: [],
              createActions: [],
            },
          ],
          createActions: [],
          palettes: [],
          tools: [],
        },
      ],
    });
    expect(activeViewsForCanvas('graph2d').map((view) => view.id)).toEqual(['view.graph']);
    expect(activeViewsForCanvas('scene3d')).toEqual([]);
    expect(activeNotations().map((notation) => notation.id)).toEqual(['notation.graph']);
    expect(activeCreateActions()).toEqual([]);
  });
});
