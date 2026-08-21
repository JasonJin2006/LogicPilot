// LogicPilot's host capability boundary.
//
// The implementation currently re-exports the compatibility tool registry so
// existing behavior and tests remain stable while individual tools migrate
// into this package. Agent Core imports this entry point, never the editor
// implementation directly.

import { ASSISTANT_TOOLS } from './tools';
import type { AgentCapability } from '../../agentContracts';

export const logicpilotModelingCapability: AgentCapability = Object.freeze({
  id: 'logicpilot-modeling',
  version: '1.0.0',
  label: 'LogicPilot modeling',
  description: 'Inspect, edit, compile and run the current LogicPilot model.',
  tools: ASSISTANT_TOOLS,
});

export { ASSISTANT_TOOLS };
export { MODEL_INSPECTION_TOOLS } from './readTools';
export { MODEL_READ_TOOLS } from './readTools';
export { MODEL_ANALYSIS_TOOLS } from './analysisTools';
export { MODEL_SIMULATION_TOOLS } from './simulationTools';
export { MODEL_MUTATION_TOOLS } from './mutationTools';
