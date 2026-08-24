// LogicPilot's host capability boundary.
//
// The implementation currently re-exports the compatibility tool registry so
// existing behavior and tests remain stable while individual tools migrate
// into this package. Agent Core imports this entry point, never the editor
// implementation directly.

import { ASSISTANT_TOOLS } from './tools';
import { MODEL_INSPECTION_TOOLS, MODEL_READ_TOOLS } from './readTools';
import { MODEL_ANALYSIS_TOOLS } from './analysisTools';
import { MODEL_SIMULATION_TOOLS } from './simulationTools';
import { MODEL_MUTATION_TOOLS } from './mutationTools';
import { SYSML_TOOLS } from './sysmlTools';
import type { AgentCapability, AgentToolScope } from '../../agentContracts';

/** DSL graph/modeling tools: everything except the SysML projection tools,
 *  which belong to `.sysml` documents (plan §7 - AI discovers contributions
 *  through the active document instead of one global tool dump). */
const DSL_MODELING_TOOLS: readonly (typeof ASSISTANT_TOOLS)[number][] = [
  ...MODEL_INSPECTION_TOOLS,
  ...MODEL_READ_TOOLS,
  ...MODEL_ANALYSIS_TOOLS,
  ...MODEL_SIMULATION_TOOLS,
  ...MODEL_MUTATION_TOOLS,
];

export function logicpilotModelingToolsForScope(scope: AgentToolScope): typeof ASSISTANT_TOOLS {
  // No discovery context: legacy behavior keeps every tool mounted.
  if (scope === undefined) return ASSISTANT_TOOLS;
  if (scope.documentType === 'sysml') return SYSML_TOOLS;
  return DSL_MODELING_TOOLS;
}

export const logicpilotModelingCapability: AgentCapability = Object.freeze({
  id: 'logicpilot-modeling',
  version: '1.0.0',
  label: 'LogicPilot modeling',
  description: 'Inspect, edit, compile and run the current LogicPilot model.',
  tools: ASSISTANT_TOOLS,
  toolsForScope: logicpilotModelingToolsForScope,
});

export { ASSISTANT_TOOLS };
export { MODEL_INSPECTION_TOOLS } from './readTools';
export { MODEL_READ_TOOLS } from './readTools';
export { MODEL_ANALYSIS_TOOLS } from './analysisTools';
export { MODEL_SIMULATION_TOOLS } from './simulationTools';
export { MODEL_MUTATION_TOOLS } from './mutationTools';
export { SYSML_TOOLS } from './sysmlTools';
