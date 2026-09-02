import type { AgentProfile } from './agentContracts';

export const GENERAL_AGENT_PROFILE: AgentProfile = Object.freeze({
  id: 'general',
  label: 'General agent',
  description: 'A provider-neutral agent with only host-mounted capabilities.',
  capabilityIds: [],
  handoffs: [
    {
      id: 'to-logicpilot-modeling',
      targetProfileId: 'logicpilot-modeling',
      description: 'Delegate a model construction or simulation task to the LogicPilot capability.',
    },
  ],
});

export const LOGICPILOT_MODELING_PROFILE: AgentProfile = Object.freeze({
  id: 'logicpilot-modeling',
  label: 'LogicPilot modeling agent',
  description: 'General Agent with the LogicPilot modeling capability mounted by the IDE.',
  capabilityIds: ['logicpilot-process', 'logicpilot-sysml'],
  skillIds: ['logicpilot-modeling-basics'],
});

export const AGENT_PROFILES: readonly AgentProfile[] = Object.freeze([
  GENERAL_AGENT_PROFILE,
  LOGICPILOT_MODELING_PROFILE,
]);

export function getAgentProfile(id: string): AgentProfile | undefined {
  return AGENT_PROFILES.find((profile) => profile.id === id);
}
