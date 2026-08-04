// Side panel (Palette view): the process library blocks, draggable onto the
// modeling canvas. The block set mirrors libraries/process.lplib.

const BLOCKS = [
  { kind: 'resource', hint: 'capacity / failure_rate' },
  { kind: 'source', hint: 'arrival rate' },
  { kind: 'queue', hint: 'buffer capacity' },
  { kind: 'service', hint: 'resource + time' },
  { kind: 'sink', hint: 'terminal stage' },
];

export function PalettePanel() {
  return (
    <div className="side-panel-body">
      <p className="side-hint">Drag blocks onto the canvas to build models (P1-6).</p>
      <ul className="palette-list">
        {BLOCKS.map((block) => (
          <li
            key={block.kind}
            className="palette-item"
            draggable
            onDragStart={(event) => event.dataTransfer.setData('text/plain', block.kind)}
          >
            <code className="palette-kind">{block.kind}</code>
            <span className="palette-hint">{block.hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
