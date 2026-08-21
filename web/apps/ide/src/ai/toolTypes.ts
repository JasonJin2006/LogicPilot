import type { ExperimentSettings } from './api';
import type { AssistantSessionState } from './assistantTypes';
import type { AgentTool } from './agentContracts';

export type AssistantToolName =
  | (string & {})
  | 'inspect_model'
  | 'inspect_selection'
  | 'inspect_diagnostics'
  | 'inspect_run_metrics'
  | 'apply_model_patch'
  | 'compile_model'
  | 'run_simulation'
  | 'run_parameter_study'
  | 'explain_results'
  | 'optimize_model'
  | 'compare_runs'
  | 'wait_for_run'
  | 'undo_last_ai_change';

export interface ToolExecutionContext {
  session: AssistantSessionState;
  experiment: ExperimentSettings;
  signal?: AbortSignal;
}

export interface AssistantTool extends AgentTool<ToolExecutionContext> {
  name: AssistantToolName;
}
