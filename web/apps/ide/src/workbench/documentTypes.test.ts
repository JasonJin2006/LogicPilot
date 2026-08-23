import { describe, expect, it } from 'vitest';
import { documentContributionFor, editorPanelFor } from './documentTypes';

describe('Workbench document contributions', () => {
  it('routes SysML documents to the projection editor', () => {
    expect(documentContributionFor('model/Vehicle.SYSML')?.id).toBe('sysml');
    expect(editorPanelFor('model/Vehicle.sysml')).toBe('sysml');
  });

  it('keeps normal LogicPilot sources on the DSL editor', () => {
    expect(documentContributionFor('model/main.lp')).toBeUndefined();
    expect(editorPanelFor('model/main.lp')).toBe('dsl');
  });
});

