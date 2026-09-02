// Neutral selection-focus seam (Phase 2 shell de-paradigmization, plan §5.1):
// the workspace used to subscribe to two hard-coded selection stores (model +
// SysML) to re-run panel focus probes. The shell can no longer name a
// paradigm, so plugins register their selection stores here; the workspace
// subscribes to the version counter and re-runs the probes whenever ANY
// registered selection changes.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Called by plugin code when a contributed selection store changes in a way
 *  that could flip a focus probe (e.g. selection gained/lost). */
export function notifySelectionChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Subscribe the workspace (or a test) to selection-driven probe reruns.
 *  Returns the disposer. */
export function onSelectionChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
