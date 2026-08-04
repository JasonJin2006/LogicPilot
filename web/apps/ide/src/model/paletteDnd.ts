// Shared drag&drop channel between the palette and the modeling canvas.
// The block kind travels in the DataTransfer; `lastDraggedKind` is a
// fallback for environments where the drop event loses the transfer data.

let lastDraggedKind: string | null = null;
let lastDraggedLibrary: string | null = null;

export function setDraggedKind(kind: string, library?: string): void {
  lastDraggedKind = kind;
  lastDraggedLibrary = library ?? null;
}

export function getDraggedKind(): string | null {
  return lastDraggedKind;
}

export function getDraggedLibrary(): string | null {
  return lastDraggedLibrary;
}
