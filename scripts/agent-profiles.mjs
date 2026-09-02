// Provider-neutral agent profiles and capability selection.
//
// The agent loop owns conversation/tool mechanics. Product integrations mount
// capabilities here; they do not become hidden branches in the loop itself.

export const AGENT_CAPABILITIES = Object.freeze({
  mcp: Object.freeze({
    id: 'mcp',
    label: 'MCP integrations',
    description: 'Tools, resources and prompts supplied by configured MCP servers.',
    toolNames: Object.freeze([]),
  }),
  'logicpilot-process': Object.freeze({
    id: 'logicpilot-process',
    label: 'LogicPilot Process',
    description:
      'Process/DSL model inspection, structured edits, compilation and simulation tools.',
    toolNames: Object.freeze([
      'inspect_model',
      'inspect_selection',
      'inspect_diagnostics',
      'inspect_run_metrics',
      'run_parameter_study',
      'explain_results',
      'optimize_model',
      'compare_runs',
      'apply_model_patch',
      'compile_model',
      'run_simulation',
      'wait_for_run',
      'undo_last_ai_change',
    ]),
  }),
  'logicpilot-process-readonly': Object.freeze({
    id: 'logicpilot-process-readonly',
    label: 'LogicPilot Process (read only)',
    description: 'Inspect Process/DSL models and explain grounded results without mutations.',
    toolNames: Object.freeze([
      'inspect_model',
      'inspect_selection',
      'inspect_diagnostics',
      'inspect_run_metrics',
      'explain_results',
      'compare_runs',
      'wait_for_run',
    ]),
  }),
  'logicpilot-sysml': Object.freeze({
    id: 'logicpilot-sysml',
    label: 'LogicPilot SysML',
    description: 'Project, inspect and edit SysML semantic models.',
    toolNames: Object.freeze([
      'inspect_sysml_projection',
      'auto_layout_sysml_projection',
      'set_sysml_projection_view',
      'focus_sysml_element',
      'move_sysml_element',
      'add_sysml_element',
      'rename_sysml_element',
      'connect_sysml_elements',
      'find_sysml_definition',
      'find_sysml_references',
      'query_sysml_evidence',
      'explain_sysml_run',
      'lower_sysml_state_machine',
    ]),
  }),
  'logicpilot-sysml-readonly': Object.freeze({
    id: 'logicpilot-sysml-readonly',
    label: 'LogicPilot SysML (read only)',
    description: 'Inspect SysML projections and evidence without mutations.',
    toolNames: Object.freeze([
      'inspect_sysml_projection',
      'find_sysml_definition',
      'find_sysml_references',
      'query_sysml_evidence',
      'explain_sysml_run',
    ]),
  }),
  'logicpilot-source-editing': Object.freeze({
    id: 'logicpilot-source-editing',
    label: 'LogicPilot source editing',
    description:
      'Read and edit bounded model, presentation and experiment source files in the active workspace.',
    toolNames: Object.freeze(['read_workspace_file', 'apply_source_patch']),
  }),
  'logicpilot-plugin-authoring': Object.freeze({
    id: 'logicpilot-plugin-authoring',
    label: 'LogicPilot plugin authoring',
    description: 'Create and review permission-gated structured plugin drafts.',
    toolNames: Object.freeze([
      'list_plugin_drafts',
      'create_plugin_draft',
      'validate_plugin_draft',
    ]),
  }),
  'logicpilot-view-planning': Object.freeze({
    id: 'logicpilot-view-planning',
    label: 'LogicPilot view planning',
    description: 'Resolve structured modeling intent to installed canvas views.',
    toolNames: Object.freeze(['plan_view']),
  }),
});

export const GENERAL_AGENT_PROFILE = Object.freeze({
  id: 'general',
  label: 'General agent',
  description: 'A provider-neutral agent with only the capabilities mounted by the host.',
});

export const AGENT_PROFILES = Object.freeze({
  general: GENERAL_AGENT_PROFILE,
  'logicpilot-modeling': Object.freeze({
    id: 'logicpilot-modeling',
    label: 'LogicPilot modeling agent',
    description: 'General agent with the LogicPilot modeling capability mounted.',
    capabilities: Object.freeze(['logicpilot-process', 'logicpilot-sysml']),
  }),
});

export function resolveAgentProfile(id = 'general') {
  return AGENT_PROFILES[id] ?? GENERAL_AGENT_PROFILE;
}

export function normalizeAgentCapabilities(
  value,
  fallback = ['logicpilot-process', 'logicpilot-sysml'],
) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim() !== ''))];
}

export function resolveAgentCapabilities(value, fallback) {
  const ids = normalizeAgentCapabilities(value, fallback);
  return ids.map((id) => AGENT_CAPABILITIES[id]).filter(Boolean);
}

export function hasAgentCapability(value, id) {
  return normalizeAgentCapabilities(value).includes(id);
}
