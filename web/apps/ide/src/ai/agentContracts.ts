// Provider-neutral Agent contracts.
//
// These types deliberately contain no editor, DSL, DES or browser concepts.
// Host integrations register capabilities against this seam and the Agent
// Runtime consumes only the normalized tool/context/prompt surfaces.

export interface AgentTool<Context = unknown> {
  name: string;
  description: string;
  executionMode?: 'serial' | 'parallel';
  requiresApproval?: boolean;
  parameters: Record<string, unknown>;
  validate: (args: Record<string, unknown>) => string | null;
  execute(
    args: Record<string, unknown>,
    context: Context,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface AgentContextContribution {
  id: string;
  content: string;
  priority?: number;
}

export interface AgentContextProvider {
  id: string;
  priority?: number;
  get: (
    context: unknown,
    signal?: AbortSignal,
  ) =>
    | AgentContextContribution
    | AgentContextContribution[]
    | null
    | Promise<AgentContextContribution | AgentContextContribution[] | null>;
}

export interface AgentPromptContribution {
  id: string;
  order?: number;
  get: (context: unknown) => string | null | Promise<string | null>;
}

export interface AgentCapability {
  id: string;
  version: string;
  label: string;
  description?: string;
  tools?: readonly AgentTool[];
  contextProviders?: readonly AgentContextProvider[];
  promptContributors?: readonly AgentPromptContribution[];
  /**
   * Optional dynamic tool discovery (workbench-architecture-plan.md §7):
   * return the subset of this capability's tools that apply to the given
   * scope, typically the active document's contribution type. When absent,
   * `tools` applies to every scope.
   */
  toolsForScope?: (scope: AgentToolScope) => readonly AgentTool[];
}

/**
 * Where a turn runs: the active document's registered Workbench contribution
 * id (or null when nothing contribution-backed is active). Deliberately
 * free of editor/DSL concepts - hosts map their own document model onto it.
 */
export interface AgentToolScope {
  documentType?: string | null;
}

export interface AgentSkillManifest {
  id: string;
  description: string;
  instructions: string;
  userInvocable?: boolean;
  modelInvocable?: boolean;
  capabilityIds?: readonly string[];
}

export interface AgentMcpServerDefinition {
  id: string;
  label: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  endpoint?: string;
  command?: string;
  args?: readonly string[];
  enabled?: boolean;
}

export interface AgentProfile {
  id: string;
  label: string;
  description: string;
  capabilityIds: readonly string[];
  skillIds?: readonly string[];
  mcpServerIds?: readonly string[];
  handoffs?: readonly AgentHandoff[];
}

export interface AgentHandoff {
  id: string;
  targetProfileId: string;
  description: string;
  inputFilter?: (messages: readonly unknown[]) => readonly unknown[];
}

export class AgentCapabilityRegistry {
  private readonly capabilities = new Map<string, AgentCapability>();

  register(capability: AgentCapability): () => void {
    if (capability.id.trim() === '') throw new Error('agent capability id is required');
    if (this.capabilities.has(capability.id)) {
      throw new Error(`agent capability '${capability.id}' is already registered`);
    }
    this.capabilities.set(capability.id, capability);
    return () => {
      if (this.capabilities.get(capability.id) === capability)
        this.capabilities.delete(capability.id);
    };
  }

  get(id: string): AgentCapability | undefined {
    return this.capabilities.get(id);
  }

  list(): readonly AgentCapability[] {
    return [...this.capabilities.values()];
  }

  resolve(ids: readonly string[] | undefined): readonly AgentCapability[] {
    if (ids === undefined) return this.list();
    return ids.map((id) => this.capabilities.get(id)).filter(Boolean) as AgentCapability[];
  }

  tools(ids: readonly string[] | undefined, scope?: AgentToolScope): readonly AgentTool[] {
    const tools = this.resolve(ids).flatMap((capability) =>
      scope === undefined ? (capability.tools ?? []) : (capability.toolsForScope?.(scope) ?? capability.tools ?? []),
    );
    return [...new Map(tools.map((tool) => [tool.name, tool])).values()];
  }
}

export class AgentSkillRegistry {
  private readonly skills = new Map<string, AgentSkillManifest>();

  register(skill: AgentSkillManifest): () => void {
    if (skill.id.trim() === '') throw new Error('agent skill id is required');
    if (this.skills.has(skill.id))
      throw new Error(`agent skill '${skill.id}' is already registered`);
    this.skills.set(skill.id, skill);
    return () => {
      if (this.skills.get(skill.id) === skill) this.skills.delete(skill.id);
    };
  }

  get(id: string): AgentSkillManifest | undefined {
    return this.skills.get(id);
  }

  list(): readonly AgentSkillManifest[] {
    return [...this.skills.values()];
  }
}

export class AgentMcpRegistry {
  private readonly servers = new Map<string, AgentMcpServerDefinition>();

  register(server: AgentMcpServerDefinition): () => void {
    if (server.id.trim() === '') throw new Error('MCP server id is required');
    if (this.servers.has(server.id))
      throw new Error(`MCP server '${server.id}' is already registered`);
    this.servers.set(server.id, server);
    return () => {
      if (this.servers.get(server.id) === server) this.servers.delete(server.id);
    };
  }

  get(id: string): AgentMcpServerDefinition | undefined {
    return this.servers.get(id);
  }

  list(): readonly AgentMcpServerDefinition[] {
    return [...this.servers.values()];
  }
}

export class AgentHandoffRegistry {
  private readonly handoffs = new Map<string, AgentHandoff>();

  register(handoff: AgentHandoff): () => void {
    if (handoff.id.trim() === '') throw new Error('agent handoff id is required');
    if (this.handoffs.has(handoff.id))
      throw new Error(`agent handoff '${handoff.id}' is already registered`);
    this.handoffs.set(handoff.id, handoff);
    return () => {
      if (this.handoffs.get(handoff.id) === handoff) this.handoffs.delete(handoff.id);
    };
  }

  get(id: string): AgentHandoff | undefined {
    return this.handoffs.get(id);
  }

  list(): readonly AgentHandoff[] {
    return [...this.handoffs.values()];
  }
}
