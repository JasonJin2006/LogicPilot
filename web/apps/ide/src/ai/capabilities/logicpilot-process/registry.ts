import type { AssistantTool } from '../../toolTypes';
export type { AssistantTool } from '../../toolTypes';
import { MODEL_INSPECTION_TOOLS, MODEL_READ_TOOLS } from '../logicpilot-modeling/readTools';
import { MODEL_ANALYSIS_TOOLS } from '../logicpilot-modeling/analysisTools';
import { MODEL_SIMULATION_TOOLS } from '../logicpilot-modeling/simulationTools';
import { MODEL_MUTATION_TOOLS } from '../logicpilot-modeling/mutationTools';

/** Runtime registry for Process/DSL tools. SysML has its own capability and
 * is intentionally absent from this list. */
export const PROCESS_TOOLS: readonly AssistantTool[] = [
  ...MODEL_INSPECTION_TOOLS,
  ...MODEL_READ_TOOLS,
  ...MODEL_ANALYSIS_TOOLS,
  ...MODEL_SIMULATION_TOOLS,
  ...MODEL_MUTATION_TOOLS,
];

export const findProcessTool = (
  name: string,
  tools: readonly AssistantTool[] = PROCESS_TOOLS,
): AssistantTool | null => tools.find((tool) => tool.name === name) ?? null;
