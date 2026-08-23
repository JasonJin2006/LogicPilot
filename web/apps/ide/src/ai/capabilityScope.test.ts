import { describe, expect, it } from 'vitest';
import {
  AGENT_CAPABILITY_REGISTRY,
  LOGICPILOT_MODELING_CAPABILITY,
  LOGICPILOT_MODELING_READONLY_CAPABILITY,
} from './agentCapabilities';

const toolNames = (tools: readonly { name: string }[]) => tools.map((tool) => tool.name);

describe('agent capability scoped tool discovery', () => {
  it('keeps the full mounted set when no scope is given (legacy behavior)', () => {
    const names = toolNames(AGENT_CAPABILITY_REGISTRY.tools(['logicpilot-modeling']));
    expect(names).toContain('inspect_model');
    expect(names).toContain('apply_model_patch');
    expect(names).toContain('inspect_sysml_projection');
  });

  it('mounts only SysML projection tools for an active .sysml document', () => {
    const names = toolNames(
      AGENT_CAPABILITY_REGISTRY.tools(['logicpilot-modeling'], { documentType: 'sysml' }),
    );
    expect(names).toContain('inspect_sysml_projection');
    expect(names).toContain('move_sysml_element');
    // DSL graph mutations must not be offered against a foreign document.
    expect(names).not.toContain('apply_model_patch');
    expect(names).not.toContain('start_run');
  });

  it('mounts DSL modeling tools without projection tools for DSL documents', () => {
    const dslNames = toolNames(
      LOGICPILOT_MODELING_CAPABILITY.toolsForScope!({ documentType: 'dsl' }),
    );
    expect(dslNames).toContain('apply_model_patch');
    expect(dslNames).not.toContain('inspect_sysml_projection');
    // No contribution-backed active document behaves like the DSL canvas.
    const nullNames = toolNames(
      LOGICPILOT_MODELING_CAPABILITY.toolsForScope!({ documentType: null }),
    );
    expect(nullNames).toEqual(dslNames);
  });

  it('applies the read-only whitelist inside scoped discovery too', () => {
    const names = toolNames(
      AGENT_CAPABILITY_REGISTRY.tools(['logicpilot-modeling-readonly'], { documentType: 'sysml' }),
    );
    expect(names).toEqual(['inspect_sysml_projection']);
    const dslNames = toolNames(
      AGENT_CAPABILITY_REGISTRY.tools(['logicpilot-modeling-readonly'], { documentType: 'dsl' }),
    );
    expect(dslNames).toContain('inspect_model');
    expect(dslNames).not.toContain('apply_model_patch');
  });

  it('capabilities without toolsForScope keep serving their static tools in every scope', () => {
    const names = toolNames(
      AGENT_CAPABILITY_REGISTRY.tools(['logicpilot-source-editing'], { documentType: 'sysml' }),
    );
    expect(names.length).toBeGreaterThan(0);
  });
});
