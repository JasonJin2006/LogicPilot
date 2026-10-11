import type { PluginModule } from '@logicpilot/plugin-host';
import { registerLocalPluginContribution } from '../../registry';
import { registerExecutionTelemetryProjector } from '../../../state/executionProjector';
import contributions from './contributions.json';
import { projectStatechartTelemetry } from '../telemetryProjectors';

/** Data-first Statechart pack. Runtime execution is supplied by the kernel;
 * this plugin owns the structured context and view/notation declarations. */
export function activateStatechartPlugin(): PluginModule {
  return {
    activate: (ctx) => {
      ctx.effect(registerLocalPluginContribution(contributions));
      ctx.effect(registerExecutionTelemetryProjector(projectStatechartTelemetry));
    },
  };
}
