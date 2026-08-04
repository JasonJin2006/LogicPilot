// Shared drag&drop channel between the palette and the modeling canvas.
// The block kind travels in the DataTransfer; `lastDraggedKind` is a
// fallback for environments where the drop event loses the transfer data.

let lastDraggedKind: string | null = null;

export function setDraggedKind(kind: string): void {
  lastDraggedKind = kind;
}

export function getDraggedKind(): string | null {
  return lastDraggedKind;
}
