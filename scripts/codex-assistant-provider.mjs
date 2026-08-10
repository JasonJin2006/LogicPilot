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
  'apply_model_patch',
  'compile_model',
  'run_simulation',
  'wait_for_run',
  'undo_last_ai_change',
];

export const CODEX_ASSISTANT_OUTPUT_SCHEMA = Object.freeze({
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
          name: { type: 'string', enum: TOOL_NAMES },
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
});

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

/** Run one response-only assistant step through an existing Codex login. */
export async function runCodexAssistant({
  systemPrompt,
  userContent,
  maxResponseBytes = 64 * 1024,
  executable,
  model = process.env.LOGICPILOT_CODEX_MODEL,
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
    await writeFile(schemaPath, JSON.stringify(CODEX_ASSISTANT_OUTPUT_SCHEMA), 'utf8');
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
