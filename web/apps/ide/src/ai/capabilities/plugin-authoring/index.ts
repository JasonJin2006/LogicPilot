import type { AgentCapability } from '../../agentContracts';
import { PLUGIN_AUTHORING_TOOLS } from './tools';

export const pluginAuthoringCapability: AgentCapability = Object.freeze({
  id: 'logicpilot-plugin-authoring',
  version: '1.0.0',
  label: 'LogicPilot plugin authoring',
  description: 'Create and review permission-gated structured plugin drafts.',
  tools: PLUGIN_AUTHORING_TOOLS,
});

export { PLUGIN_AUTHORING_TOOLS } from './tools';
