import type { GraphicNode } from '@logicpilot/editor';

export interface PresentationLayer {
  /** Stable UI key: root id or root id plus a child index path. */
  id: string;
  /** Top-level ModelNode id that owns this scene-graph node. */
  rootId: string;
  /** Child indexes from the root GraphicNode; [] identifies the root. */
  path: number[];
  depth: number;
  name: string;
  kind: string;
  object: GraphicNode;
}

function childName(object: GraphicNode, index: number): string {
  if (object.type === 'text' && object.text?.trim()) {
    return object.text.trim().slice(0, 32);
  }
  return `${object.type} ${index + 1}`;
}

/** Flatten a scene graph in visual top-first order for a tree view. */
export function flattenPresentationLayers(
  rootId: string,
  rootName: string,
  rootKind: string,
  root: GraphicNode,
): PresentationLayer[] {
  const result: PresentationLayer[] = [];
  const visit = (
    object: GraphicNode,
    path: number[],
    depth: number,
    name: string,
    kind: string,
  ) => {
    result.push({
      id: path.length === 0 ? rootId : `${rootId}:${path.join('.')}`,
      rootId,
      path,
      depth,
      name,
      kind,
      object,
    });
    // The renderer paints children in declaration order, so the last child
    // is visually on top and should appear first in the layer tree.
    const children = object.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      visit(
        children[index]!,
        [...path, index],
        depth + 1,
        childName(children[index]!, index),
        children[index]!.type,
      );
    }
  };
  visit(root, [], 0, rootName, rootKind);
  return result;
}

export function getPresentationLayer(root: GraphicNode, path: number[]): GraphicNode | null {
  let current: GraphicNode | undefined = root;
  for (const index of path) {
    current = current.children?.[index];
    if (!current) return null;
  }
  return current;
}

export function updatePresentationLayer(
  root: GraphicNode,
  path: number[],
  patch: Partial<GraphicNode>,
): GraphicNode | null {
  if (path.length === 0) return { ...root, ...patch };
  const index = path[0];
  if (index === undefined) return null;
  const rest = path.slice(1);
  const children = root.children ?? [];
  if (!children[index]) return null;
  const child = updatePresentationLayer(children[index]!, rest, patch);
  if (!child) return null;
  return {
    ...root,
    children: children.map((entry, childIndex) => (childIndex === index ? child : entry)),
  };
}
