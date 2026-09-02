// Host-mounted capabilities for the provider-neutral Agent Runtime.
//
// The runtime does not know what "modeling" means. This module is the IDE's
// capability adapter; future file/web/MCP packages can register beside it.

import {
  AgentCapabilityRegistry,
  type AgentCapability,
  type AgentToolScope,
} from './agentContracts';
import {
  logicpilotProcessCapability,
  logicpilotProcessReadonlyCapability,
} from './capabilities/logicpilot-process';
import {
  logicpilotSysmlCapability,
  logicpilotSysmlReadonlyCapability,
} from './capabilities/logicpilot-sysml';
import { logicpilotSourceEditingCapability } from './capabilities/source-editing';
import { pluginAuthoringCapability } from './capabilities/plugin-authoring';
import { viewPlanningCapability } from './capabilities/view-planning';

export const LOGICPILOT_PROCESS_CAPABILITY: AgentCapability = logicpilotProcessCapability;
export const LOGICPILOT_PROCESS_READONLY_CAPABILITY: AgentCapability =
  logicpilotProcessReadonlyCapability;
export const LOGICPILOT_SYSML_CAPABILITY: AgentCapability = logicpilotSysmlCapability;
export const LOGICPILOT_SYSML_READONLY_CAPABILITY: AgentCapability =
  logicpilotSysmlReadonlyCapability;

export const AGENT_CAPABILITY_REGISTRY = new AgentCapabilityRegistry();
AGENT_CAPABILITY_REGISTRY.register(LOGICPILOT_PROCESS_CAPABILITY);
AGENT_CAPABILITY_REGISTRY.register(LOGICPILOT_PROCESS_READONLY_CAPABILITY);
AGENT_CAPABILITY_REGISTRY.register(LOGICPILOT_SYSML_CAPABILITY);
AGENT_CAPABILITY_REGISTRY.register(LOGICPILOT_SYSML_READONLY_CAPABILITY);
AGENT_CAPABILITY_REGISTRY.register(logicpilotSourceEditingCapability);
AGENT_CAPABILITY_REGISTRY.register(pluginAuthoringCapability);
AGENT_CAPABILITY_REGISTRY.register(viewPlanningCapability);

export const AGENT_CAPABILITIES: readonly AgentCapability[] = Object.freeze(
  AGENT_CAPABILITY_REGISTRY.list(),
);

export function resolveAgentTools(capabilityIds?: readonly string[], scope?: AgentToolScope) {
  return AGENT_CAPABILITY_REGISTRY.tools(capabilityIds, scope);
}
