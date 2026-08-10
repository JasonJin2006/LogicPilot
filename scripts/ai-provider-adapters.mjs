function boundedContent(content, maxResponseBytes) {
  const value = String(content ?? '');
  if (!value) throw new Error('LLM returned an empty response');
  if (Buffer.byteLength(value, 'utf8') > maxResponseBytes) {
    throw new Error('assistant response exceeded the size limit');
  }
  return value;
}

async function requestJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
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

export async function requestProviderText(config, { system, userContent, maxTokens, maxResponseBytes, jsonOutput = true }) {
  const commonHeaders = { 'content-type': 'application/json' };
  if (config.protocol === 'openai-chat') {
    const body = {
      model: config.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
    };
    if (jsonOutput) body.response_format = { type: 'json_object' };
    if (config.providerId === 'deepseek' || /deepseek/i.test(config.model) || /api\.deepseek\.com/i.test(config.baseUrl)) {
      body.thinking = { type: config.thinking ?? 'disabled' };
    }
    const request = () => requestJson(`${config.baseUrl}/chat/completions`, {
      method: 'POST', headers: { ...commonHeaders, ...authHeaders(config) }, body: JSON.stringify(body),
    });
    let data;
    try {
      data = await request();
    } catch (error) {
      // A large number of "OpenAI-compatible" local/hosted gateways omit
      // JSON mode. The system prompt still requires JSON, so retry once
      // without the optional field when the gateway rejects that field.
      if (![400, 422].includes(error?.status) || !/response[_ -]?format|json mode/i.test(error?.responseBody ?? '')) throw error;
      delete body.response_format;
      data = await request();
    }
    return boundedContent(data?.choices?.[0]?.message?.content, maxResponseBytes);
  }
  if (config.protocol === 'openai-responses') {
    const data = await requestJson(`${config.baseUrl}/responses`, {
      method: 'POST',
      headers: { ...commonHeaders, ...authHeaders(config) },
      body: JSON.stringify({ model: config.model, instructions: system, input: userContent, max_output_tokens: maxTokens, store: false }),
    });
    const content = data?.output_text ?? data?.output?.flatMap((item) => item?.content ?? []).filter((item) => item?.type === 'output_text').map((item) => item.text).join('');
    return boundedContent(content, maxResponseBytes);
  }
  if (config.protocol === 'anthropic-messages') {
    const data = await requestJson(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: { ...commonHeaders, 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.model, system, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'user', content: userContent }] }),
    });
    return boundedContent(data?.content?.filter((item) => item?.type === 'text').map((item) => item.text).join(''), maxResponseBytes);
  }
  if (config.protocol === 'google-gemini') {
    const model = encodeURIComponent(config.model.replace(/^models\//, ''));
    const data = await requestJson(`${config.baseUrl}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { ...commonHeaders, 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, ...(jsonOutput ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
    return boundedContent(data?.candidates?.[0]?.content?.parts?.map((item) => item.text ?? '').join(''), maxResponseBytes);
  }
  throw new Error(`unsupported AI protocol '${config.protocol}'`);
}
