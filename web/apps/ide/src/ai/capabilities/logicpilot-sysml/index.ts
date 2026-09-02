import type { AgentCapability, AgentTool, AgentToolScope } from '../../agentContracts';
import { SYSML_TOOLS } from '../logicpilot-modeling/sysmlTools';

export const SYSML_PARADIGM_TOOLS: readonly AgentTool[] = SYSML_TOOLS;

export function sysmlToolsForScope(scope: AgentToolScope): readonly AgentTool[] {
  return scope.documentType === 'sysml' ? SYSML_PARADIGM_TOOLS : [];
}

export const logicpilotSysmlCapability: AgentCapability = Object.freeze({
  id: 'logicpilot-sysml',
  version: '1.0.0',
  label: 'LogicPilot SysML',
  description: 'Project, inspect and edit SysML semantic projections.',
  tools: SYSML_PARADIGM_TOOLS,
  toolsForScope: sysmlToolsForScope,
});

const SYSML_READONLY_NAMES = new Set([
  'inspect_sysml_projection',
  'find_sysml_definition',
  'find_sysml_references',
  'query_sysml_evidence',
  'explain_sysml_run',
]);

export const logicpilotSysmlReadonlyCapability: AgentCapability = Object.freeze({
  ...logicpilotSysmlCapability,
  id: 'logicpilot-sysml-readonly',
  label: 'LogicPilot SysML (read only)',
  description: 'Inspect and explain SysML projections without mutations.',
  tools: SYSML_PARADIGM_TOOLS.filter((tool) => SYSML_READONLY_NAMES.has(tool.name)),
  toolsForScope: (scope: AgentToolScope) =>
    sysmlToolsForScope(scope).filter((tool) => SYSML_READONLY_NAMES.has(tool.name)),
});
