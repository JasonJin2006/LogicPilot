import type { AgentCapability } from '../../agentContracts';
import { SOURCE_EDITING_TOOLS } from './tools';

export const logicpilotSourceEditingCapability: AgentCapability = Object.freeze({
  id: 'logicpilot-source-editing',
  version: '1.0.0',
  label: 'LogicPilot source editing',
  description: 'Read and edit bounded model, presentation and experiment source files.',
  tools: SOURCE_EDITING_TOOLS,
});

export { SOURCE_EDITING_TOOLS } from './tools';
