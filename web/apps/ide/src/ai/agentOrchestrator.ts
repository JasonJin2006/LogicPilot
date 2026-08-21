import type { AgentProfile } from './agentContracts';
import { getAgentProfile } from './agentProfiles';

export interface AgentRunRequest {
  message: string;
  profileId?: string;
  messages?: readonly unknown[];
}

export interface AgentRunResult {
  profileId: string;
  value: unknown;
}

export type AgentRunner = (profile: AgentProfile, request: AgentRunRequest) => Promise<unknown>;

/**
 * Small host-owned orchestrator for profile routing and handoffs. The Agent
 * loop remains unaware of profiles; a future manager agent can expose these
 * handoffs as tools without changing the execution kernel.
 */
export class AgentOrchestrator {
  constructor(
    private readonly profiles: readonly AgentProfile[],
    private readonly run: AgentRunner,
  ) {}

  async runProfile(request: AgentRunRequest): Promise<AgentRunResult> {
    const profile = this.resolve(request.profileId ?? 'general');
    return { profileId: profile.id, value: await this.run(profile, request) };
  }

  async handoff(
    sourceProfileId: string,
    handoffId: string,
    request: AgentRunRequest,
  ): Promise<AgentRunResult> {
    const source = this.resolve(sourceProfileId);
    const handoff = source.handoffs?.find((candidate) => candidate.id === handoffId);
    if (!handoff) throw new Error(`handoff '${handoffId}' is not available from '${source.id}'`);
    const filteredMessages = handoff.inputFilter?.(request.messages ?? []) ?? request.messages;
    const target = this.resolve(handoff.targetProfileId);
    return {
      profileId: target.id,
      value: await this.run(target, {
        ...request,
        profileId: target.id,
        messages: filteredMessages,
      }),
    };
  }

  private resolve(id: string): AgentProfile {
    const profile = this.profiles.find((candidate) => candidate.id === id) ?? getAgentProfile(id);
    if (!profile) throw new Error(`unknown agent profile '${id}'`);
    return profile;
  }
}
