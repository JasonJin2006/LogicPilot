// LogicPilot capability tool registry. The Agent Runtime only sees the
// generic AssistantTool contract and this mounted registry.

import type { AssistantTool } from '../../toolTypes';
import { MODEL_INSPECTION_TOOLS, MODEL_READ_TOOLS } from './readTools';
import { MODEL_ANALYSIS_TOOLS } from './analysisTools';
import { MODEL_SIMULATION_TOOLS } from './simulationTools';
import { MODEL_MUTATION_TOOLS } from './mutationTools';

export const LOGICPILOT_MODELING_TOOLS: readonly AssistantTool[] = [
  ...MODEL_INSPECTION_TOOLS,
  ...MODEL_READ_TOOLS,
  ...MODEL_ANALYSIS_TOOLS,
  ...MODEL_SIMULATION_TOOLS,
  ...MODEL_MUTATION_TOOLS,
];

export const findLogicPilotTool = (
  name: string,
  tools: readonly AssistantTool[] = LOGICPILOT_MODELING_TOOLS,
): AssistantTool | null => tools.find((tool) => tool.name === name) ?? null;
