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
import { requestProviderResponse, requestProviderStream } from './ai-provider-adapters.mjs';
import {
  resolveAssistantConfiguration,
  resolveAssistantConfigurationForInput,
} from './ai-provider-config.mjs';
import {
  hasAgentCapability,
  normalizeAgentCapabilities,
  resolveAgentCapabilities,
} from './agent-profiles.mjs';
import { loadAgentSkillInstructions, renderAgentSkillInstructions } from './agent-skills.mjs';
import { listMcpToolDefinitions } from './mcp-runtime.mjs';

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
      'Read preflight and compiler diagnostics of the most recent ' +
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
    name: 'run_parameter_study',
    description:
      'Run a bounded parameter variation experiment on the current model and return measured results.',
    parameters: {
      experimentName: { type: 'string' },
      arrivals: { type: 'number' },
      warmup: { type: 'number' },
      concurrency: { type: 'number' },
    },
  },
  {
    name: 'explain_results',
    description:
      'Explain the latest completed simulation using only grounded metrics; fails when no run exists.',
    parameters: { question: { type: 'string', required: true } },
  },
  {
    name: 'optimize_model',
    description:
      'Search the current model for a better parameter configuration and return measured candidates.',
    parameters: { prompt: { type: 'string', required: true } },
  },
  {
    name: 'compare_runs',
    description:
      'Compare the two most recent completed runs using paired metrics and confidence intervals.',
    parameters: { confidence: { type: 'number' } },
  },
  {
    name: 'apply_model_patch',
    description:
      'Apply a structured model patch (add_block / update_block / ' +
      'remove_block / connect / disconnect / rename_model) as one atomic, ' +
      'undoable edit. After applying, preflight and compilation run ' +
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
      'Run local preflight, then compile the current model DSL and ' +
      'return the phase and diagnostics. Use this after any change that ' +
      'did not go through apply_model_patch.',
    parameters: {},
  },
  {
    name: 'run_simulation',
    description:
      'Compile (if needed) and run the current supported simulation model ' +
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
  {
    name: 'read_workspace_file',
    description:
      'Read a bounded source file inside the active LogicPilot workspace. Only model, presentation and experiment source paths are allowed.',
    parameters: { path: { type: 'string', required: true } },
  },
  {
    name: 'apply_source_patch',
    description:
      'Apply an exact oldText -> newText patch to a bounded workspace source file after checksum validation. Requires explicit source-editing permission.',
    parameters: {
      path: { type: 'string', required: true },
      expectedChecksum: { type: 'string', required: true },
      oldText: { type: 'string', required: true },
      newText: { type: 'string', required: true },
      summary: { type: 'string', required: true },
    },
  },
  {
    name: 'inspect_sysml_projection',
    description:
      'Inspect the active SysML projection, relations, diagnostics and stable element ids.',
    parameters: {},
  },
  {
    name: 'auto_layout_sysml_projection',
    description:
      'Automatically arrange the active SysML projection without changing semantic source.',
    parameters: {},
  },
  {
    name: 'set_sysml_projection_view',
    description: 'Focus the SysML projection on one semantic view.',
    parameters: { mode: { type: 'string', required: true } },
  },
  {
    name: 'focus_sysml_element',
    description: 'Select and reveal a SysML element by stable id, name or qualified name.',
    parameters: { query: { type: 'string', required: true } },
  },
  {
    name: 'move_sysml_element',
    description: 'Move one SysML visual element without changing semantic source.',
    parameters: {
      elementId: { type: 'string', required: true },
      x: { type: 'number', required: true },
      y: { type: 'number', required: true },
    },
  },
  {
    name: 'add_sysml_element',
    description: 'Insert one typed SysML declaration, optionally nested under an existing parent.',
    parameters: {
      kind: { type: 'string', required: true },
      name: { type: 'string', required: true },
      declaration: { type: 'string' },
      parent: { type: 'string' },
    },
  },
  {
    name: 'rename_sysml_element',
    description: 'Rename one SysML element through a verified source-text transaction.',
    parameters: {
      query: { type: 'string', required: true },
      newName: { type: 'string', required: true },
    },
  },
  {
    name: 'connect_sysml_elements',
    description: 'Create a typed SysML relation between two existing elements.',
    parameters: {
      verb: { type: 'string', required: true },
      from: { type: 'string', required: true },
      to: { type: 'string', required: true },
    },
  },
  {
    name: 'find_sysml_definition',
    description: 'Resolve a SysML name or source line to its definition, including linked files.',
    parameters: { query: { type: 'string' }, line: { type: 'number' } },
  },
  {
    name: 'find_sysml_references',
    description: 'List extracted relations touching one SysML element.',
    parameters: { query: { type: 'string', required: true } },
  },
  {
    name: 'query_sysml_evidence',
    description: 'Query revision-bound execution evidence for the active SysML document.',
    parameters: {
      target: { type: 'string' },
      outcome: { type: 'string' },
      limit: { type: 'number' },
    },
  },
  {
    name: 'explain_sysml_run',
    description: 'Read the full execution trace of one SysML evidence record.',
    parameters: { evidenceId: { type: 'string', required: true } },
  },
  {
    name: 'lower_sysml_state_machine',
    description:
      'Lower a supported SysML state definition to executable LogicPilot statechart DSL.',
    parameters: { query: { type: 'string', required: true } },
  },
  {
    name: 'list_plugin_drafts',
    description: 'List persisted structured plugin drafts and static validation reports.',
    parameters: {},
  },
  {
    name: 'create_plugin_draft',
    description:
      'Create a permission-gated structured plugin draft for review; never install or overwrite a trusted plugin.',
    parameters: {
      draft: { type: 'object', required: true },
      summary: { type: 'string', required: true },
    },
  },
  {
    name: 'validate_plugin_draft',
    description: 'Run schema, permission, trust and diagnostic-reference checks on a plugin draft.',
    parameters: { id: { type: 'string', required: true } },
  },
  {
    name: 'plan_view',
    description: 'Suggest installed canvas views for a structured modeling intent.',
    parameters: {
      purpose: { type: 'string', required: true },
      artifactKinds: { type: 'array' },
      preferredCanvas: { type: 'string' },
      selectedViewId: { type: 'string' },
    },
  },
]);

function normalizeToolDescriptors(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const tools = [];
  for (const candidate of value) {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof candidate.name !== 'string' ||
      candidate.name.trim() === '' ||
      typeof candidate.parameters !== 'object' ||
      candidate.parameters === null ||
      Array.isArray(candidate.parameters) ||
      seen.has(candidate.name)
    )
      continue;
    seen.add(candidate.name);
    tools.push({
      name: candidate.name,
      description:
        typeof candidate.description === 'string' ? candidate.description : candidate.name,
      parameters: candidate.parameters,
    });
  }
  return tools;
}

function nativeToolDefinitions(tools) {
  return tools.map((tool) => {
    const properties = {};
    const required = [];
    for (const [name, schema] of Object.entries(tool.parameters ?? {})) {
      properties[name] = {
        type: schema.type ?? 'object',
        ...(schema.description ? { description: schema.description } : {}),
      };
      if (schema.required === true) required.push(name);
    }
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Response schema validation (runtime, never trust the model).
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the model-visible session projection before it reaches a provider.
 * Tool calls/results are kept as structured blocks so a malformed or
 * duplicated pair cannot poison later reasoning steps.
 * @param {unknown} messages - projected assistant history.
 * @returns {string|null} a rejection reason, or null for valid history.
 */
export function validateAssistantMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 32) {
    return 'assistant messages must contain 1..32 entries';
  }
  for (const [index, message] of messages.entries()) {
    if (!isPlainObject(message) || !['user', 'assistant'].includes(message.role)) {
      return `assistant messages[${index}] has an invalid role`;
    }
    if (typeof message.content !== 'string' || message.content.length > 64 * 1024) {
      return `assistant messages[${index}] has invalid content`;
    }
    if (
      message.role === 'user' &&
      (message.toolCalls !== undefined || message.toolResults !== undefined)
    ) {
      return `assistant messages[${index}] user messages cannot contain tool blocks`;
    }
    if (message.toolCalls !== undefined) {
      if (
        message.role !== 'assistant' ||
        !Array.isArray(message.toolCalls) ||
        message.toolCalls.length > 16
      ) {
        return `assistant messages[${index}].toolCalls is invalid`;
      }
      const ids = new Set();
      for (const [callIndex, call] of message.toolCalls.entries()) {
        if (
          !isPlainObject(call) ||
          typeof call.id !== 'string' ||
          call.id.length === 0 ||
          typeof call.name !== 'string' ||
          call.name.length === 0 ||
          !isPlainObject(call.arguments)
        ) {
          return `assistant messages[${index}].toolCalls[${callIndex}] is invalid`;
        }
        if (ids.has(call.id))
          return `assistant messages[${index}] duplicates tool call '${call.id}'`;
        ids.add(call.id);
      }
    }
    if (message.toolResults !== undefined) {
      if (
        message.role !== 'assistant' ||
        !Array.isArray(message.toolResults) ||
        message.toolResults.length > 16 ||
        !Array.isArray(message.toolCalls)
      ) {
        return `assistant messages[${index}].toolResults is invalid`;
      }
      const calls = new Set(message.toolCalls.map((call) => call.id));
      const results = new Set();
      for (const [resultIndex, result] of message.toolResults.entries()) {
        if (
          !isPlainObject(result) ||
          typeof result.toolCallId !== 'string' ||
          result.toolCallId.length === 0 ||
          typeof result.ok !== 'boolean' ||
          !isPlainObject(result.result) ||
          (result.error !== undefined && typeof result.error !== 'string')
        ) {
          return `assistant messages[${index}].toolResults[${resultIndex}] is invalid`;
        }
        if (!calls.has(result.toolCallId))
          return `assistant messages[${index}] has an unmatched tool result '${result.toolCallId}'`;
        if (results.has(result.toolCallId))
          return `assistant messages[${index}] duplicates tool result '${result.toolCallId}'`;
        results.add(result.toolCallId);
      }
    }
  }
  return null;
}

function validateToolCall(call, index, allowedToolNames = null, toolCatalog = ASSISTANT_TOOLS) {
  if (!isPlainObject(call)) {
    return `toolCalls[${index}] is not an object`;
  }
  if (typeof call.id !== 'string' || !call.id) {
    return `toolCalls[${index}].id must be a non-empty string`;
  }
  if (typeof call.name !== 'string') {
    return `toolCalls[${index}].name must be a string`;
  }
  const tool = toolCatalog.find((entry) => entry.name === call.name);
  if (!tool) {
    return `toolCalls[${index}].name '${call.name}' is not a known tool`;
  }
  if (allowedToolNames !== null && !allowedToolNames.has(call.name)) {
    return `toolCalls[${index}].name '${call.name}' is not available in the active agent capabilities`;
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
    if (
      value !== undefined &&
      schema.type === 'number' &&
      (typeof value !== 'number' || !Number.isFinite(value))
    ) {
      return `toolCalls[${index}].arguments.${key} must be a finite number`;
    }
    if (value !== undefined && schema.type === 'boolean' && typeof value !== 'boolean') {
      return `toolCalls[${index}].arguments.${key} must be a boolean`;
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
 * Repair the one provider quirk that is safe to repair at the protocol
 * boundary: some models return an empty/whitespace tool-call id. The id is
 * transport metadata, not model intent, so assign a deterministic fallback
 * before strict validation. Non-empty duplicate ids are intentionally left
 * untouched so they still fail validation instead of being silently merged.
 */
function normalizeAssistantResponseToolCallIds(value) {
  if (!isPlainObject(value) || !Array.isArray(value.toolCalls)) return value;
  return {
    ...value,
    toolCalls: value.toolCalls.map((call, index) => {
      if (!isPlainObject(call)) return call;
      const id = typeof call.id === 'string' ? call.id.trim() : '';
      if (id !== '') return id === call.id ? call : { ...call, id };
      const name = typeof call.name === 'string' && call.name.trim() ? call.name.trim() : 'tool';
      return { ...call, id: `${name}-model-${index + 1}` };
    }),
  };
}

/** Repair ids in persisted assistant history before strict wire validation. */
export function normalizeAssistantMessageToolCallIds(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((message, messageIndex) => {
    if (!isPlainObject(message) || !Array.isArray(message.toolCalls)) return message;
    const replacements = new Map();
    const toolCalls = message.toolCalls.map((call, callIndex) => {
      if (!isPlainObject(call)) return call;
      const originalId = typeof call.id === 'string' ? call.id : '';
      const id = originalId.trim();
      if (id !== '') {
        if (id !== originalId) replacements.set(originalId, id);
        return id === originalId ? call : { ...call, id };
      }
      const name = typeof call.name === 'string' && call.name.trim() ? call.name.trim() : 'tool';
      const fallback = `${name}-history-${messageIndex + 1}-${callIndex + 1}`;
      replacements.set(originalId, fallback);
      return { ...call, id: fallback };
    });
    const toolResults = Array.isArray(message.toolResults)
      ? message.toolResults.map((result) => {
          if (!isPlainObject(result) || typeof result.toolCallId !== 'string') return result;
          const toolCallId = replacements.get(result.toolCallId) ?? result.toolCallId.trim();
          return toolCallId === result.toolCallId ? result : { ...result, toolCallId };
        })
      : message.toolResults;
    return { ...message, toolCalls, ...(toolResults === undefined ? {} : { toolResults }) };
  });
}

/**
 * Validate one assistant response object. Returns the normalized response
 * or throws with a human-readable message (the UI must never crash on
 * malformed model output).
 */
export function validateAssistantResponse(value, allowedToolNames = null, toolCatalog = []) {
  if (!isPlainObject(value)) {
    throw new Error('assistant response must be a JSON object');
  }
  if (typeof value.message !== 'string') {
    throw new Error('assistant response is missing a string "message"');
  }
  // A few gateways/models put the complete assistant protocol back inside
  // `message`. That is transport noise, not user-facing prose.
  const message = visibleAssistantMessage(value.message);
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
      const problem = validateToolCall(
        value.toolCalls[index],
        index,
        allowedToolNames,
        toolCatalog,
      );
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
  if (
    value.reasoning !== undefined &&
    (typeof value.reasoning !== 'string' || value.reasoning.length > 64 * 1024)
  ) {
    throw new Error('assistant response "reasoning" must be a string under 64 KiB');
  }
  let usage;
  if (value.usage !== undefined) {
    if (!isPlainObject(value.usage))
      throw new Error('assistant response "usage" must be an object');
    usage = {};
    for (const key of ['inputTokens', 'outputTokens', 'reasoningTokens', 'totalTokens']) {
      if (value.usage[key] !== undefined) {
        if (!Number.isSafeInteger(value.usage[key]) || value.usage[key] < 0) {
          throw new Error(`assistant response usage.${key} must be a non-negative integer`);
        }
        usage[key] = value.usage[key];
      }
    }
  }
  const providerItems =
    value.providerItems === undefined
      ? undefined
      : Array.isArray(value.providerItems) && value.providerItems.length <= 16
        ? value.providerItems.filter((item) => isPlainObject(item))
        : (() => {
            throw new Error('assistant response providerItems is invalid');
          })();
  return {
    message,
    plan,
    toolCalls,
    done: value.done,
    ...(value.reasoning === undefined ? {} : { reasoning: value.reasoning }),
    ...(usage === undefined ? {} : { usage }),
    ...(providerItems === undefined ? {} : { providerItems }),
  };
}

/** Return only the human-facing part of a provider response message. */
export function visibleAssistantMessage(input) {
  let text = String(input ?? '').trim();
  for (let depth = 0; depth < 2; ++depth) {
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    const candidate = fenced ? fenced[1].trim() : text;
    try {
      const parsed = JSON.parse(candidate);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.message === 'string' &&
        (Array.isArray(parsed.toolCalls) || typeof parsed.done === 'boolean')
      ) {
        text = parsed.message.trim();
        continue;
      }
    } catch {
      // Fall through to transcript/fenced-text cleanup.
    }
    const marker = text.search(
      /\n\s*(?:```(?:json)?\s*)?\{\s*["'](?:message|plan|toolCalls|done)["']/i,
    );
    if (marker > 0) text = text.slice(0, marker).trim();
    break;
  }
  return text;
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
  push('Workspace root', context.workspaceRoot);
  push('Model summary', context.modelSummary);
  push('Current selection', context.selection);
  push('Model DSL', context.dsl);
  push('Compile diagnostics', context.diagnostics);
  push('Structured knowledge blocks', context.knowledge);
  push('Structured skills', context.skills);
  push('Structured instructions', context.instructions);
  push('Diagnostic definitions and fixes', context.diagnosticDefinitions);
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
        JSON.stringify(result.result) +
        (result.error ? `\nerror: ${result.error}` : ''),
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

export function buildSystemPrompt({
  capabilities = ['logicpilot-modeling'],
  skills = [],
  skillInstructions,
  extraTools = [],
  toolNames,
  toolCatalog,
} = {}) {
  const capabilityIds = normalizeAgentCapabilities(capabilities);
  const requestedToolNames = Array.isArray(toolNames) ? new Set(toolNames) : null;
  const resolvedSkillInstructions = skillInstructions ?? renderAgentSkillInstructions(skills);
  const extraToolLines = extraTools
    .filter((tool) => requestedToolNames === null || requestedToolNames.has(tool.name))
    .map(
      (tool) =>
        `- ${tool.name}${Object.keys(tool.parameters ?? {}).length > 0 ? ` ${JSON.stringify(tool.parameters)}` : ''}: ${tool.description}`,
    );
  const modelingMounted =
    hasAgentCapability(capabilityIds, 'logicpilot-modeling') ||
    hasAgentCapability(capabilityIds, 'logicpilot-modeling-readonly');
  const modelingReadOnly =
    hasAgentCapability(capabilityIds, 'logicpilot-modeling-readonly') &&
    !hasAgentCapability(capabilityIds, 'logicpilot-modeling');
  const capabilityToolNames = new Set(
    resolveAgentCapabilities(capabilityIds).flatMap((capability) => capability.toolNames ?? []),
  );
  const toolMounted = (name) =>
    capabilityToolNames.has(name) && (requestedToolNames === null || requestedToolNames.has(name));
  const sourceEditingMounted =
    hasAgentCapability(capabilityIds, 'logicpilot-source-editing') &&
    toolMounted('read_workspace_file') &&
    toolMounted('apply_source_patch');
  const pluginAuthoringMounted = hasAgentCapability(capabilityIds, 'logicpilot-plugin-authoring');
  const modelPatchMounted = toolMounted('apply_model_patch');
  const sysmlMounted = toolMounted('inspect_sysml_projection');
  const promptTools = toolCatalog ?? [];
  if (!modelingMounted && pluginAuthoringMounted) {
    const authoringToolLines = promptTools
      .filter((tool) => capabilityToolNames.has(tool.name) && toolMounted(tool.name))
      .map(
        (tool) =>
          `- ${tool.name}${Object.keys(tool.parameters ?? {}).length > 0 ? ` ${JSON.stringify(tool.parameters)}` : ''}: ${tool.description}`,
      );
    return [
      'You are the LogicPilot plugin-authoring assistant.',
      'Create only structured PluginDraft data. Never claim a draft is installed,',
      'and never bypass validation, user approval, trust or permission checks.',
      '',
      `Mounted tools:\n${authoringToolLines.join('\n')}`,
      '',
      'Response format (strict JSON, no markdown fences):',
      '{"message":"short reply","plan":[],"toolCalls":[],"done":true}',
      ...(resolvedSkillInstructions ? ['', resolvedSkillInstructions] : []),
    ].join('\n');
  }
  if (!modelingMounted) {
    return [
      'You are a general-purpose AI agent embedded in an application.',
      'Answer the user directly and concisely in the user language.',
      'Tools are optional capabilities mounted by the host; none are mounted',
      'for this turn. Do not invent actions, files, measurements or tool results.',
      'For a greeting or a conversational question, answer normally and finish.',
      '',
      'Response format (strict JSON, no markdown fences):',
      ...(extraToolLines.length > 0 ? ['', `Mounted tools:\n${extraToolLines.join('\n')}`] : []),
      '{"message":"short reply","plan":[],"toolCalls":[],"done":true}',
      ...(resolvedSkillInstructions ? ['', resolvedSkillInstructions] : []),
    ].join('\n');
  }
  const toolLines = promptTools
    .filter(
      (tool) =>
        capabilityToolNames.has(tool.name) &&
        (requestedToolNames === null || requestedToolNames.has(tool.name)),
    )
    .map(
      (tool) =>
        `- ${tool.name}${Object.keys(tool.parameters ?? {}).length > 0 ? ` ${JSON.stringify(tool.parameters)}` : ''}: ${tool.description}`,
    )
    .join('\n');
  const promptText = [
    'You are the LogicPilot AI modeling assistant inside the IDE. LogicPilot',
    'is a multi-paradigm simulation platform. Help the user build, edit, run',
    'and interpret supported models (DES, agent, statechart, continuous and',
    'future libraries). DES is the current fully exercised runtime example,',
    'not the product boundary. You NEVER invent data:',
    ...(modelingReadOnly
      ? [
          'This turn is read-only (Read only permission). You may inspect and explain',
          'the model, diagnostics and measured results, but you must not propose mutation, compile,',
          'run, or undo tool calls.',
        ]
      : []),
    'Tools are optional capabilities, not a ritual. For greetings and simple',
    'conversation, answer directly without inspecting the model. Never repeat',
    'an identical tool call when its result is already present and the model',
    'state has not changed.',
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
    ...(modelPatchMounted
      ? [
          '- For canvas-graph edits representable as blocks/ports use apply_model_patch with structured operations',
          '  (add_block, update_block, remove_block, connect, disconnect,',
          '  rename_model). Its result includes preflight/compiler diagnostics: if',
          '  validation failed, repair the reported problem and retry. Do not claim',
          '  an edit succeeded before the tool result confirms it.',
        ]
      : []),
    ...(sysmlMounted
      ? [
          '- The active document is SysML text with a visual projection. Inspect the projection before',
          '  editing, reference stable element ids or qualified names, and use only mounted SysML tools.',
          '- SysML semantic edits are verified source transactions. Report parser/lowering diagnostics',
          '  honestly; never claim unsupported SysML constructs were executed.',
        ]
      : []),
    ...(sourceEditingMounted
      ? [
          '- Agent behaviors, Statechart transitions, continuous equations and DEVS atomic',
          '  transitions are not fully representable by ModelPatch. For those semantics, call',
          '  read_workspace_file first, then apply_source_patch with the exact returned path,',
          '  checksum and oldText. Never invent a checksum or overwrite text you did not read.',
          '- After a source patch, call compile_model and repair real compiler diagnostics before',
          '  running. Preserve unrelated source and use only documented LogicPilot syntax.',
        ]
      : [
          '- Source editing is not mounted for this turn. If a requested behavior/equation/transition',
          '  cannot be represented by ModelPatch, explain the limitation instead of fabricating it.',
        ]),
    ...(modelPatchMounted
      ? [
          '- If apply_model_patch returns declined=true, the user chose to keep the',
          '  current model. Do not retry, diagnose, or propose the same change again',
          '  in that turn; acknowledge the decision and finish without mutation.',
          '- When building a new DES flow, submit every required block and connection',
          '  in ONE atomic patch. A partial source-only or queue-only model is invalid',
          '  during preflight and wastes a reasoning step.',
        ]
      : []),
    '- For runs use run_simulation. If the user asked for results or an',
    '  explanation, continue after a successful edit, run the model, inspect',
    '  run metrics when needed, and cite only the metric values returned by',
    '  those tools. Never turn example numbers below into claimed run results.',
    '- For parameter studies use run_parameter_study only after the current',
    '  model is valid; cite measured points returned by the tool.',
    '- For result questions use explain_results. It is grounded in the most',
    '  recent completed run and must fail clearly when no metrics exist.',
    '- For optimization requests use optimize_model with the current model',
    '  context; report candidates and scores before suggesting a change.',
    '- Use compare_runs only after two completed runs; cite paired deltas and',
    '  confidence conclusions returned by the tool.',
    '- Respond in the same language as the user.',
    '',
    ...(modelPatchMounted
      ? [
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
          '- Use exact block kinds, libraries, ports and parameters from the current',
          '  model summary. Parameter values must be strings, finite numbers or',
          '  booleans. Do not force an agent/statechart/continuous model into a DES',
          '  source-queue-service-sink topology.',
          '',
          'Canonical DES M/M/1 recipe (an example, NOT a product boundary or run evidence):',
          '- resource Server params {"capacity":1}',
          '- source Arrivals params {"arrival":"rate(0.8)"}',
          '- queue WaitLine params {"capacity":1000000}',
          '- service Handle params',
          '  {"resource":"Server","time":"exponential(1.0)"}',
          '- sink Done params {}, connected Arrivals -> WaitLine -> Handle -> Done.',
          '- For stability require arrival rate lambda < service rate mu. In this',
          '  DSL exponential(mu) uses the rate mu, not the mean service time.',
        ]
      : []),
    ...(sourceEditingMounted
      ? [
          '',
          'Source-editing recipes (minimal executable forms; adapt names and values):',
          '- Agent: model M { agent A { count = 100 state active = true on_tick { flip active; bounce } } }',
          '- Statechart: model M { statechart C { initial = Idle state Idle { } state Done { }',
          '  transition go { from = Idle; to = Done; triggeredBy = timeout; timeout = 1.0 } } }',
          '- Continuous: model M { continuous D { state y = 1.0 param k = 0.5 d y/dt = -k*y } }',
          '- DEVS: model M { atomic A { time_advance = constant(1.0) on_timeout { emit pulse } }',
          '  atomic B { state seen = false time_advance = infinite on_input pulse { seen = true } }',
          '  couple A.pulse -> B.pulse }',
        ]
      : []),
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
    ...(resolvedSkillInstructions ? ['', resolvedSkillInstructions] : []),
    '',
    `Available tools:\n${[toolLines, ...extraToolLines].filter(Boolean).join('\n')}`,
  ].join('\n');
  if (!modelingReadOnly) return promptText;
  return promptText
    .split('\n')
    .filter(
      (line) =>
        !/apply_model_patch|ModelPatch|add_block|update_block|remove_block|rename_model|source-queue-service-sink|Canonical DES|resource Server|source Arrivals|queue WaitLine|service Handle|sink Done/.test(
          line,
        ),
    )
    .join('\n');
}

/** Extract one balanced JSON object from a textual provider response. */
function extractJsonObject(text, start) {
  const first = text.indexOf('{', start);
  if (first < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = first; index < text.length; ++index) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(first, index + 1);
    }
  }
  return null;
}

/**
 * Parse the lightweight transcript format emitted by some local models when
 * native tool calling is advertised but not actually implemented. Example:
 *
 *   Proposed tool calls:
 *   tool_call_id: call-2
 *   name: apply_model_patch
 *   arguments: {"patch": ...}
 */
function parseTranscriptToolCalls(content) {
  const calls = [];
  const marker =
    /(?:^|\n)\s*tool_call_id:\s*([^\r\n]+)\s*\n\s*name:\s*([^\r\n]+)\s*\n\s*arguments:\s*/gi;
  let match;
  while ((match = marker.exec(content)) !== null) {
    const jsonStart = content.indexOf('{', marker.lastIndex);
    const json = extractJsonObject(content, marker.lastIndex);
    if (json === null) continue;
    try {
      const argumentsValue = JSON.parse(json);
      if (argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)) {
        calls.push({
          id: match[1].trim(),
          name: match[2].trim(),
          arguments: argumentsValue,
        });
      }
    } catch {
      // Leave malformed transcript text to the final response fallback below.
    }
    marker.lastIndex = jsonStart + json.length;
  }
  if (calls.length === 0) return null;
  const message =
    content.split(/\n\s*(?:proposed tool calls:|\[tool results\])/i)[0]?.trim() ||
    'I will continue with the requested model change.';
  return { message, plan: [], toolCalls: calls, done: false };
}

/**
 * Accept strict JSON first, then the transcript format used by weaker local
 * gateways. A final plain-text response is safe to expose as a completed
 * assistant message, while any parsed tool call still goes through the normal
 * schema and tool registry validation.
 */
export function parseAssistantResponseContent(content) {
  const text = String(content ?? '').trim();
  if (text === '') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const transcript = parseTranscriptToolCalls(text);
    if (transcript !== null) return transcript;
    return { message: text, plan: [], toolCalls: [], done: true };
  }
}

export function resolveAssistantProvider(environment = process.env) {
  const requested = String(environment.LOGICPILOT_AI_PROVIDER ?? 'auto').toLowerCase();
  if (!['auto', 'api', 'codex'].includes(requested)) {
    throw new Error(
      'LOGICPILOT_AI_PROVIDER must be auto, api, or codex when using the legacy environment contract',
    );
  }
  if (requested === 'codex') return 'codex';
  if (requested === 'api' || environment.OPENAI_API_KEY) return 'api';
  return 'unconfigured';
}

/**
 * Make a minimal provider request for Settings -> Test connection. This path
 * intentionally sends no assistant tools and accepts the current draft
 * provider, so a provider cannot fail the connectivity check merely because
 * it emitted malformed tool metadata.
 */
export async function testAssistantConnection({ provider } = {}) {
  const config =
    provider === undefined
      ? resolveAssistantConfiguration()
      : resolveAssistantConfigurationForInput(provider);
  if (config.source === 'unconfigured') {
    throw new Error(
      'assistant is not configured; choose an AI provider in Settings, set an API key, or use Codex login',
    );
  }
  const maxResponseBytes = 8 * 1024;
  if (config.protocol === 'codex-app-server') {
    const parsed = await runCodexAssistant({
      systemPrompt: 'You are a connectivity probe. Do not call tools.',
      userContent: 'Reply with exactly: connection ready',
      maxResponseBytes,
      model: config.model || undefined,
    });
    if (!parsed || typeof parsed.message !== 'string')
      throw new Error('Codex connection returned an invalid response');
  } else {
    const response = await requestProviderResponse(config, {
      system: 'You are a connectivity probe. Reply with exactly: connection ready.',
      userContent: 'connection test',
      maxTokens: 512,
      maxResponseBytes,
      jsonOutput: false,
      tools: [],
    });
    if (!response || typeof response.text !== 'string')
      throw new Error('AI provider returned an invalid response');
  }
  return { providerId: config.providerId, protocol: config.protocol };
}

/**
 * One reasoning step. Returns the validated response on success, or throws
 * an Error (caller maps it to a 4xx/5xx response).
 */
export async function runAssistant({
  messages,
  context,
  capabilities,
  skills,
  toolNames,
  toolDescriptors,
  maxResponseBytes = 64 * 1024,
  onChunk,
  signal,
}) {
  const config = resolveAssistantConfiguration();
  if (config.source === 'unconfigured') {
    throw new Error(
      'assistant is not configured; choose an AI provider in Settings, set an API key, or use Codex login',
    );
  }
  const normalizedMessages = normalizeAssistantMessageToolCallIds(messages);
  const messageProblem = validateAssistantMessages(normalizedMessages);
  if (messageProblem) throw new Error(messageProblem);
  const capabilityIds = normalizeAgentCapabilities(capabilities);
  const mcpTools = hasAgentCapability(capabilityIds, 'mcp')
    ? await listMcpToolDefinitions({ signal })
    : [];
  const providedTools = normalizeToolDescriptors(toolDescriptors);
  if (providedTools === null) {
    throw new Error('runtime tool descriptors are required for assistant steps');
  }
  const toolCatalog = [...providedTools, ...mcpTools];
  const skillInstructions = await loadAgentSkillInstructions(skills, {
    workspaceRoot: typeof context?.workspaceRoot === 'string' ? context.workspaceRoot : undefined,
  });
  const capabilityDefinitions = resolveAgentCapabilities(capabilityIds);
  const allowedToolNames = new Set(
    capabilityDefinitions.flatMap((capability) => capability.toolNames ?? []),
  );
  if (hasAgentCapability(capabilityIds, 'mcp')) {
    for (const tool of mcpTools) allowedToolNames.add(tool.name);
  }
  if (Array.isArray(toolNames)) {
    const requestedToolNames = new Set(toolNames.filter((name) => typeof name === 'string'));
    for (const name of allowedToolNames) {
      if (!requestedToolNames.has(name)) allowedToolNames.delete(name);
    }
  }
  const system = buildSystemPrompt({
    capabilities: capabilityIds,
    skills,
    skillInstructions,
    extraTools: mcpTools,
    toolNames: [...allowedToolNames],
    toolCatalog,
  });
  const exposedTools = toolCatalog.filter((tool) => allowedToolNames.has(tool.name));
  const nativeTools =
    config.nativeTools === true && exposedTools.length > 0
      ? nativeToolDefinitions(exposedTools)
      : [];
  const requestSystem =
    nativeTools.length > 0
      ? `${system}\n\nNative tool calling is enabled for this provider. Use the native tools directly; do not serialize a tool call into the JSON response.`
      : system;
  const contextText = renderContext(context);
  const userContent = [contextText, renderMessages(normalizedMessages)]
    .filter(Boolean)
    .join('\n\n');
  if (config.protocol === 'codex-app-server') {
    const parsed = await runCodexAssistant({
      systemPrompt: system,
      userContent,
      maxResponseBytes,
      model: config.model || undefined,
      toolNames: [...allowedToolNames],
    });
    return validateAssistantResponse(
      normalizeAssistantResponseToolCallIds(parsed),
      allowedToolNames,
      toolCatalog,
    );
  }
  const maxTokens = Number(process.env.OPENAI_MAX_TOKENS ?? 4096);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 512 || maxTokens > 128 * 1024) {
    throw new Error('OPENAI_MAX_TOKENS must be an integer between 512 and 131072');
  }
  if (
    config.providerId === 'deepseek' ||
    /deepseek/i.test(config.model) ||
    /api\.deepseek\.com/i.test(config.baseUrl)
  ) {
    const thinking = process.env.DEEPSEEK_THINKING ?? 'disabled';
    if (!['enabled', 'disabled'].includes(thinking)) {
      throw new Error('DEEPSEEK_THINKING must be enabled or disabled');
    }
    config.thinking = thinking;
  }

  for (let attempt = 0; attempt < 2; ++attempt) {
    let providerResponse;
    if (onChunk && config.protocol === 'openai-chat') {
      try {
        providerResponse = await requestProviderStream(config, {
          system: requestSystem,
          userContent,
          conversationMessages: normalizedMessages,
          maxTokens,
          maxResponseBytes,
          tools: nativeTools,
          onChunk,
          signal,
        });
      } catch (error) {
        if (
          error?.message !== 'STREAM_UNSUPPORTED' &&
          ![400, 404, 405, 422].includes(error?.status)
        )
          throw error;
        providerResponse = await requestProviderResponse(config, {
          system: requestSystem,
          userContent,
          conversationMessages: normalizedMessages,
          maxTokens,
          maxResponseBytes,
          tools: nativeTools,
          signal,
        });
      }
    } else {
      providerResponse = await requestProviderResponse(config, {
        system: requestSystem,
        userContent,
        conversationMessages: normalizedMessages,
        maxTokens,
        maxResponseBytes,
        tools: nativeTools,
        signal,
      });
    }
    if (providerResponse.nativeToolCalls?.length > 0) {
      return validateAssistantResponse(
        normalizeAssistantResponseToolCallIds({
          message: providerResponse.text || 'I will use the requested tools.',
          plan: [],
          toolCalls: providerResponse.nativeToolCalls,
          done: false,
          ...(providerResponse.reasoning === undefined
            ? {}
            : { reasoning: providerResponse.reasoning }),
          ...(providerResponse.usage === undefined ? {} : { usage: providerResponse.usage }),
          ...(providerResponse.providerItems === undefined
            ? {}
            : { providerItems: providerResponse.providerItems }),
        }),
        allowedToolNames,
        toolCatalog,
      );
    }
    const content = providerResponse.text;
    try {
      // JSON mode should return a bare object; tolerate a fenced block for
      // less complete OpenAI-compatible gateways. DeepSeek documents rare
      // empty JSON-mode responses, so retry one malformed/empty response.
      const parsed = parseAssistantResponseContent(content);
      if (parsed === null) throw new SyntaxError('assistant returned an empty response');
      if (providerResponse.reasoning !== undefined && parsed.reasoning === undefined)
        parsed.reasoning = providerResponse.reasoning;
      if (providerResponse.usage !== undefined && parsed.usage === undefined)
        parsed.usage = providerResponse.usage;
      if (providerResponse.providerItems !== undefined && parsed.providerItems === undefined)
        parsed.providerItems = providerResponse.providerItems;
      return validateAssistantResponse(
        normalizeAssistantResponseToolCallIds(parsed),
        allowedToolNames,
        toolCatalog,
      );
    } catch (error) {
      const outputProblem = error instanceof Error ? error.message : String(error);
      const retryableSchemaFailure =
        /assistant response is missing|assistant "plan"|assistant "toolCalls"|toolCalls\[\d+\]/.test(
          outputProblem,
        );
      if (
        attempt === 0 &&
        (content.trim() === '' || error instanceof SyntaxError || retryableSchemaFailure)
      )
        continue;
      if (error instanceof SyntaxError) {
        throw new Error('assistant returned malformed JSON (schema validation failed)');
      }
      throw error;
    }
  }
  throw new Error('assistant returned malformed JSON (schema validation failed)');
}
