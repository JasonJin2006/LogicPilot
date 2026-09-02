import { describe, expect, it } from 'vitest';
import { planViews } from './viewPlanner';
import type { ViewDefinition } from '@logicpilot/contracts';

function view(
  id: string,
  canvas: ViewDefinition['canvas'],
  artifactKinds: string[] = ['semantic-model'],
): ViewDefinition {
  return {
    schema: 'logicpilot.view-definition/v1',
    contractVersion: 1,
    id,
    owner: 'logicpilot.test',
    titleKey: `view.${id}`,
    canvas,
    query: { artifactKinds: artifactKinds as ViewDefinition['query']['artifactKinds'] },
    interactions: ['select'],
    supportsInverseEdit: false,
    layoutPersistence: 'artifact',
  };
}

describe('View Planner', () => {
  it('selects installed views from structured intent and orders deterministically', () => {
    const suggestions = planViews(
      { purpose: 'show the process flow and route', artifactKinds: ['semantic-model'] },
      [view('z.graph', 'graph2d'), view('a.flow', 'flow')],
    );
    expect(suggestions[0]).toMatchObject({ viewId: 'a.flow', canvas: 'flow' });
    expect(suggestions[0]?.reasons).toContain('process routing intent');
  });

  it('makes explicit user selection dominate the planner score', () => {
    const suggestions = planViews({ purpose: 'show architecture', selectedViewId: 'chosen' }, [
      view('chosen', 'flow'),
      view('other', 'graph2d'),
    ]);
    expect(suggestions[0]?.viewId).toBe('chosen');
    expect(suggestions[0]?.reasons).toContain('explicit user selection');
  });
});
