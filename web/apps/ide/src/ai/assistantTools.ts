// Compatibility facade for older IDE imports.
//
// The implementation and registry now live under the LogicPilot capability;
// new Agent code must import the capability entry or generic tool contracts.

export {
  LOGICPILOT_MODELING_TOOLS as ASSISTANT_TOOLS,
  findLogicPilotTool as findAssistantTool,
} from './capabilities/logicpilot-modeling/registry';
export type { AssistantTool, AssistantToolName, ToolExecutionContext } from './toolTypes';
export { summarizeModel } from './contextBuilder';
