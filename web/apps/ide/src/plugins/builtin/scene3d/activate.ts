// 3D Scene plugin web entrypoint.
//
// Paradigm-agnostic on purpose: it renders whatever `ModelDocument` the editor
// currently holds, so it declares no paradigm dependency and works in a
// zero-paradigm build. Removing this plugin (and `src/scene3d/`) removes the 3D
// view entirely, including its three.js dependency.

import type { PluginModule } from '@logicpilot/plugin-host';

import { notifySelectionChanged } from '../../../workbench/selectionFocus';
import { useModelStore } from '../../../state/modelStore';
import { registerLocalPluginContribution } from '../../registry';
import scene3dContributionsJson from './contributions.json';

export function activateScene3DPlugin(): PluginModule {
  return {
    activate: (ctx) => {
      // The panel itself is a shell panel (see src/scene3d/Scene3DPanel): the
      // default layout asserts that every panel it names is registered, which a
      // panel registered here could not satisfy. What the plugin owns is the
      // declarative view contribution below.
      ctx.effect(registerLocalPluginContribution(scene3dContributionsJson));

      // Selection lives in the shared model store, so a 3D click and a 2D click
      // are the same event. Forwarding it to the workbench's neutral seam is
      // what re-runs the panel focus probes; SysML wires its own store the same
      // way, and the model store was simply not wired before.
      const offSelection = useModelStore.subscribe(() => notifySelectionChanged());
      ctx.effect(offSelection);
    },
  };
}
