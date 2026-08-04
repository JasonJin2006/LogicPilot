// Modeling canvas (P1-6): blocks are dragged from the palette and dropped
// here as cards; clicking a card selects it for the Properties panel.

import type { DragEvent, MouseEvent } from 'react';
import { useModelStore } from '../state/modelStore';
import type { BlockKind } from '@logicpilot/editor';
import { getDraggedKind } from './paletteDnd';

export function ModelCanvas() {
  const document = useModelStore((state) => state.document);
  const selectedId = useModelStore((state) => state.selectedId);
  const addBlock = useModelStore((state) => state.addBlock);
  const select = useModelStore((state) => state.select);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const kind =
      (event.dataTransfer.getData('text/plain') as BlockKind) || (getDraggedKind() as BlockKind);
    const canvas = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - canvas.left;
    const y = event.clientY - canvas.top;
    addBlock({ kind, name: kind, x, y });
    select(null);
  };

  const onCardClick = (event: MouseEvent, id: string) => {
    event.stopPropagation();
    select(id);
  };

  return (
    <div
      className="model-canvas"
      onDragEnter={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onClick={() => select(null)}
    >
      {document.nodes.length === 0 && (
        <div className="model-empty">Drag blocks from the palette to build a model.</div>
      )}
      {document.nodes.map((node) => (
        <div
          key={node.id}
          className={`model-block kind-${node.kind}${node.id === selectedId ? ' selected' : ''}`}
          style={{ left: node.x, top: node.y }}
          onClick={(event) => onCardClick(event, node.id)}
        >
          <span className="model-block-kind">{node.kind}</span>
          <span className="model-block-name">{node.name}</span>
        </div>
      ))}
    </div>
  );
}
