import type { AgentCapability, AgentTool, AgentToolScope } from '../../agentContracts';
import { PROCESS_TOOLS } from './registry';

/** Process/DSL tools are a standalone paradigm capability. SysML tools are
 * deliberately not included; the active document scope selects one or the
 * other capability at the host boundary. */
export { PROCESS_TOOLS } from './registry';

export function processToolsForScope(scope: AgentToolScope): readonly AgentTool[] {
  return scope.documentType === 'sysml' ? [] : PROCESS_TOOLS;
}

export const logicpilotProcessCapability: AgentCapability = Object.freeze({
  id: 'logicpilot-process',
  version: '1.0.0',
  label: 'LogicPilot Process',
  description: 'Inspect, edit, compile and run Process/DSL models.',
  tools: PROCESS_TOOLS,
  toolsForScope: processToolsForScope,
});

export const logicpilotProcessReadonlyCapability: AgentCapability = Object.freeze({
  ...logicpilotProcessCapability,
  id: 'logicpilot-process-readonly',
  label: 'LogicPilot Process (read only)',
  description: 'Inspect and explain Process/DSL models without mutations.',
  tools: PROCESS_TOOLS.filter((tool) =>
    new Set([
      'inspect_model',
      'inspect_selection',
      'inspect_diagnostics',
      'inspect_run_metrics',
      'explain_results',
      'compare_runs',
      'wait_for_run',
    ]).has(tool.name),
  ),
  toolsForScope: (scope: AgentToolScope) =>
    processToolsForScope(scope).filter((tool) =>
      new Set([
        'inspect_model',
        'inspect_selection',
        'inspect_diagnostics',
        'inspect_run_metrics',
        'explain_results',
        'compare_runs',
        'wait_for_run',
      ]).has(tool.name),
    ),
});
