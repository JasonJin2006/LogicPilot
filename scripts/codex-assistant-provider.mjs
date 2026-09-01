// Codex CLI provider for the LogicPilot assistant.
//
// This adapter deliberately delegates authentication to the installed Codex
// CLI. A prior `codex login` (including Sign in with ChatGPT) is reused; this
// module never reads ~/.codex/auth.json or handles ChatGPT access tokens.
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const TOOL_NAMES = [
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
];

export function createCodexAssistantOutputSchema(toolNames = TOOL_NAMES) {
  const names = [...new Set(toolNames.filter((name) => typeof name === 'string' && name !== ''))];
  return {
    type: 'object',
    properties: {
      message: { type: 'string' },
      plan: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, label: { type: 'string' } },
          required: ['id', 'label'],
          additionalProperties: false,
        },
      },
      toolCalls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', enum: names },
            // Codex structured outputs require additionalProperties:false for
            // every object. Encode the variable tool payload as JSON text and
            // decode it before the shared assistant validator sees it.
            arguments: { type: 'string' },
          },
          required: ['id', 'name', 'arguments'],
          additionalProperties: false,
        },
      },
      done: { type: 'boolean' },
    },
    required: ['message', 'plan', 'toolCalls', 'done'],
    additionalProperties: false,
  };
}

export const CODEX_ASSISTANT_OUTPUT_SCHEMA = Object.freeze(createCodexAssistantOutputSchema());

export function buildCodexExecArgs({ directory, schemaPath, outputPath, model }) {
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ignore-user-config',
    '--ignore-rules',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath,
    '--color',
    'never',
    '--cd',
    directory,
  ];
  if (model) args.push('--model', model);
  args.push('-');
  return args;
}

export function buildCodexAppServerArgs() {
  return ['app-server', '--listen', 'stdio://'];
}

export function parseCodexAssistantOutput(content) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('Codex CLI returned an empty assistant response');
  }
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse(fenced ? fenced[1] : content);
  } catch {
    throw new Error('Codex CLI returned malformed JSON');
  }
}

export function normalizeCodexAssistantOutput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  if (!Array.isArray(value.toolCalls)) return value;
  return {
    ...value,
    toolCalls: value.toolCalls.map((call) => {
      if (call === null || typeof call !== 'object' || typeof call.arguments !== 'string') {
        return call;
      }
      let argumentsValue;
      try {
        argumentsValue = JSON.parse(call.arguments);
      } catch {
        throw new Error(`Codex CLI returned malformed arguments for tool call '${call.id ?? ''}'`);
      }
      return { ...call, arguments: argumentsValue };
    }),
  };
}

function boundedAppend(current, chunk, maximum = 64 * 1024) {
  const next = current + String(chunk);
  return next.length <= maximum ? next : next.slice(-maximum);
}

function errorDetail(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function runProcess({ executable, args, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`Codex CLI timed out after ${timeoutMs} ms`)));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })));
    child.stdin.end(input);
  });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a shell-free Codex launch. Windows npm shims are .cmd files,
 * which Node cannot spawn safely without shell:true, so invoke the installed
 * codex.js through the current Node executable instead. */
export async function resolveCodexLaunch(configuredPath = process.env.LOGICPILOT_CODEX_PATH) {
  if (configuredPath) {
    if (/\.js$/i.test(configuredPath)) {
      return { executable: process.execPath, prefixArgs: [configuredPath] };
    }
    if (/\.cmd$/i.test(configuredPath)) {
      const candidate = join(
        dirname(configuredPath),
        'node_modules',
        '@openai',
        'codex',
        'bin',
        'codex.js',
      );
      if (await pathExists(candidate)) {
        return { executable: process.execPath, prefixArgs: [candidate] };
      }
      throw new Error('LOGICPILOT_CODEX_PATH points to a .cmd shim without an adjacent codex.js');
    }
    return { executable: configuredPath, prefixArgs: [] };
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    const npmModule = join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    if (await pathExists(npmModule)) {
      return { executable: process.execPath, prefixArgs: [npmModule] };
    }
    return { executable: 'codex.exe', prefixArgs: [] };
  }
  return { executable: 'codex', prefixArgs: [] };
}

/**
 * Minimal JSONL client for the stable Codex app-server surface. One process is
 * reused across assistant steps, while every step gets a fresh Codex thread so
 * LogicPilot remains the sole owner of conversation state.
 */
export class CodexAppServerClient {
  constructor({ launch, spawnImpl = spawn } = {}) {
    this.launch = launch;
    this.spawnImpl = spawnImpl;
    this.child = undefined;
    this.startPromise = undefined;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.turns = new Map();
    this.stdoutBuffer = '';
    this.stderr = '';
    this.activeRuns = 0;
    this.exitHandler = () => this.close();
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    if (this.child) return;
    this.startPromise = this.#startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async #startProcess() {
    const launch = this.launch ?? (await resolveCodexLaunch());
    const child = this.spawnImpl(
      launch.executable,
      [...launch.prefixArgs, ...buildCodexAppServerArgs()],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: process.env,
        cwd: tmpdir(),
      },
    );
    this.child = child;
    child.stdout.on('data', (chunk) => this.#consumeStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderr = boundedAppend(this.stderr, chunk);
    });
    child.on('error', (error) => this.#failAll(error));
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      process.removeListener('exit', this.exitHandler);
      this.#failAll(new Error(`Codex app-server exited with code ${code ?? 'unknown'}`));
    });
    process.once('exit', this.exitHandler);
    await this.request(
      'initialize',
      {
        clientInfo: {
          name: 'logicpilot',
          title: 'LogicPilot AI Assistant',
          version: '0.1.0',
        },
        capabilities: {
          optOutNotificationMethods: ['item/agentMessage/delta'],
        },
      },
      15_000,
    );
    this.notify('initialized', {});
  }

  #consumeStdout(chunk) {
    this.stdoutBuffer += String(chunk);
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        try {
          this.#handleMessage(JSON.parse(line));
        } catch (error) {
          this.#failAll(
            new Error(`Codex app-server returned malformed JSON: ${errorDetail(error)}`),
          );
        }
      }
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  #handleMessage(message) {
    if (Object.hasOwn(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Codex app-server request failed'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (Object.hasOwn(message, 'id') && message.method) {
      this.#declineServerRequest(message);
      return;
    }
    const { method, params = {} } = message;
    const state = this.turns.get(params.threadId);
    if (!state) return;
    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      if (params.item.phase === 'final_answer') state.finalMessage = params.item.text;
      state.lastMessage = params.item.text;
    } else if (method === 'error') {
      state.lastError = params.error?.message ?? 'Codex turn failed';
    } else if (method === 'turn/completed') {
      clearTimeout(state.timer);
      this.turns.delete(params.threadId);
      const turn = params.turn ?? {};
      if (turn.status !== 'completed') {
        state.reject(
          new Error(
            turn.error?.message ?? state.lastError ?? `Codex turn ${turn.status ?? 'failed'}`,
          ),
        );
      } else {
        state.resolve(state.finalMessage ?? state.lastMessage ?? '');
      }
    }
  }

  #declineServerRequest(message) {
    let result;
    if (message.method === 'item/permissions/requestApproval') {
      result = { permissions: [], scope: 'turn' };
    } else if (/requestApproval$/.test(message.method)) result = { decision: 'decline' };
    else if (message.method === 'mcpServer/elicitation/request') {
      result = { action: 'decline', content: null };
    } else if (message.method === 'tool/requestUserInput') result = { answers: {} };
    if (result) this.#write({ id: message.id, result });
    else {
      this.#write({
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${message.method}` },
      });
    }
  }

  #write(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server is not running');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = 15_000) {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.#write({ method, params });
  }

  #setReferenced(referenced) {
    const operation = referenced ? 'ref' : 'unref';
    this.child?.[operation]?.();
    this.child?.stdin?.[operation]?.();
    this.child?.stdout?.[operation]?.();
    this.child?.stderr?.[operation]?.();
  }

  async runTurn({ prompt, model, outputSchema, timeoutMs }) {
    await this.start();
    this.activeRuns += 1;
    this.#setReferenced(true);
    let threadId;
    try {
      const threadResult = await this.request('thread/start', {
        ...(model ? { model } : {}),
        cwd: tmpdir(),
        approvalPolicy: 'never',
        // thread/start uses the legacy kebab-case sandbox enum even though
        // turn/start uses the structured readOnly policy.
        sandbox: 'read-only',
        serviceName: 'logicpilot_ai_assistant',
      });
      threadId = threadResult?.thread?.id;
      if (!threadId) throw new Error('Codex app-server did not return a thread id');
      let turnId;
      try {
        let turnState;
        const contentPromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.turns.delete(threadId);
            void (async () => {
              if (turnId) {
                await this.request('turn/interrupt', { threadId, turnId }, 5_000).catch(() => {});
              }
              reject(new Error(`Codex app-server turn timed out after ${timeoutMs} ms`));
            })();
          }, timeoutMs);
          turnState = {
            resolve,
            reject,
            timer,
            finalMessage: '',
            lastMessage: '',
            lastError: '',
          };
          this.turns.set(threadId, turnState);
        });
        let turnResult;
        try {
          turnResult = await this.request(
            'turn/start',
            {
              threadId,
              input: [{ type: 'text', text: prompt }],
              approvalPolicy: 'never',
              sandboxPolicy: { type: 'readOnly', access: { type: 'fullAccess' } },
              ...(model ? { model } : {}),
              outputSchema,
            },
            15_000,
          );
        } catch (error) {
          clearTimeout(turnState.timer);
          this.turns.delete(threadId);
          turnState.reject(error);
          await contentPromise.catch(() => {});
          throw error;
        }
        turnId = turnResult?.turn?.id;
        return await contentPromise;
      } finally {
        // These are integration-owned scratch conversations. Removing them keeps
        // the user's Codex history clean and cannot affect user-created threads.
        await this.request('thread/delete', { threadId }, 5_000).catch(() => {});
      }
    } finally {
      this.activeRuns -= 1;
      if (this.activeRuns === 0) this.#setReferenced(false);
    }
  }

  #failAll(error) {
    const detail = this.stderr.trim().split(/\r?\n/).slice(-3).join(' ');
    const failure = new Error(`${errorDetail(error)}${detail ? `: ${detail}` : ''}`);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(failure);
    }
    this.pending.clear();
    for (const state of this.turns.values()) {
      clearTimeout(state.timer);
      state.reject(failure);
    }
    this.turns.clear();
  }

  close() {
    const child = this.child;
    this.child = undefined;
    if (child) child.kill();
    process.removeListener('exit', this.exitHandler);
    this.#failAll(new Error('Codex app-server closed'));
  }
}

let sharedAppServer;

async function getSharedAppServer(configuredPath) {
  if (!sharedAppServer) {
    const launch = await resolveCodexLaunch(configuredPath);
    sharedAppServer = new CodexAppServerClient({ launch });
  }
  return sharedAppServer;
}

export function closeSharedCodexAppServer() {
  sharedAppServer?.close();
  sharedAppServer = undefined;
}

async function runCodexAssistantExec({
  systemPrompt,
  userContent,
  maxResponseBytes = 64 * 1024,
  executable,
  model = process.env.LOGICPILOT_CODEX_MODEL,
  toolNames,
  timeoutMs = Number(process.env.LOGICPILOT_CODEX_TIMEOUT_MS ?? 120_000),
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 10 * 60_000) {
    throw new Error('LOGICPILOT_CODEX_TIMEOUT_MS must be between 5000 and 600000');
  }
  const directory = await mkdtemp(join(tmpdir(), 'logicpilot-codex-'));
  const schemaPath = join(directory, 'assistant-output.schema.json');
  const outputPath = join(directory, 'assistant-output.json');
  const prompt = [
    systemPrompt,
    '',
    'Backend constraints:',
    '- Return only the response object required by the output schema.',
    '- In toolCalls, encode each arguments object as a JSON string. The host decodes it.',
    '- Do not inspect files, run commands, or modify the environment.',
    '- The IDE executes LogicPilot toolCalls; you only propose them.',
    '',
    'Current request and conversation:',
    userContent,
  ].join('\n');
  try {
    await writeFile(
      schemaPath,
      JSON.stringify(createCodexAssistantOutputSchema(toolNames)),
      'utf8',
    );
    const args = buildCodexExecArgs({ directory, schemaPath, outputPath, model });
    const launch = executable ? await resolveCodexLaunch(executable) : await resolveCodexLaunch();
    const processResult = await runProcess({
      executable: launch.executable,
      args: [...launch.prefixArgs, ...args],
      input: prompt,
      timeoutMs,
    });
    if (processResult.code !== 0) {
      const detail = processResult.stderr.trim().split(/\r?\n/).slice(-3).join(' ');
      throw new Error(
        `Codex CLI provider failed (exit ${processResult.code})${detail ? `: ${detail}` : ''}`,
      );
    }
    const content = await readFile(outputPath, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > maxResponseBytes) {
      throw new Error('Codex CLI assistant response exceeded the size limit');
    }
    return normalizeCodexAssistantOutput(parseCodexAssistantOutput(content));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Run one response-only assistant step through an existing Codex login. */
export async function runCodexAssistant(options) {
  const timeoutMs = Number(options.timeoutMs ?? process.env.LOGICPILOT_CODEX_TIMEOUT_MS ?? 120_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 10 * 60_000) {
    throw new Error('LOGICPILOT_CODEX_TIMEOUT_MS must be between 5000 and 600000');
  }
  const transport = process.env.LOGICPILOT_CODEX_TRANSPORT ?? 'app-server';
  if (transport === 'exec') return runCodexAssistantExec({ ...options, timeoutMs });
  if (transport !== 'app-server') {
    throw new Error("LOGICPILOT_CODEX_TRANSPORT must be 'app-server' or 'exec'");
  }
  const prompt = [
    options.systemPrompt,
    '',
    'Backend constraints:',
    '- Return only the response object required by the output schema.',
    '- In toolCalls, encode each arguments object as a JSON string. The host decodes it.',
    '- Do not inspect files, run commands, or modify the environment.',
    '- The IDE executes LogicPilot toolCalls; you only propose them.',
    '',
    'Current request and conversation:',
    options.userContent,
  ].join('\n');
  const client = await getSharedAppServer(options.executable);
  const outputSchema = createCodexAssistantOutputSchema(options.toolNames);
  try {
    const content = await client.runTurn({
      prompt,
      model: options.model ?? process.env.LOGICPILOT_CODEX_MODEL,
      outputSchema,
      timeoutMs,
    });
    const maximum = options.maxResponseBytes ?? 64 * 1024;
    if (Buffer.byteLength(content, 'utf8') > maximum) {
      throw new Error('Codex CLI assistant response exceeded the size limit');
    }
    return normalizeCodexAssistantOutput(parseCodexAssistantOutput(content));
  } catch (error) {
    // A failed process/transport is never reused; the next request starts clean.
    closeSharedCodexAppServer();
    throw error;
  }
}
