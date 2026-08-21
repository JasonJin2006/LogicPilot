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
  'logicpilot-modeling': Object.freeze({
    id: 'logicpilot-modeling',
    label: 'LogicPilot modeling',
    description: 'Model inspection, structured edits, compilation and simulation tools.',
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
  'logicpilot-modeling-readonly': Object.freeze({
    id: 'logicpilot-modeling-readonly',
    label: 'LogicPilot modeling (read only)',
    description: 'Inspect the current model and explain grounded results without mutations.',
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
  'logicpilot-source-editing': Object.freeze({
    id: 'logicpilot-source-editing',
    label: 'LogicPilot source editing',
    description: 'Read and edit bounded model, presentation and experiment source files in the active workspace.',
    toolNames: Object.freeze(['read_workspace_file', 'apply_source_patch']),
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
    capabilities: Object.freeze(['logicpilot-modeling']),
  }),
});

export function resolveAgentProfile(id = 'general') {
  return AGENT_PROFILES[id] ?? GENERAL_AGENT_PROFILE;
}

export function normalizeAgentCapabilities(value, fallback = ['logicpilot-modeling']) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string' && item.trim() !== ''))];
}

export function resolveAgentCapabilities(value, fallback) {
  const ids = normalizeAgentCapabilities(value, fallback);
  return ids
    .map((id) => AGENT_CAPABILITIES[id])
    .filter(Boolean);
}

export function hasAgentCapability(value, id) {
  return normalizeAgentCapabilities(value).includes(id);
}
