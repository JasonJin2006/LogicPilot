// Center tab (Model): the modeling canvas. The DSL editor lives in its own
// center tab (DslEditor) at the same level, not as an attached drawer.

import { Play } from 'lucide-react';
import { useUiStore } from '../state/uiStore';
import { ModelCanvas } from './ModelCanvas';

export function ModelWorkspace() {
  const openRunDialog = useUiStore((state) => state.openRunDialog);
  return (
    <div className="model-workspace">
      <button className="canvas-run" title="Run the model" onClick={openRunDialog}>
        <Play size={12} />
        Run
      </button>
      <div className="model-canvas-host">
        <ModelCanvas />
      </div>
    </div>
  );
}
