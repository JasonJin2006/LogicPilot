import { describe, expect, it } from 'vitest';
import { useModelStore } from './modelStore';
import { createDocument, createGraphicNode, type ModelNode } from '@logicpilot/editor';

describe('modelStore entity attribute params', () => {
  it('sets, renames and removes source attribute params', () => {
    useModelStore.getState().reset();
    useModelStore.getState().addBlock({ kind: 'source', name: 'Jobs', x: 0, y: 0 });
    const id = useModelStore.getState().document.nodes[0]!.id;

    useModelStore.getState().setBlockParam(id, 'state priority: float', 3);
    expect(useModelStore.getState().document.nodes[0]!.params['state priority: float']).toBe(3);

    useModelStore.getState().renameBlockParam(id, 'state priority: float', 'state kind: int');
    expect(
      useModelStore.getState().document.nodes[0]!.params['state priority: float'],
    ).toBeUndefined();
    expect(useModelStore.getState().document.nodes[0]!.params['state kind: int']).toBe(3);

    useModelStore.getState().removeBlockParam(id, 'state kind: int');
    expect(useModelStore.getState().document.nodes[0]!.params['state kind: int']).toBeUndefined();
  });

  it('applies an AI ModelPatch atomically as one undo step', () => {
    useModelStore.getState().reset();
    const result = useModelStore.getState().applyPatch({
      version: 1,
      operations: [
        { op: 'add_block', kind: 'source', name: 'In' },
        { op: 'add_block', kind: 'sink', name: 'Out' },
        { op: 'connect', from: 'In', to: 'Out' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(useModelStore.getState().document.nodes).toHaveLength(2);
    expect(useModelStore.getState().document.edges).toHaveLength(1);

    useModelStore.getState().undo();
    expect(useModelStore.getState().document.nodes).toHaveLength(0);
    expect(useModelStore.getState().document.edges).toHaveLength(0);
  });

  it('does not coalesce an AI patch with an immediately preceding user edit', () => {
    useModelStore.getState().reset();
    useModelStore.getState().addBlock({ kind: 'source', name: 'Manual', x: 0, y: 0 });
    useModelStore.getState().applyPatch({
      version: 1,
      operations: [{ op: 'add_block', kind: 'sink', name: 'AI' }],
    });
    useModelStore.getState().undo();
    expect(useModelStore.getState().document.nodes.map((node) => node.name)).toEqual(['Manual']);
  });
});

describe('modelStore presentation layer order', () => {
  it('reorders only the requested layer slots from top to bottom', () => {
    const document = createDocument('Layers');
    const layer = (id: string, x: number): ModelNode => ({
      id,
      kind: 'rect',
      name: id,
      x,
      y: 0,
      params: {},
      library: 'presentation',
      presentation: createGraphicNode('rect', x, 0),
    });
    document.nodes = [layer('back', 0), layer('middle', 10), layer('front', 20)];
    useModelStore.getState().loadDocument(document);

    useModelStore.getState().reorderPresentationLayers(['back', 'front', 'middle']);

    expect(useModelStore.getState().document.nodes.map((node) => node.id)).toEqual([
      'middle',
      'front',
      'back',
    ]);
  });

  it('does not disturb non-presentation nodes between layer slots', () => {
    const document = createDocument('Mixed');
    const back: ModelNode = {
      id: 'back',
      kind: 'rect',
      name: 'back',
      x: 0,
      y: 0,
      params: {},
      presentation: createGraphicNode('rect', 0, 0),
    };
    const process: ModelNode = {
      id: 'process',
      kind: 'source',
      name: 'process',
      x: 0,
      y: 0,
      params: {},
    };
    const front = { ...back, id: 'front', name: 'front' };
    document.nodes = [back, process, front];
    useModelStore.getState().loadDocument(document);

    useModelStore.getState().reorderPresentationLayers(['back', 'front']);

    expect(useModelStore.getState().document.nodes.map((node) => node.id)).toEqual([
      'front',
      'process',
      'back',
    ]);
  });
});

describe('modelStore reusable presentation components', () => {
  it('syncs master edits to instances while preserving instance placement', () => {
    const document = createDocument('Components');
    document.nodes = [
      {
        id: 'master',
        kind: 'rect',
        name: 'Card',
        x: 10,
        y: 20,
        params: {},
        presentation: createGraphicNode('rect', 10, 20),
      },
    ];
    useModelStore.getState().loadDocument(document);
    const componentId = useModelStore.getState().makeComponent('master');
    const instanceId = useModelStore.getState().createComponentInstance('master');
    expect(componentId).toBeTruthy();
    expect(instanceId).toBeTruthy();
    useModelStore.getState().moveBlock(instanceId!, 240, 160);

    const master = useModelStore.getState().document.nodes.find((node) => node.id === 'master')!;
    useModelStore.getState().setPresentation('master', {
      ...master.presentation!,
      style: {
        ...master.presentation!.style,
        fill: { kind: 'solid', color: '#ff0066' },
      },
    });

    const instance = useModelStore
      .getState()
      .document.nodes.find((node) => node.id === instanceId)!;
    expect(instance.presentation?.instanceOf).toBe(componentId);
    expect(instance.presentation?.transform).toMatchObject({ x: 240, y: 160 });
    expect(instance.presentation?.style.fill).toEqual({ kind: 'solid', color: '#ff0066' });
  });

  it('stops syncing after an instance is detached', () => {
    const instance = useModelStore
      .getState()
      .document.nodes.find((node) => node.presentation?.instanceOf)!;
    useModelStore.getState().detachComponentInstance(instance.id);
    expect(
      useModelStore.getState().document.nodes.find((node) => node.id === instance.id)?.presentation
        ?.instanceOf,
    ).toBeUndefined();
  });
});

describe('modelStore linked presentation connectors', () => {
  it('reroutes a connector when an endpoint moves', () => {
    const document = createDocument('Connectors');
    const from = createGraphicNode('rect', 0, 0);
    const to = createGraphicNode('rect', 200, 60);
    document.nodes = [
      { id: 'from', kind: 'rect', name: 'From', x: 0, y: 0, params: {}, presentation: from },
      { id: 'to', kind: 'rect', name: 'To', x: 200, y: 60, params: {}, presentation: to },
    ];
    useModelStore.getState().loadDocument(document);
    const connectorId = useModelStore.getState().connectPresentationShapes(['from', 'to']);
    const before = useModelStore
      .getState()
      .document.nodes.find((node) => node.id === connectorId)?.presentation;
    expect(before?.connector).toEqual({ fromId: 'from', toId: 'to', routing: 'orthogonal' });
    expect(before?.style.stroke.endArrow).toBe('arrow');

    useModelStore.getState().moveBlock('to', 0, 240);
    const after = useModelStore
      .getState()
      .document.nodes.find((node) => node.id === connectorId)?.presentation;
    expect(after?.transform.y).not.toBe(before?.transform.y);
    expect(after?.geometry?.points).not.toEqual(before?.geometry?.points);
  });

  it('removes dependent connectors with their endpoint', () => {
    useModelStore.getState().removeBlock('from');
    expect(
      useModelStore.getState().document.nodes.some((node) => node.presentation?.connector),
    ).toBe(false);
  });
});
