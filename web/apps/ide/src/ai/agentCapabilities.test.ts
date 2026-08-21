import { describe, expect, it } from 'vitest';
import {
  AgentCapabilityRegistry,
  AgentHandoffRegistry,
  AgentMcpRegistry,
  AgentSkillRegistry,
} from './agentContracts';
import {
  AGENT_CAPABILITY_REGISTRY,
  LOGICPILOT_MODELING_CAPABILITY,
  resolveAgentTools,
} from './agentCapabilities';
import { GENERAL_AGENT_PROFILE, LOGICPILOT_MODELING_PROFILE } from './agentProfiles';
import { AgentOrchestrator } from './agentOrchestrator';

describe('agent capability contracts', () => {
  it('keeps the general profile tool-free and mounts modeling explicitly', () => {
    expect(GENERAL_AGENT_PROFILE.capabilityIds).toEqual([]);
    expect(LOGICPILOT_MODELING_PROFILE.capabilityIds).toEqual(['logicpilot-modeling']);
    expect(resolveAgentTools(GENERAL_AGENT_PROFILE.capabilityIds)).toEqual([]);
    expect(resolveAgentTools(LOGICPILOT_MODELING_PROFILE.capabilityIds).length).toBeGreaterThan(0);
  });

  it('registers and removes capability packages without coupling the registry to a host', () => {
    const registry = new AgentCapabilityRegistry();
    const capability = {
      ...LOGICPILOT_MODELING_CAPABILITY,
      id: 'test-capability',
      tools: [],
    };
    const dispose = registry.register(capability);
    expect(registry.get('test-capability')).toBe(capability);
    expect(() => registry.register(capability)).toThrow(/already registered/);
    dispose();
    expect(registry.get('test-capability')).toBeUndefined();
  });

  it('exposes the mounted LogicPilot capability through a stable registry', () => {
    expect(AGENT_CAPABILITY_REGISTRY.get('logicpilot-modeling')).toBe(
      LOGICPILOT_MODELING_CAPABILITY,
    );
  });

  it('keeps Skill and MCP registration as separate host-owned seams', () => {
    const skills = new AgentSkillRegistry();
    const skill = { id: 'skill.test', description: 'test', instructions: 'do test work' };
    const disposeSkill = skills.register(skill);
    expect(skills.list()).toEqual([skill]);
    disposeSkill();
    expect(skills.list()).toEqual([]);

    const mcp = new AgentMcpRegistry();
    const server = {
      id: 'mcp.test',
      label: 'Test MCP',
      transport: 'stdio' as const,
      command: 'node',
    };
    const disposeServer = mcp.register(server);
    expect(mcp.get('mcp.test')).toEqual(server);
    disposeServer();
    expect(mcp.list()).toEqual([]);

    const handoffs = new AgentHandoffRegistry();
    const handoff = {
      id: 'to-modeling',
      targetProfileId: 'logicpilot-modeling',
      description: 'Delegate model construction to the modeling profile',
    };
    const disposeHandoff = handoffs.register(handoff);
    expect(handoffs.get('to-modeling')).toBe(handoff);
    disposeHandoff();
    expect(handoffs.list()).toEqual([]);
  });

  it('routes a handoff without putting orchestration logic into the Agent loop', async () => {
    const calls: string[] = [];
    const orchestrator = new AgentOrchestrator(
      [GENERAL_AGENT_PROFILE, LOGICPILOT_MODELING_PROFILE],
      async (profile, request) => {
        calls.push(`${profile.id}:${request.message}`);
        return { profile: profile.id };
      },
    );
    const result = await orchestrator.handoff('general', 'to-logicpilot-modeling', {
      message: 'build a queue',
    });
    expect(result.profileId).toBe('logicpilot-modeling');
    expect(calls).toEqual(['logicpilot-modeling:build a queue']);
  });
});
