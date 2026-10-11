// Panel wrapper for the 3D scene view.
//
// The lazy boundary lives here rather than in `panels.tsx`, so the workbench
// panel table keeps importing an opaque component (see
// `plugins/registries/panelComponents`) and the ~150KB engine is still only
// fetched when the tab is opened.
//
// This is a core shell panel, not a plugin-owned one: it renders whatever
// document the editor holds and owns no paradigm. `DEFAULT_LAYOUT` asserts that
// every panel it names is registered, and a panel registered at plugin
// activation cannot satisfy that — it would be listed before it exists and
// silently skipped. The plugin still owns the declarative view contribution
// (see `plugins/builtin/scene3d`).

import { lazy, Suspense } from 'react';

const LazyScene3DWorkspace = lazy(() =>
  import('./Scene3DWorkspace').then((module) => ({ default: module.Scene3DWorkspace })),
);

export function Scene3DPanel() {
  return (
    <Suspense fallback={<div className="scene3d-loading">Loading the 3D renderer…</div>}>
      <LazyScene3DWorkspace />
    </Suspense>
  );
}
