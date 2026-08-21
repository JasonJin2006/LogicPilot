// Minimal MCP host for LogicPilot.
//
// Transport concerns stay here. The Agent Core only receives normalized
// capability records and never spawns a process or speaks JSON-RPC itself.

import { spawn } from 'node:child_process';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGE_COUNT = 100;

export class McpClientError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'McpClientError';
    this.code = options.code;
    this.serverId = options.serverId;
  }
}

function assertServerDefinition(server) {
  if (!server || typeof server !== 'object') throw new McpClientError('invalid MCP server definition');
  if (typeof server.id !== 'string' || server.id.trim() === '')
    throw new McpClientError('MCP server id is required');
  if (server.transport !== 'stdio')
    throw new McpClientError(`MCP transport '${server.transport}' is not implemented`, {
      code: 'MCP_TRANSPORT_UNSUPPORTED',
      serverId: server.id,
    });
  if (typeof server.command !== 'string' || server.command.trim() === '')
    throw new McpClientError(`MCP server '${server.id}' command is required`, { serverId: server.id });
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeItems(items, kind) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ ...item, kind }))
    .filter((item) => safeString(item.name) !== '');
}

export class McpStdioConnection {
  constructor(server, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    assertServerDefinition(server);
    this.server = server;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.buffer = '';
    this.nextId = 0;
    this.pending = new Map();
    this.initialized = false;
    this.connecting = null;
  }

  async connect() {
    if (this.initialized) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.#connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async #connect() {
    const env = { ...process.env };
    for (const [key, value] of Object.entries(this.server.env ?? {})) {
      if (typeof key === 'string' && typeof value === 'string') env[key] = value;
    }
    const child = spawn(this.server.command, Array.isArray(this.server.args) ? this.server.args : [], {
      cwd: typeof this.server.cwd === 'string' ? this.server.cwd : undefined,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#consume(String(chunk)));
    child.stderr.on('data', () => {
      // MCP stderr is diagnostic output and must never corrupt the JSON-RPC stream.
    });
    child.on('error', (error) => this.#failPending(error));
    child.on('exit', (code, signal) => {
      this.initialized = false;
      this.#failPending(
        new McpClientError(`MCP server '${this.server.id}' exited (${code ?? signal ?? 'unknown'})`, {
          code: 'MCP_SERVER_EXITED',
          serverId: this.server.id,
        }),
      );
      this.child = null;
    });
    try {
      await this.request('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'LogicPilot', version: '0.0.1' },
      });
      this.notify('notifications/initialized', {});
      this.initialized = true;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  #consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Number.isInteger(message?.id)) continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.cleanup?.();
      if (message.error) {
        pending.reject(
          new McpClientError(message.error.message ?? 'MCP JSON-RPC request failed', {
            code: message.error.code,
            serverId: this.server.id,
          }),
        );
      } else pending.resolve(message.result ?? {});
    }
  }

  #failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}, { signal } = {}) {
    if (signal?.aborted) {
      return Promise.reject(new McpClientError(`MCP request '${method}' aborted`, { code: 'MCP_ABORTED', serverId: this.server.id }));
    }
    const child = this.child;
    if (!child?.stdin?.writable) {
      return Promise.reject(
        new McpClientError(`MCP server '${this.server.id}' is not connected`, {
          code: 'MCP_NOT_CONNECTED',
          serverId: this.server.id,
        }),
      );
    }
    const id = ++this.nextId;
    const message = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanup();
        reject(
          new McpClientError(`MCP request '${method}' timed out`, {
            code: 'MCP_TIMEOUT',
            serverId: this.server.id,
          }),
        );
      }, this.timeoutMs);
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        cleanup();
        reject(new McpClientError(`MCP request '${method}' aborted`, { code: 'MCP_ABORTED', serverId: this.server.id }));
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve, reject, timer, cleanup });
      child.stdin.write(message, (error) => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timer);
        cleanup();
        reject(error);
      });
    });
  }

  notify(method, params = {}) {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async list(method, key, options = {}) {
    const items = [];
    let cursor;
    for (let page = 0; page < MAX_PAGE_COUNT; ++page) {
      const result = await this.request(method, cursor ? { cursor } : {}, options);
      items.push(...normalizeItems(result?.[key], key));
      cursor = safeString(result?.nextCursor);
      if (!cursor) break;
    }
    return items;
  }

  async discover(options = {}) {
    await this.connect();
    const optionalList = async (method, key) => {
      try {
        return await this.list(method, key, options);
      } catch (error) {
        // MCP servers may legitimately omit resources/prompts; an unsupported
        // method must not hide the tools they do provide.
        if (error?.code === -32601 || /method not found|not implemented/i.test(error?.message ?? '')) {
          return [];
        }
        throw error;
      }
    };
    const [tools, resources, prompts] = await Promise.all([
      this.list('tools/list', 'tools', options),
      optionalList('resources/list', 'resources'),
      optionalList('prompts/list', 'prompts'),
    ]);
    return { server: this.server, tools, resources, prompts };
  }

  async callTool(name, argumentsValue = {}, options = {}) {
    await this.connect();
    return this.request('tools/call', { name, arguments: argumentsValue }, options);
  }

  async close() {
    this.#failPending(new McpClientError('MCP connection closed', { code: 'MCP_CLOSED' }));
    const child = this.child;
    this.child = null;
    this.initialized = false;
    if (!child) return;
    child.kill();
  }
}

export class McpHost {
  constructor(servers = []) {
    this.servers = new Map();
    this.connections = new Map();
    for (const server of servers) {
      assertServerDefinition(server);
      this.servers.set(server.id, server);
    }
  }

  async discover(options = {}) {
    const result = [];
    for (const server of this.servers.values()) {
      const connection = this.connections.get(server.id) ?? new McpStdioConnection(server);
      this.connections.set(server.id, connection);
      result.push(await connection.discover(options));
    }
    return result;
  }

  async callTool(serverId, name, argumentsValue = {}, options = {}) {
    const server = this.servers.get(serverId);
    if (!server) throw new McpClientError(`unknown MCP server '${serverId}'`, { serverId });
    const connection = this.connections.get(serverId) ?? new McpStdioConnection(server);
    this.connections.set(serverId, connection);
    return connection.callTool(name, argumentsValue, options);
  }

  async close() {
    await Promise.all([...this.connections.values()].map((connection) => connection.close()));
    this.connections.clear();
  }
}

export function parseMcpServerConfig(value = process.env.LOGICPILOT_MCP_SERVERS) {
  if (!value || value.trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new McpClientError('LOGICPILOT_MCP_SERVERS must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length > 16) {
    throw new McpClientError('LOGICPILOT_MCP_SERVERS must contain 0..16 servers');
  }
  return parsed.map((server) => {
    assertServerDefinition(server);
    return {
      id: server.id,
      label: safeString(server.label, server.id),
      transport: 'stdio',
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      cwd: server.cwd,
      env: server.env,
    };
  });
}
