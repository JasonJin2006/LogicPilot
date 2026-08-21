// Process-scoped MCP host lifecycle for the HTTP/desktop server.

import { McpHost, parseMcpServerConfig } from './mcp-client.mjs';

let activeKey = '';
let activeHost = null;

function configKey(servers) {
  return JSON.stringify(servers);
}

async function getHost() {
  const servers = parseMcpServerConfig();
  const key = configKey(servers);
  if (activeHost !== null && activeKey === key) return activeHost;
  if (activeHost !== null) await activeHost.close();
  activeHost = new McpHost(servers);
  activeKey = key;
  return activeHost;
}

export async function discoverMcpCapabilities(options = {}) {
  const host = await getHost();
  return host.discover(options);
}

function toolParameters(tool) {
  const schema = tool?.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {};
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [
      name,
      {
        type: typeof value?.type === 'string' ? value.type : 'object',
        ...(typeof value?.description === 'string' ? { description: value.description } : {}),
        ...(required.has(name) ? { required: true } : {}),
      },
    ]),
  );
}

export async function listMcpToolDefinitions(options = {}) {
  const discoveries = await discoverMcpCapabilities(options);
  return discoveries.flatMap((discovery) =>
    discovery.tools.map((tool) => ({
      name: `mcp.${discovery.server.id}.${tool.name}`,
      description: `${tool.description ?? `MCP tool ${tool.name}`} (MCP server: ${discovery.server.id})`,
      parameters: toolParameters(tool),
      mcpServerId: discovery.server.id,
      mcpToolName: tool.name,
      readOnly: tool.annotations?.readOnlyHint === true,
    })),
  );
}

export async function callMcpTool(serverId, name, argumentsValue = {}, options = {}) {
  const host = await getHost();
  return host.callTool(serverId, name, argumentsValue, options);
}

export async function closeMcpHost() {
  if (activeHost !== null) await activeHost.close();
  activeHost = null;
  activeKey = '';
}
