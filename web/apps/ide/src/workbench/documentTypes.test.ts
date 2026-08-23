import { describe, expect, it } from 'vitest';
import { DOCUMENT_CONTRIBUTIONS, documentContributionFor, editorPanelFor, newFileContentFor } from './documentTypes';

describe('Workbench document contributions', () => {
  it('routes SysML documents to the projection editor', () => {
    expect(documentContributionFor('model/Vehicle.SYSML')?.id).toBe('sysml');
    expect(editorPanelFor('model/Vehicle.sysml')).toBe('sysml');
  });

  it('routes LogicPilot sources through the registered DSL contribution', () => {
    expect(documentContributionFor('model/main.lp')?.id).toBe('dsl');
    expect(editorPanelFor('model/main.lp')).toBe('dsl');
  });

  it('falls back to the DSL editor for unregistered files', () => {
    expect(documentContributionFor('data/config.json')).toBeUndefined();
    expect(editorPanelFor('data/config.json')).toBe('dsl');
  });

  it('creates DSL templates from the contribution, not hardcoded switches', () => {
    expect(newFileContentFor('model/new.lp')).toBe('model new {\n}\n');
    expect(newFileContentFor('model/nested/NewModel.LP')).toBe('model NewModel {\n}\n');
    // No template declared: empty file.
    expect(newFileContentFor('model/vehicle.sysml')).toBe('');
    expect(newFileContentFor('data/config.json')).toBe('');
  });

  it('rejects duplicate ids and colliding extensions', () => {
    expect(() =>
      DOCUMENT_CONTRIBUTIONS.register({
        id: 'dsl',
        label: 'dup',
        extensions: ['.x'],
        editorPanel: 'dsl',
        providesProjection: false,
      }),
    ).toThrow(/already registered/);
    expect(() =>
      DOCUMENT_CONTRIBUTIONS.register({
        id: 'other',
        label: 'collide',
        extensions: ['.LP'],
        editorPanel: 'dsl',
        providesProjection: false,
      }),
    ).toThrow(/already registered by 'dsl'/);
  });
});
