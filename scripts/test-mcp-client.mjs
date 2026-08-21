import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { McpHost, parseMcpServerConfig } from './mcp-client.mjs';
import { listMcpToolDefinitions, closeMcpHost } from './mcp-runtime.mjs';

const root = await mkdtemp(join(tmpdir(), 'logicpilot-mcp-'));
const fixture = join(root, 'fixture.mjs');
await writeFile(
  fixture,
  [
    "import readline from 'node:readline';",
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', (line) => {",
    '  const message = JSON.parse(line);',
    '  if (message.id === undefined) return;',
    '  let result = {};',
    "  if (message.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'fixture', version: '1' } };",
    "  else if (message.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] };",
    "  else if (message.method === 'resources/list') result = { resources: [{ uri: 'memory://fixture', name: 'Fixture memory' }] };",
    "  else if (message.method === 'prompts/list') result = { prompts: [{ name: 'summarize', description: 'Summarize' }] };",
    "  else if (message.method === 'tools/call') result = { content: [{ type: 'text', text: String(message.params.arguments.text) }] };",
    '  process.stdout.write(JSON.stringify({ jsonrpc: \'2.0\', id: message.id, result }) + \'\\n\');',
    '});',
  ].join('\n'),
);

const servers = parseMcpServerConfig(
  JSON.stringify([{ id: 'fixture', transport: 'stdio', command: process.execPath, args: [fixture] }]),
);
const host = new McpHost(servers);
try {
  const [discovery] = await host.discover();
  assert.equal(discovery.tools[0].name, 'echo');
  assert.equal(discovery.resources[0].uri, 'memory://fixture');
  assert.equal(discovery.prompts[0].name, 'summarize');
  const result = await host.callTool('fixture', 'echo', { text: 'hello' });
  assert.equal(result.content[0].text, 'hello');
  process.env.LOGICPILOT_MCP_SERVERS = JSON.stringify(servers);
  const definitions = await listMcpToolDefinitions();
  assert.equal(definitions[0].name, 'mcp.fixture.echo');
  assert.equal(definitions[0].mcpToolName, 'echo');
  console.log('MCP-CLIENT TEST: PASS');
} finally {
  await host.close();
  await closeMcpHost();
  delete process.env.LOGICPILOT_MCP_SERVERS;
  await rm(root, { recursive: true, force: true });
}
