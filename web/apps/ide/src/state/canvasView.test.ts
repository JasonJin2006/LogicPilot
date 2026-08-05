import { describe, expect, it } from 'vitest';
import { addNode, createDocument, generateDsl, parseDsl } from '@logicpilot/editor';
import { documentForView } from './canvasView';

describe('canvas view', () => {
  it('null view returns the whole document', () => {
    const document = createDocument('M');
    expect(documentForView(document, null)).toBe(document);
  });

  it('a container view filters to its nodes and inner couplings', () => {
    let document = createDocument('M');
    document = addNode(document, {
      kind: 'resource',
      name: 'Server',
      x: 40,
      y: 60,
      params: { capacity: 1 },
    });
    document = addNode(document, {
      kind: 'source',
      name: 'S',
      x: 100,
      y: 200,
      params: {},
      container: 'Flow',
    });
    document = addNode(document, {
      kind: 'queue',
      name: 'Q',
      x: 300,
      y: 200,
      params: {},
      container: 'Flow',
    });
    document = {
      ...document,
      edges: [
        { id: 'e1', from: document.nodes[1]!.id, to: document.nodes[2]!.id },
      ],
    };
    const flow = documentForView(document, { kind: 'process', name: 'Flow' });
    expect(flow.nodes).toHaveLength(2);
    expect(flow.nodes.every((node) => node.container === 'Flow')).toBe(true);
    expect(flow.edges).toHaveLength(1);
    const other = documentForView(document, { kind: 'process', name: 'Other' });
    expect(other.nodes).toHaveLength(0);
    expect(other.edges).toHaveLength(0);
  });

  it('container survives the DSL round trip', () => {
    const source = `model M {
  resource Server {
    capacity = 1
  }
  process Flow {
    source S {
      arrival = rate(0.8)
    }
    queue Q {
      capacity = 10
    }
  }
  process Backup {
    sink Done { }
  }
}
`;
    const parsed = parseDsl(source);
    expect(parsed.ok).toBe(true);
    const stages = parsed.document.nodes.filter(
      (node) => node.kind !== 'resource',
    );
    expect(stages.every((node) => node.container === 'Flow' || node.container === 'Backup')).toBe(
      true,
    );
    expect(stages.find((node) => node.name === 'S')?.container).toBe('Flow');
    expect(stages.find((node) => node.name === 'Done')?.container).toBe('Backup');

    const regenerated = generateDsl(parsed.document);
    expect(regenerated).toContain('process Flow');
    expect(regenerated).toContain('process Backup');
    const reparsed = parseDsl(regenerated);
    expect(reparsed.ok).toBe(true);
    const reparsedStages = reparsed.document.nodes.filter(
      (node) => node.kind !== 'resource',
    );
    expect(reparsedStages.find((node) => node.name === 'S')?.container).toBe('Flow');
    expect(reparsedStages.find((node) => node.name === 'Done')?.container).toBe('Backup');
  });
});
