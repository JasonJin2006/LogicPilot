// AI assistant turn provider: one stateless reasoning step for the IDE's
// Assistant Runtime. The runtime owns the loop (plan -> tool calls -> tool
// results -> next step) and calls this endpoint once per step; this module
// only turns (messages + context + tool registry) into one structured
// response and validates it at runtime.
//
// Provider: OpenAI-compatible chat completions (same env contract as
// scripts/ai-provider.mjs: OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL).
// The API key never leaves the server. Without a key the endpoint reports a
// clear error - the assistant is deliberately NOT emulated with keyword
// replies.

import { runCodexAssistant } from './codex-assistant-provider.mjs';

// ---------------------------------------------------------------------------
// Tool registry contract (shared with the client by convention; the server
// re-validates every tool call the model proposes).
// ---------------------------------------------------------------------------

export const ASSISTANT_TOOLS = Object.freeze([
  {
    name: 'inspect_model',
    description:
      'Read a compact summary of the current model (blocks, kinds, ' +
      'parameters, connections, ids) so follow-up edits can reference ' +
      'exact ids/names.',
    parameters: {},
  },
  {
    name: 'inspect_selection',
    description:
      'Read the currently selected block on the canvas (id, kind, ' +
      'name, parameters). No arguments.',
    parameters: {},
  },
  {
    name: 'inspect_diagnostics',
    description:
      'Read the DES preflight and compiler diagnostics of the most recent ' +
      'compile attempt (empty when the last compile passed or nothing was ' +
      'compiled yet).',
    parameters: {},
  },
  {
    name: 'inspect_run_metrics',
    description:
      'Read the metrics of the most recent finished simulation run ' +
      '(throughput, Wq, W, Lq, utilization, per-block stats). Fails ' +
      'cleanly when no run has finished.',
    parameters: {},
  },
  {
    name: 'apply_model_patch',
    description:
      'Apply a structured model patch (add_block / update_block / ' +
      'remove_block / connect / disconnect / rename_model) as one atomic, ' +
      'undoable edit. After applying, DES preflight and compilation run ' +
      'automatically and diagnostics are returned so you can repair the ' +
      'model in a follow-up call. References may be node ids or unique ' +
      'block names. For a new flow, add all blocks and connections in one ' +
      'patch so preflight never sees a partial topology.',
    parameters: {
      patch: {
        type: 'object',
        required: true,
        description:
          '{version:1, operations:[ModelPatch operation...]}; exact ' +
          'operation fields are listed in the system instructions',
      },
      summary: {
        type: 'string',
        required: true,
        description:
          'One short line describing the change for the user (e.g. "added ' +
          'queue Q with capacity 20 before service S").',
      },
    },
  },
  {
    name: 'compile_model',
    description:
      'Run local DES preflight, then compile the current model DSL and ' +
      'return the phase and diagnostics. Use this after any change that ' +
      'did not go through apply_model_patch.',
    parameters: {},
  },
  {
    name: 'run_simulation',
    description:
      'Compile (if needed) and run a DES simulation of the current model ' +
      'with the configured experiment, then return the real metrics. Use ' +
      'this when the user asks to run / simulate / see results.',
    parameters: {},
  },
  {
    name: 'wait_for_run',
    description:
      'Return the status of the last requested run. The IDE runs are ' +
      'synchronous end-to-end, so this reports the finished result.',
    parameters: {},
  },
  {
    name: 'undo_last_ai_change',
    description:
      'Undo the most recent AI-applied model change (one atomic undo ' +
      'step). Returns the resulting model summary.',
    parameters: {},
  },
]);

// ---------------------------------------------------------------------------
// Response schema validation (runtime, never trust the model).
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateToolCall(call, index) {
  if (!isPlainObject(call)) {
    return `toolCalls[${index}] is not an object`;
  }
  if (typeof call.id !== 'string' || !call.id) {
    return `toolCalls[${index}].id must be a non-empty string`;
  }
  if (typeof call.name !== 'string') {
    return `toolCalls[${index}].name must be a string`;
  }
  const tool = ASSISTANT_TOOLS.find((entry) => entry.name === call.name);
  if (!tool) {
    return `toolCalls[${index}].name '${call.name}' is not a known tool`;
  }
  if (!isPlainObject(call.arguments)) {
    return `toolCalls[${index}].arguments must be an object`;
  }
  const allowed = new Set(Object.keys(tool.parameters ?? {}));
  for (const key of Object.keys(call.arguments)) {
    if (!allowed.has(key)) {
      return `toolCalls[${index}].arguments.${key} is not allowed for ${call.name}`;
    }
  }
  for (const [key, schema] of Object.entries(tool.parameters ?? {})) {
    const value = call.arguments[key];
    if (schema.required === true && value === undefined) {
      return `toolCalls[${index}].arguments.${key} is required for ${call.name}`;
    }
    if (value !== undefined && schema.type === 'string' && typeof value !== 'string') {
      return `toolCalls[${index}].arguments.${key} must be a string`;
    }
    if (value !== undefined && schema.type === 'object' && !isPlainObject(value)) {
      return `toolCalls[${index}].arguments.${key} must be an object`;
    }
  }
  if (call.name === 'apply_model_patch') {
    if (call.arguments.summary.trim() === '') {
      return `toolCalls[${index}].arguments.summary must not be empty`;
    }
    const patch = call.arguments.patch;
    if (patch.version !== 1 || !Array.isArray(patch.operations) || patch.operations.length === 0) {
      return `toolCalls[${index}].arguments.patch must contain version 1 operations`;
    }
  }
  return null;
}

/**
 * Validate one assistant response object. Returns the normalized response
 * or throws with a human-readable message (the UI must never crash on
 * malformed model output).
 */
export function validateAssistantResponse(value) {
  if (!isPlainObject(value)) {
    throw new Error('assistant response must be a JSON object');
  }
  if (typeof value.message !== 'string') {
    throw new Error('assistant response is missing a string "message"');
  }
  if (typeof value.done !== 'boolean') {
    throw new Error('assistant response is missing a boolean "done"');
  }
  const plan = [];
  if (value.plan !== undefined) {
    if (!Array.isArray(value.plan)) {
      throw new Error('assistant "plan" must be an array');
    }
    for (let index = 0; index < value.plan.length; ++index) {
      const step = value.plan[index];
      if (!isPlainObject(step) || typeof step.id !== 'string' || typeof step.label !== 'string') {
        throw new Error(`plan[${index}] must have string id and label`);
      }
      plan.push({ id: step.id, label: step.label });
    }
  }
  const toolCalls = [];
  const callIds = new Set();
  if (value.toolCalls !== undefined) {
    if (!Array.isArray(value.toolCalls)) {
      throw new Error('assistant "toolCalls" must be an array');
    }
    for (let index = 0; index < value.toolCalls.length; ++index) {
      const problem = validateToolCall(value.toolCalls[index], index);
      if (problem) {
        throw new Error(problem);
      }
      const call = value.toolCalls[index];
      if (callIds.has(call.id)) {
        throw new Error(`toolCalls[${index}].id '${call.id}' is duplicated`);
      }
      callIds.add(call.id);
      toolCalls.push({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
    }
  }
  if (value.done && toolCalls.length > 0) {
    throw new Error('assistant response marked done but still proposes tool calls');
  }
  return { message: value.message, plan, toolCalls, done: value.done };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function renderContext(context) {
  if (!context || typeof context !== 'object') {
    return '';
  }
  const sections = [];
  const push = (title, body) => {
    if (body !== undefined && body !== null && String(body).trim() !== '') {
      sections.push(`## ${title}\n${body}`);
    }
  };
  push('Project', context.project);
  push('Model summary', context.modelSummary);
  push('Current selection', context.selection);
  push('Model DSL', context.dsl);
  push('Compile diagnostics', context.diagnostics);
  push('Last run status', context.runStatus);
  push('Last run metrics', context.runMetrics);
  return sections.join('\n\n');
}

function renderToolCalls(toolCalls) {
  return toolCalls
    .map(
      (call) =>
        `tool_call_id: ${call.id}\nname: ${call.name}\narguments: ` +
        JSON.stringify(call.arguments),
    )
    .join('\n\n');
}

function renderToolResults(results) {
  return results
    .map(
      (result) =>
        `tool_call_id: ${result.toolCallId}\nok: ${result.ok}\nresult: ` +
        JSON.stringify(result.result),
    )
    .join('\n\n');
}

function renderMessages(messages) {
  // messages: [{ role: 'user' | 'assistant', content, toolCalls?, toolResults? }]
  const rendered = [];
  for (const message of messages ?? []) {
    if (
      message.role === 'assistant' &&
      Array.isArray(message.toolCalls) &&
      message.toolCalls.length > 0
    ) {
      rendered.push(
        `[assistant]\n${message.content}\n\nProposed tool calls:\n` +
          renderToolCalls(message.toolCalls),
      );
      if (Array.isArray(message.toolResults) && message.toolResults.length > 0) {
        rendered.push(`[tool results]\n${renderToolResults(message.toolResults)}`);
      }
    } else {
      rendered.push(`[${message.role}]\n${message.content ?? ''}`);
    }
  }
  return rendered.join('\n\n');
}

export function buildSystemPrompt() {
  const toolLines = ASSISTANT_TOOLS.map(
    (tool) =>
      `- ${tool.name}${Object.keys(tool.parameters ?? {}).length > 0 ? ` ${JSON.stringify(tool.parameters)}` : ''}: ${tool.description}`,
  ).join('\n');
  return [
    'You are the LogicPilot AI modeling assistant inside the IDE. You help the',
    'user build, edit, run and interpret DES models. You NEVER invent data:',
    'inspect_run_metrics returns real metrics or fails, and you must say when',
    'no run exists yet and suggest running one. You NEVER execute code - you',
    'only propose tool calls, and the IDE executes them and feeds the results',
    'back to you.',
    '',
    'Conversation rules:',
    '- Reference model objects by their exact id or unique name from the',
    '  model summary (e.g. "刚才那个队列" resolves to the queue named in the',
    '  summary). If a reference is ambiguous or missing, ask the user to',
    '  clarify instead of guessing.',
    '- For model edits use apply_model_patch with structured operations',
    '  (add_block, update_block, remove_block, connect, disconnect,',
    '  rename_model). Its result includes preflight/compiler diagnostics: if',
    '  validation failed, repair the reported problem and retry. Do not modify',
    '  DSL text directly and do not claim an edit succeeded before the tool',
    '  result confirms it.',
    '- When building a new DES flow, submit every required block and connection',
    '  in ONE atomic patch. A partial source-only or queue-only model is invalid',
    '  during preflight and wastes a reasoning step.',
    '- For runs use run_simulation. If the user asked for results or an',
    '  explanation, continue after a successful edit, run the model, inspect',
    '  run metrics when needed, and cite only the metric values returned by',
    '  those tools. Never turn example numbers below into claimed run results.',
    '- Respond in the same language as the user.',
    '',
    'ModelPatch version 1 (use only these exact fields):',
    '- add_block: {"op":"add_block","kind":string,"name":string,',
    '  "x"?:number,"y"?:number,"params"?:object}.',
    '- update_block: {"op":"update_block","target":id-or-name,',
    '  "name"?:string,"x"?:number,"y"?:number,"params"?:object,',
    '  "removeParams"?:string[]}.',
    '- remove_block: {"op":"remove_block","target":id-or-name}.',
    '- connect: {"op":"connect","from":id-or-name,"to":id-or-name,',
    '  "fromPort"?:string,"toPort"?:string}. Default ports are out -> in.',
    '- disconnect: {"op":"disconnect","edge"?:edge-id,"from"?:id-or-name,',
    '  "to"?:id-or-name,"fromPort"?:string,"toPort"?:string}.',
    '- rename_model: {"op":"rename_model","name":string}.',
    '- Core executable DES block kinds are resource, source, queue, service,',
    '  and sink. Parameter values must be strings, finite numbers or booleans.',
    '',
    'Canonical M/M/1 recipe (a modeling example, NOT run evidence):',
    '- resource Server params {"capacity":1}',
    '- source Arrivals params {"arrival":"rate(0.8)"}',
    '- queue WaitLine params {"capacity":1000000}',
    '- service Handle params',
    '  {"resource":"Server","time":"exponential(1.0)"}',
    '- sink Done params {}, connected Arrivals -> WaitLine -> Handle -> Done.',
    '- For stability require arrival rate lambda < service rate mu. In this',
    '  DSL exponential(mu) uses the rate mu, not the mean service time.',
    '',
    'Response format (strict JSON, no markdown fences):',
    '{',
    '  "message": "short natural-language reply for this step",',
    '  "plan": [{"id": "step-1", "label": "检查模型"}],',
    '  "toolCalls": [{"id": "call-1", "name": "inspect_model", "arguments": {}}],',
    '  "done": false',
    '}',
    '- "done" must be true only when the task is complete and no more tool',
    '  calls are needed.',
    '- Keep "message" concise; final answers may be a short summary.',
    '',
    `Available tools:\n${toolLines}`,
  ].join('\n');
}

export function resolveAssistantProvider(environment = process.env) {
  const requested = String(environment.LOGICPILOT_AI_PROVIDER ?? 'auto').toLowerCase();
  if (!['auto', 'api', 'codex'].includes(requested)) {
    throw new Error('LOGICPILOT_AI_PROVIDER must be auto, api, or codex');
  }
  if (requested === 'codex') return 'codex';
  if (requested === 'api' || environment.OPENAI_API_KEY) return 'api';
  return 'unconfigured';
}

/**
 * One reasoning step. Returns the validated response on success, or throws
 * an Error (caller maps it to a 4xx/5xx response).
 */
export async function runAssistant({ messages, context, maxResponseBytes = 64 * 1024 }) {
  const provider = resolveAssistantProvider();
  const apiKey = process.env.OPENAI_API_KEY;
  if (provider === 'unconfigured') {
    throw new Error(
      'assistant requires OPENAI_API_KEY or LOGICPILOT_AI_PROVIDER=codex with a logged-in Codex CLI',
    );
  }
  if (provider === 'api' && !apiKey) {
    throw new Error('LOGICPILOT_AI_PROVIDER=api requires OPENAI_API_KEY');
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 32) {
    throw new Error('assistant messages must contain 1..32 entries');
  }
  for (const [index, message] of messages.entries()) {
    if (
      !isPlainObject(message) ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      message.content.length > 64 * 1024
    ) {
      throw new Error(`assistant messages[${index}] has an invalid role or content`);
    }
  }
  const system = buildSystemPrompt();
  const contextText = renderContext(context);
  const userContent = [contextText, renderMessages(messages)].filter(Boolean).join('\n\n');
  if (provider === 'codex') {
    const parsed = await runCodexAssistant({
      systemPrompt: system,
      userContent,
      maxResponseBytes,
    });
    return validateAssistantResponse(parsed);
  }
  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const maxTokens = Number(process.env.OPENAI_MAX_TOKENS ?? 4096);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 512 || maxTokens > 128 * 1024) {
    throw new Error('OPENAI_MAX_TOKENS must be an integer between 512 and 131072');
  }
  const requestBody = {
    model,
    temperature: 0.2,
    max_tokens: maxTokens,
    // OpenAI and DeepSeek both implement JSON mode. The prompt already
    // contains an explicit JSON example, satisfying provider requirements.
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
  };
  // DeepSeek V4 defaults to thinking mode. This endpoint needs a short,
  // machine-readable routing decision rather than hidden chain-of-thought;
  // disabling thinking also prevents reasoning tokens from crowding out the
  // JSON payload. Other OpenAI-compatible providers never receive this field.
  if (/deepseek/i.test(model) || /api\.deepseek\.com/i.test(base)) {
    const thinking = process.env.DEEPSEEK_THINKING ?? 'disabled';
    if (!['enabled', 'disabled'].includes(thinking)) {
      throw new Error('DEEPSEEK_THINKING must be enabled or disabled');
    }
    requestBody.thinking = { type: thinking };
  }

  for (let attempt = 0; attempt < 2; ++attempt) {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed (${response.status}): ${body}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    if (content.length > maxResponseBytes) {
      throw new Error('assistant response exceeded the size limit');
    }
    try {
      // JSON mode should return a bare object; tolerate a fenced block for
      // less complete OpenAI-compatible gateways. DeepSeek documents rare
      // empty JSON-mode responses, so retry one malformed/empty response.
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const parsed = JSON.parse(match ? match[1] : content);
      return validateAssistantResponse(parsed);
    } catch (error) {
      if (attempt === 0 && (content.trim() === '' || error instanceof SyntaxError)) continue;
      if (error instanceof SyntaxError) {
        throw new Error('assistant returned malformed JSON (schema validation failed)');
      }
      throw error;
    }
  }
  throw new Error('assistant returned malformed JSON (schema validation failed)');
}
