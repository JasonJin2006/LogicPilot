import { getAppConfig } from '../state/appConfig';
import type { AssistantTool } from './capabilities/logicpilot-modeling/tools';

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  kind: 'tools';
}

export interface McpDiscovery {
  server: { id: string; label?: string; transport?: string };
  tools: McpToolDescriptor[];
  resources: Array<Record<string, unknown>>;
  prompts: Array<Record<string, unknown>>;
}

async function endpoint(path: string, init?: RequestInit, signal?: AbortSignal) {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}${path}`, {
    cache: 'no-store',
    signal,
    ...init,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(String(data?.error ?? `HTTP ${response.status}`));
  return data as Record<string, unknown>;
}

export async function discoverMcpCapabilities(signal?: AbortSignal): Promise<McpDiscovery[]> {
  const data = await endpoint('/api/mcp/capabilities', undefined, signal);
  return Array.isArray(data.servers) ? (data.servers as McpDiscovery[]) : [];
}

function validateMcpArguments(
  args: Record<string, unknown>,
  schema: Record<string, unknown> | undefined,
): string | null {
  const properties =
    schema?.properties !== null && typeof schema?.properties === 'object'
      ? (schema.properties as Record<string, { type?: string }>)
      : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  for (const key of Object.keys(args)) {
    if (!(key in properties)) return `unknown MCP argument '${key}'`;
    const expected = properties[key]?.type;
    if (expected === 'string' && typeof args[key] !== 'string') return `${key} must be a string`;
    if (expected === 'number' && typeof args[key] !== 'number') return `${key} must be a number`;
    if (expected === 'boolean' && typeof args[key] !== 'boolean') return `${key} must be a boolean`;
  }
  for (const key of required) {
    if (typeof key === 'string' && args[key] === undefined) return `${key} is required`;
  }
  return null;
}

export function createMcpTools(discoveries: readonly McpDiscovery[]): AssistantTool[] {
  return discoveries.flatMap((discovery) =>
    discovery.tools.map((descriptor) => ({
      name: `mcp.${discovery.server.id}.${descriptor.name}`,
      description: descriptor.description ?? `MCP tool ${descriptor.name}`,
      executionMode: 'serial' as const,
      requiresApproval: descriptor.annotations?.readOnlyHint !== true,
      parameters: {},
      validate: (args: Record<string, unknown>) =>
        validateMcpArguments(args, descriptor.inputSchema),
      execute: async (args: Record<string, unknown>, context) => {
        const response = await callMcpTool(
          discovery.server.id,
          descriptor.name,
          args,
          context.signal,
        );
        return response.result &&
          typeof response.result === 'object' &&
          !Array.isArray(response.result)
          ? (response.result as Record<string, unknown>)
          : { content: response.result };
      },
    })),
  );
}

export function callMcpTool(
  serverId: string,
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<{ ok: true; result: unknown }> {
  return endpoint(
    '/api/mcp/call',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverId, name, arguments: args }),
    },
    signal,
  ) as Promise<{ ok: true; result: unknown }>;
}
