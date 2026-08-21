// Compatibility export for the LogicPilot modeling capability.
// Individual tool implementations migrate here incrementally; consumers must
// import this boundary instead of the legacy assistantTools module.

export {
  LOGICPILOT_MODELING_TOOLS as ASSISTANT_TOOLS,
  findLogicPilotTool as findAssistantTool,
} from './registry';
export type { AssistantTool, AssistantToolName, ToolExecutionContext } from '../../toolTypes';
