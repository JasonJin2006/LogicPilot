import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_PROVIDERS, diagnoseDocument } from './diagnostics';
// Registers the DSL document type's DES graph diagnostic provider.
import '../model/modelValidation';

describe('Workbench diagnostic providers', () => {
  it('aggregates the registered DES graph validator for DSL documents', () => {
    // An empty model is valid: no diagnostics.
    expect(diagnoseDocument('dsl', { name: 'Model', nodes: [], edges: [] })).toEqual([]);
  });

  it('never routes foreign document types to another language validator', () => {
    expect(diagnoseDocument('sysml', { name: 'broken', nodes: 'nope' })).toEqual([]);
    expect(diagnoseDocument(null, undefined)).toEqual([]);
    expect(diagnoseDocument(undefined, 'junk')).toEqual([]);
  });

  it('surfaces graph errors with node attribution through the seam', () => {
    const document = {
      name: 'model',
      nodes: [{ id: 'q1', kind: 'queue', name: 'q', x: 0, y: 0, params: {}, library: 'process' }],
      edges: [],
    };
    const diagnostics = diagnoseDocument('dsl', document);
    // A lone queue has no incoming connection.
    expect(diagnostics.some((d) => d.code === 'LP5004' && d.nodeId === 'q1')).toBe(true);
    // ...and its scope has no source stage.
    expect(diagnostics.some((d) => d.code === 'LP2002')).toBe(true);
  });

  it('rejects duplicate diagnostic contribution ids', () => {
    expect(() =>
      DIAGNOSTIC_PROVIDERS.register({
        id: 'logicpilot.des-graph',
        documentTypes: ['dsl'],
        diagnose: () => [],
      }),
    ).toThrow(/already registered/);
  });
});
