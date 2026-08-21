function boundedContent(content, maxResponseBytes) {
  const value = String(content ?? '');
  if (!value) throw new Error('LLM returned an empty response');
  if (Buffer.byteLength(value, 'utf8') > maxResponseBytes) {
    throw new Error('assistant response exceeded the size limit');
  }
  return value;
}

function boundedText(content, maxResponseBytes) {
  const value = String(content ?? '');
  if (Buffer.byteLength(value, 'utf8') > maxResponseBytes) {
    throw new Error('assistant response exceeded the size limit');
  }
  return value;
}

function parseToolArguments(raw) {
  if (raw !== undefined && typeof raw === 'object' && raw !== null) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error('provider returned malformed native tool arguments');
  }
}

function nativeToolCall(id, name, argumentsValue, index = 0) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName) return null;
  // A few OpenAI-compatible gateways omit tool-call ids (or send whitespace)
  // in both the normal and SSE response shapes. The assistant protocol needs
  // a stable, unique, non-empty id so the following tool result can be paired.
  const candidateId = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
  const callId = candidateId || `${cleanName}-native-${index + 1}`;
  return {
    id: callId,
    name: cleanName,
    arguments: parseToolArguments(argumentsValue),
  };
}

function anthropicTools(tools) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

function geminiTools(tools) {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      })),
    },
  ];
}

function usageFrom(value) {
  if (!value || typeof value !== 'object') return undefined;
  const inputTokens = value.prompt_tokens ?? value.input_tokens ?? value.promptTokenCount;
  const outputTokens = value.completion_tokens ?? value.output_tokens ?? value.candidatesTokenCount;
  const reasoningTokens =
    value.completion_tokens_details?.reasoning_tokens ?? value.thoughtsTokenCount;
  const totalTokens = value.total_tokens ?? value.totalTokenCount;
  const usage = {};
  if (Number.isSafeInteger(inputTokens)) usage.inputTokens = inputTokens;
  if (Number.isSafeInteger(outputTokens)) usage.outputTokens = outputTokens;
  if (Number.isSafeInteger(reasoningTokens)) usage.reasoningTokens = reasoningTokens;
  if (Number.isSafeInteger(totalTokens)) usage.totalTokens = totalTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
}

async function requestJson(url, init) {
  const timeout = AbortSignal.timeout(60_000);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 4096);
    const error = new Error(`LLM request failed (${response.status}): ${body}`);
    error.status = response.status;
    error.responseBody = body;
    throw error;
  }
  return response.json();
}

function authHeaders(config) {
  return config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {};
}

function modelListHeaders(config) {
  if (config.protocol === 'anthropic-messages') {
    return {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  if (config.protocol === 'google-gemini') {
    return { 'x-goog-api-key': config.apiKey };
  }
  return authHeaders(config);
}

function modelIdsFromResponse(data) {
  const entries = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : [];
  const ids = [];
  const seen = new Set();
  for (const entry of entries) {
    const id =
      typeof entry === 'string'
        ? entry.trim()
        : typeof entry?.id === 'string'
          ? entry.id.trim()
          : typeof entry?.name === 'string'
            ? entry.name.trim()
            : typeof entry?.model === 'string'
              ? entry.model.trim()
              : '';
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 1000) break;
  }
  return ids;
}

/** Discover models without exposing provider credentials to the browser. */
export async function listProviderModels(config) {
  if (!config || config.protocol === 'codex-app-server') {
    throw new Error('MODEL_LIST_UNSUPPORTED: Codex models are managed by the local login');
  }
  if (!['openai-chat', 'openai-responses', 'anthropic-messages', 'google-gemini'].includes(config.protocol)) {
    throw new Error(`MODEL_LIST_UNSUPPORTED: protocol '${config.protocol}' has no model catalog`);
  }
  const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('AI provider base URL is required to discover models');
  const data = await requestJson(`${baseUrl}/models`, {
    method: 'GET',
    headers: modelListHeaders(config),
  });
  const models = modelIdsFromResponse(data);
  if (models.length === 0) throw new Error('provider returned no discoverable models');
  return models;
}

function openAiConversationMessages(system, userContent, conversationMessages, useNativeTools) {
  if (!useNativeTools || !Array.isArray(conversationMessages)) {
    return [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ];
  }
  const messages = [{ role: 'system', content: system }];
  const lastUserIndex = conversationMessages.reduce(
    (last, message, index) => (message.role === 'user' ? index : last),
    -1,
  );
  for (const [index, message] of conversationMessages.entries()) {
    if (message.role === 'user') {
      messages.push({
        role: 'user',
        // The current context is attached only to the active user turn. Older
        // turns remain compact and do not get the whole transcript duplicated.
        content: index === lastUserIndex ? userContent : message.content,
      });
      continue;
    }
    const calls = (message.toolCalls ?? []).map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    }));
    messages.push({
      role: 'assistant',
      content: message.content || null,
      ...(calls.length > 0 ? { tool_calls: calls } : {}),
    });
    for (const result of message.toolResults ?? []) {
      messages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: JSON.stringify({
          ok: result.ok,
          result: result.result,
          ...(result.error ? { error: result.error } : {}),
        }),
      });
    }
  }
  const last = messages.at(-1);
  if (last?.role === 'tool') {
    messages.push({
      role: 'user',
      content: 'Continue the task using the tool result above. Return the next response.',
    });
  } else if (last?.role !== 'user') messages.push({ role: 'user', content: userContent });
  else if (last.content !== userContent) last.content = userContent;
  return messages;
}

// Responses API uses typed input items instead of Chat Completions' nested
// assistant.tool_calls/tool messages. Keep this projection separate so a
// provider preset cannot accidentally receive the wrong wire format.
function openAiResponsesInput(userContent, conversationMessages, useNativeTools) {
  if (!useNativeTools || !Array.isArray(conversationMessages)) return userContent;
  const input = [];
  const lastUserIndex = conversationMessages.reduce(
    (last, message, index) => (message.role === 'user' ? index : last),
    -1,
  );
  for (const [index, message] of conversationMessages.entries()) {
    if (message.role === 'user') {
      input.push({ role: 'user', content: index === lastUserIndex ? userContent : message.content });
      continue;
    }
    if (message.content) input.push({ role: 'assistant', content: message.content });
    if (Array.isArray(message.providerItems)) input.push(...message.providerItems.map((item) => ({ ...item })));
    for (const call of message.toolCalls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      });
    }
    for (const result of message.toolResults ?? []) {
      input.push({
        type: 'function_call_output',
        call_id: result.toolCallId,
        output: JSON.stringify({
          ok: result.ok,
          result: result.result,
          ...(result.error ? { error: result.error } : {}),
        }),
      });
    }
  }
  const last = input.at(-1);
  if (!last || last.type !== 'function_call_output') input.push({ role: 'user', content: userContent });
  else input.push({ role: 'user', content: 'Continue the task using the tool result above. Return the next response.' });
  return input;
}

function openAiResponsesTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }));
}

function anthropicConversationMessages(userContent, conversationMessages, useNativeTools) {
  if (!useNativeTools || !Array.isArray(conversationMessages)) {
    return [{ role: 'user', content: userContent }];
  }
  const messages = [];
  const lastUserIndex = conversationMessages.reduce(
    (last, message, index) => (message.role === 'user' ? index : last),
    -1,
  );
  for (const [index, message] of conversationMessages.entries()) {
    if (message.role === 'user') {
      messages.push({
        role: 'user',
        content: index === lastUserIndex ? userContent : message.content,
      });
      continue;
    }
    const content = [];
    if (message.content) content.push({ type: 'text', text: message.content });
    for (const call of message.toolCalls ?? []) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
    }
    messages.push({ role: 'assistant', content });
    const results = (message.toolResults ?? []).map((result) => ({
      type: 'tool_result',
      tool_use_id: result.toolCallId,
      content: JSON.stringify({
        ok: result.ok,
        result: result.result,
        ...(result.error ? { error: result.error } : {}),
      }),
      ...(result.ok ? {} : { is_error: true }),
    }));
    if (results.length > 0) messages.push({ role: 'user', content: results });
  }
  const last = messages.at(-1);
  if (last?.role !== 'user') messages.push({ role: 'user', content: userContent });
  else if (Array.isArray(last.content))
    messages.push({ role: 'user', content: 'Continue the task using the tool result above. Return the next response.' });
  else if (last.content !== userContent) last.content = userContent;
  return messages;
}

function geminiConversationContents(userContent, conversationMessages, useNativeTools) {
  if (!useNativeTools || !Array.isArray(conversationMessages)) {
    return [{ role: 'user', parts: [{ text: userContent }] }];
  }
  const contents = [];
  const lastUserIndex = conversationMessages.reduce(
    (last, message, index) => (message.role === 'user' ? index : last),
    -1,
  );
  for (const [index, message] of conversationMessages.entries()) {
    const parts = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.toolCalls ?? [])
      parts.push({ functionCall: { name: call.name, args: call.arguments } });
    if (message.role === 'user' && index === lastUserIndex) parts.splice(0, parts.length, { text: userContent });
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    const results = (message.toolResults ?? []).map((result) => ({
      // Gemini requires the original function name here. The opaque call id
      // is a separate correlation field and must not replace `name`.
      functionResponse: {
        name:
          (message.toolCalls ?? []).find((call) => call.id === result.toolCallId)?.name ??
          result.toolCallId,
        id: result.toolCallId,
        response: {
          ok: result.ok,
          result: result.result,
          ...(result.error ? { error: result.error } : {}),
        },
      },
    }));
    if (results.length > 0) contents.push({ role: 'user', parts: results });
  }
  const last = contents.at(-1);
  if (last?.role !== 'user') contents.push({ role: 'user', parts: [{ text: userContent }] });
  else if (last.parts.some((part) => part.functionResponse))
    contents.push({ role: 'user', parts: [{ text: 'Continue the task using the tool result above. Return the next response.' }] });
  else last.parts = [{ text: userContent }];
  return contents;
}

export async function requestProviderResponse(
  config,
  {
    system,
    userContent,
    conversationMessages,
    maxTokens,
    maxResponseBytes,
    jsonOutput = true,
    tools = [],
    signal,
  },
) {
  const commonHeaders = { 'content-type': 'application/json' };
  if (config.protocol === 'openai-chat') {
    const useNativeTools = config.nativeTools === true && tools.length > 0;
    const body = {
      model: config.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: openAiConversationMessages(
        system,
        userContent,
        conversationMessages,
        useNativeTools,
      ),
    };
    if (jsonOutput && !useNativeTools) body.response_format = { type: 'json_object' };
    if (useNativeTools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    if (
      config.providerId === 'deepseek' ||
      /deepseek/i.test(config.model) ||
      /api\.deepseek\.com/i.test(config.baseUrl)
    ) {
      body.thinking = { type: config.thinking ?? 'disabled' };
    }
    const request = () =>
      requestJson(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...commonHeaders, ...authHeaders(config) },
        body: JSON.stringify(body),
        signal,
      });
    let data;
    try {
      data = await request();
    } catch (error) {
      if (
        useNativeTools &&
        [400, 422].includes(error?.status) &&
        /tool|function|unsupported/i.test(error?.responseBody ?? '')
      ) {
        delete body.tools;
        delete body.tool_choice;
        body.response_format = { type: 'json_object' };
        data = await request();
      } else {
        // A large number of "OpenAI-compatible" local/hosted gateways omit
        // JSON mode. The system prompt still requires JSON, so retry once
        // without the optional field when the gateway rejects that field.
        if (
          ![400, 422].includes(error?.status) ||
          !/response[_ -]?format|json mode/i.test(error?.responseBody ?? '')
        )
          throw error;
        delete body.response_format;
        data = await request();
      }
    }
    const message = data?.choices?.[0]?.message ?? {};
    const nativeToolCalls = (message.tool_calls ?? [])
      .map((call, index) =>
        nativeToolCall(call?.id, call?.function?.name, call?.function?.arguments, index),
      )
      .filter(Boolean);
    return {
      text: useNativeTools
        ? boundedText(message.content, maxResponseBytes)
        : boundedContent(message.content, maxResponseBytes),
      ...(nativeToolCalls.length > 0 ? { nativeToolCalls } : {}),
      ...(typeof message.reasoning_content === 'string'
        ? { reasoning: message.reasoning_content }
        : {}),
      ...(usageFrom(data?.usage) === undefined ? {} : { usage: usageFrom(data.usage) }),
    };
  }
  if (config.protocol === 'openai-responses') {
    const useNativeTools = config.nativeTools === true && tools.length > 0;
    const data = await requestJson(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: { ...commonHeaders, ...authHeaders(config) },
      signal,
      body: JSON.stringify({
        model: config.model,
        instructions: system,
        input: useNativeTools
          ? openAiResponsesInput(userContent, conversationMessages, true)
          : userContent,
        max_output_tokens: maxTokens,
        store: false,
        ...(useNativeTools ? { tools: openAiResponsesTools(tools), tool_choice: 'auto' } : {}),
      }),
    });
    const content =
      data?.output_text ??
      data?.output
        ?.flatMap((item) => item?.content ?? [])
        .filter((item) => item?.type === 'output_text')
        .map((item) => item.text)
        .join('');
    const nativeToolCalls = (data?.output ?? [])
      .filter((item) => item?.type === 'function_call')
      .map((item, index) => nativeToolCall(item.call_id ?? item.id, item.name, item.arguments, index))
      .filter(Boolean);
    return {
      text: useNativeTools
        ? boundedText(content, maxResponseBytes)
        : boundedContent(content, maxResponseBytes),
      ...(nativeToolCalls.length > 0 ? { nativeToolCalls } : {}),
      ...(Array.isArray(data?.output)
        ? { providerItems: data.output.filter((item) => item?.type === 'reasoning') }
        : {}),
      ...(usageFrom(data?.usage) === undefined ? {} : { usage: usageFrom(data.usage) }),
    };
  }
  if (config.protocol === 'anthropic-messages') {
    const useNativeTools = config.nativeTools === true && tools.length > 0;
    const data = await requestJson(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: { ...commonHeaders, 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      signal,
      body: JSON.stringify({
        model: config.model,
        system,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: anthropicConversationMessages(userContent, conversationMessages, useNativeTools),
        ...(useNativeTools ? { tools: anthropicTools(tools), tool_choice: { type: 'auto' } } : {}),
      }),
    });
    const nativeToolCalls = (data?.content ?? [])
      .filter((item) => item?.type === 'tool_use')
      .map((item, index) => nativeToolCall(item.id, item.name, item.input, index))
      .filter(Boolean);
    const content = data?.content
      ?.filter((item) => item?.type === 'text')
      .map((item) => item.text)
      .join('');
    return {
      text: useNativeTools
        ? boundedText(content, maxResponseBytes)
        : boundedContent(content, maxResponseBytes),
      ...(nativeToolCalls.length > 0 ? { nativeToolCalls } : {}),
      ...(usageFrom(data?.usage) === undefined ? {} : { usage: usageFrom(data.usage) }),
    };
  }
  if (config.protocol === 'google-gemini') {
    const useNativeTools = config.nativeTools === true && tools.length > 0;
    const model = encodeURIComponent(config.model.replace(/^models\//, ''));
    const data = await requestJson(`${config.baseUrl}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { ...commonHeaders, 'x-goog-api-key': config.apiKey },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: geminiConversationContents(userContent, conversationMessages, useNativeTools),
        ...(useNativeTools ? { tools: geminiTools(tools) } : {}),
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: maxTokens,
          ...(jsonOutput && !useNativeTools ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const nativeToolCalls = parts
      .filter((item) => item?.functionCall)
      .map((item, index) =>
        nativeToolCall(item.functionCall.id ?? `gemini-${index}`, item.functionCall.name, item.functionCall.args),
      )
      .filter(Boolean);
    const content = parts.map((item) => item.text ?? '').join('');
    return {
      text: useNativeTools
        ? boundedText(content, maxResponseBytes)
        : boundedContent(content, maxResponseBytes),
      ...(nativeToolCalls.length > 0 ? { nativeToolCalls } : {}),
      ...(usageFrom(data?.usageMetadata) === undefined
        ? {}
        : { usage: usageFrom(data.usageMetadata) }),
    };
  }
  throw new Error(`unsupported AI protocol '${config.protocol}'`);
}

/** Stream OpenAI-compatible chat deltas and fold them into one provider-neutral response. */
export async function requestProviderStream(
  config,
  {
    system,
    userContent,
    conversationMessages,
    maxTokens,
    maxResponseBytes,
    jsonOutput = true,
    tools = [],
    onChunk,
    signal,
  },
) {
  if (config.protocol !== 'openai-chat') throw new Error('STREAM_UNSUPPORTED');
  const useNativeTools = config.nativeTools === true && tools.length > 0;
  const body = {
    model: config.model,
    temperature: 0.2,
    max_tokens: maxTokens,
    stream: true,
    messages: openAiConversationMessages(system, userContent, conversationMessages, useNativeTools),
    ...(jsonOutput && !useNativeTools ? { response_format: { type: 'json_object' } } : {}),
    ...(useNativeTools ? { tools, tool_choice: 'auto' } : {}),
    ...(config.providerId === 'deepseek' ||
    /deepseek/i.test(config.model) ||
    /api\.deepseek\.com/i.test(config.baseUrl)
      ? { thinking: { type: config.thinking ?? 'disabled' } }
      : {}),
  };
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(config) },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const bodyText = (await response.text()).slice(0, 4096);
    const error = new Error(`LLM request failed (${response.status}): ${bodyText}`);
    error.status = response.status;
    error.responseBody = bodyText;
    throw error;
  }
  if (!response.body) throw new Error('STREAM_UNSUPPORTED');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const textParts = [];
  const reasoningParts = [];
  const nativeCalls = new Map();
  let usage;
  const consume = (payload) => {
    if (!payload || payload === '[DONE]') return payload === '[DONE]';
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      return false;
    }
    const delta = data?.choices?.[0]?.delta ?? {};
    if (typeof delta.content === 'string' && delta.content !== '') {
      textParts.push(delta.content);
      onChunk?.({ type: 'text', delta: delta.content });
    }
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning !== '') {
      reasoningParts.push(reasoning);
      onChunk?.({ type: 'reasoning', delta: reasoning });
    }
    for (const call of delta.tool_calls ?? []) {
      const index = Number.isInteger(call.index) ? call.index : nativeCalls.size;
      const current = nativeCalls.get(index) ?? {
        id: call.id,
        name: call.function?.name ?? '',
        arguments: '',
      };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name = call.function.name;
      if (call.function?.arguments) current.arguments += call.function.arguments;
      nativeCalls.set(index, current);
    }
    usage = usageFrom(data?.usage) ?? usage;
    return false;
  };
  let finished = false;
  while (!finished) {
    const next = await reader.read();
    buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      if (consume(line.slice(5).trim())) {
        finished = true;
        break;
      }
    }
    if (next.done) break;
  }
  if (buffer.startsWith('data:')) consume(buffer.slice(5).trim());
  const nativeToolCalls = [...nativeCalls.values()]
    .map((call, index) => nativeToolCall(call.id, call.name, call.arguments, index))
    .filter(Boolean);
  const text = textParts.join('');
  if (!useNativeTools && text === '') throw new Error('LLM returned an empty response');
  if (Buffer.byteLength(text, 'utf8') > maxResponseBytes)
    throw new Error('assistant response exceeded the size limit');
  return {
    text,
    ...(nativeToolCalls.length > 0 ? { nativeToolCalls } : {}),
    ...(reasoningParts.length > 0 ? { reasoning: reasoningParts.join('') } : {}),
    ...(usage === undefined ? {} : { usage }),
  };
}

export async function requestProviderText(config, options) {
  return (await requestProviderResponse(config, options)).text;
}
