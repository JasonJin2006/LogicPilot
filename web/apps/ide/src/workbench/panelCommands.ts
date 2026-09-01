// Neutral command seam for surfaces that need to reveal a panel without
// importing the persisted layout store. The layout store binds the target
// once at startup; consumers stay outside its panels -> component -> store
// initialization cycle.

export type PanelArea = 'left' | 'center' | 'right' | 'bottom';

type OpenPanelCommand = (area: PanelArea, panel: string) => void;

let openPanelCommand: OpenPanelCommand | null = null;

/** Bind the active workbench layout. Rebinding supports hot reload and
 *  isolated tests; the disposer only clears the command it installed. */
export function bindPanelCommands(command: OpenPanelCommand): () => void {
  openPanelCommand = command;
  return () => {
    if (openPanelCommand === command) openPanelCommand = null;
  };
}

/** Request that a panel be shown. Returns false before a layout is bound so
 *  callers can remain safe during isolated rendering/tests. */
export function requestOpenPanel(area: PanelArea, panel: string): boolean {
  if (openPanelCommand === null) return false;
  openPanelCommand(area, panel);
  return true;
}
