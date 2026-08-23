// Host-mounted capabilities for the provider-neutral Agent Runtime.
//
// The runtime does not know what "modeling" means. This module is the IDE's
// capability adapter; future file/web/MCP packages can register beside it.

import { AgentCapabilityRegistry, type AgentCapability } from './agentContracts';
import { logicpilotModelingCapability } from './capabilities/logicpilot-modeling';
import { logicpilotSourceEditingCapability } from './capabilities/source-editing';

export const LOGICPILOT_MODELING_CAPABILITY: AgentCapability = logicpilotModelingCapability;
export const LOGICPILOT_MODELING_READONLY_CAPABILITY: AgentCapability = Object.freeze({
  ...logicpilotModelingCapability,
  id: 'logicpilot-modeling-readonly',
  version: '1.0.0',
  label: 'LogicPilot modeling (read only)',
  description: 'Inspect the current model and explain grounded results without mutations.',
  tools: logicpilotModelingCapability.tools?.filter((tool) =>
    [
      'inspect_model',
      'inspect_selection',
      'inspect_diagnostics',
      'inspect_run_metrics',
      'explain_results',
      'compare_runs',
      'wait_for_run',
      'inspect_sysml_projection',
    ].includes(tool.name),
  ),
});

export const AGENT_CAPABILITY_REGISTRY = new AgentCapabilityRegistry();
AGENT_CAPABILITY_REGISTRY.register(LOGICPILOT_MODELING_CAPABILITY);
AGENT_CAPABILITY_REGISTRY.register(LOGICPILOT_MODELING_READONLY_CAPABILITY);
AGENT_CAPABILITY_REGISTRY.register(logicpilotSourceEditingCapability);

export const AGENT_CAPABILITIES: readonly AgentCapability[] = Object.freeze(
  AGENT_CAPABILITY_REGISTRY.list(),
);

export function resolveAgentTools(capabilityIds?: readonly string[]) {
  return AGENT_CAPABILITY_REGISTRY.tools(capabilityIds);
}
