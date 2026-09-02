// Test-only descriptor fixture. Production assistant requests receive their
// descriptors from the mounted capability registries at runtime.
const names = [
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
  'read_workspace_file',
  'apply_source_patch',
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
  'list_plugin_drafts',
  'create_plugin_draft',
  'validate_plugin_draft',
  'plan_view',
];

export const TEST_TOOL_DESCRIPTORS = Object.freeze(
  names.map((name) => ({
    name,
    description: `test descriptor for ${name}`,
    parameters: {
      ...(name === 'apply_model_patch'
        ? {
            patch: { type: 'object', required: true },
            summary: { type: 'string', required: true },
          }
        : {}),
      ...(name === 'run_parameter_study'
        ? {
            experimentName: { type: 'string' },
            arrivals: { type: 'number' },
            warmup: { type: 'number' },
            concurrency: { type: 'number' },
          }
        : {}),
    },
  })),
);
