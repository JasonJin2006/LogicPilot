import type { PluginModule } from '@logicpilot/plugin-host';
import { registerLocalPluginContribution } from '../registry';

/** Activates a data-first paradigm pack. Concrete runtime execution remains
 * owned by the kernel/execution-target provider until that runtime is moved
 * into an installable plugin. */
export function activateDataPack(contributions: unknown): PluginModule {
  return {
    activate: (ctx) => {
      ctx.effect(registerLocalPluginContribution(contributions));
    },
  };
}
