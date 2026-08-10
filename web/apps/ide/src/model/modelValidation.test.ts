import { describe, expect, it } from 'vitest';
import type { ModelDocument, ModelNode } from '@logicpilot/editor';
import { validateDesModel } from './modelValidation';

const node = (
  id: string,
  kind: string,
  name: string,
  params: ModelNode['params'] = {},
  container?: string,
): ModelNode => ({ id, kind, name, x: 0, y: 0, params, container, library: 'process' });

function validQueueModel(): ModelDocument {
  return {
    name: 'QueueModel',
    nodes: [
      node('r', 'resource', 'Workers', { capacity: 2 }),
      node('s', 'source', 'Arrivals'),
      node('q', 'queue', 'Waiting', { capacity: 100 }),
      node('w', 'service', 'Handle', { resource: 'Workers', time: 'exponential(1)' }),
      node('k', 'sink', 'Done'),
    ],
    edges: [
      { id: 'e1', from: 's', to: 'q' },
      { id: 'e2', from: 'q', to: 'w' },
      { id: 'e3', from: 'w', to: 'k' },
    ],
  };
}

describe('DES model preflight validation', () => {
  it('accepts the canonical source-queue-service-sink model', () => {
    expect(validateDesModel(validQueueModel())).toEqual([]);
  });

  it('reports invalid and duplicate names deterministically', () => {
    const document = validQueueModel();
    document.name = 'Bad model';
    document.nodes[2]!.name = 'Handle';
    document.nodes[3]!.name = 'Handle';
    const diagnostics = validateDesModel(document);
    expect(diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['LP0001', 'LP1002']),
    );
  });

  it('rejects bad ports, disabled conditional ports and implicit fan-out', () => {
    const document = validQueueModel();
    document.edges.push(
      { id: 'bad-direction', from: 'q', to: 'k', fromPort: 'in' },
      { id: 'disabled', from: 'q', to: 'k', fromPort: 'outTimeout' },
      { id: 'fanout', from: 'q', to: 'k' },
    );
    const diagnostics = validateDesModel(document);
    expect(diagnostics.filter((entry) => entry.code === 'LP5003')).toHaveLength(2);
    expect(diagnostics.some((entry) => entry.code === 'LP5007')).toBe(true);
  });

  it('catches incomplete flows, missing resources and invalid cardinalities', () => {
    const document = validQueueModel();
    document.edges = [{ id: 'e1', from: 's', to: 'q' }];
    document.nodes.find((entry) => entry.id === 'r')!.params.capacity = 0;
    document.nodes.find((entry) => entry.id === 'w')!.params.resource = 'Missing';
    const diagnostics = validateDesModel(document);
    expect(diagnostics.some((entry) => entry.code === 'LP5004' && entry.nodeId === 'w')).toBe(true);
    expect(diagnostics.some((entry) => entry.code === 'LP5004' && entry.nodeId === 'k')).toBe(true);
    expect(diagnostics.some((entry) => entry.code === 'LP2001' && entry.nodeId === 'w')).toBe(true);
    expect(diagnostics.some((entry) => entry.code === 'LP3001' && entry.nodeId === 'r')).toBe(true);
  });

  it('rejects connections across scopes and missing endpoints', () => {
    const document = validQueueModel();
    document.nodes.find((entry) => entry.id === 'q')!.container = 'Flow';
    document.edges.push({ id: 'missing', from: 'ghost', to: 'k' });
    const diagnostics = validateDesModel(document);
    expect(diagnostics.filter((entry) => entry.code === 'LP5002')).toHaveLength(3);
  });
});
