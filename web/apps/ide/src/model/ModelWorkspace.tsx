// Center tab (Model): the modeling canvas. Run lives in the tab bar's
// contextual action area (right end), not inside the canvas.

import { ModelCanvas } from './ModelCanvas';

export function ModelWorkspace() {
  return (
    <div className="model-workspace">
      <div className="model-canvas-host">
        <ModelCanvas />
      </div>
    </div>
  );
}
