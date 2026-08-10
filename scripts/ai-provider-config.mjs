// Runtime-only AI provider configuration. Secrets intentionally live only in
// this Node process: they are never serialized to the browser or project.

export const AI_PROTOCOLS = Object.freeze([
  { id: 'openai-chat', label: 'OpenAI Chat Completions' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'anthropic-messages', label: 'Anthropic Messages' },
  { id: 'google-gemini', label: 'Google Gemini generateContent' },
  { id: 'codex-app-server', label: 'Codex login (app-server)' },
]);

const preset = (id, name, protocol, baseUrl, models, options = {}) =>
  Object.freeze({ id, name, protocol, baseUrl, models: Object.freeze(models), ...options });

export const AI_PROVIDER_PRESETS = Object.freeze([
  preset('codex', 'Codex (OpenAI login)', 'codex-app-server', '', [], { auth: 'login', group: 'CLI / login' }),
  preset('openai', 'OpenAI', 'openai-responses', 'https://api.openai.com/v1', ['gpt-5.4', 'gpt-5.4-mini'], { group: 'Cloud' }),
  preset('anthropic', 'Anthropic', 'anthropic-messages', 'https://api.anthropic.com/v1', ['claude-sonnet-4-6', 'claude-opus-4-6'], { group: 'Cloud' }),
  preset('google', 'Google Gemini', 'google-gemini', 'https://generativelanguage.googleapis.com/v1beta', ['gemini-3.5-flash', 'gemini-3.1-pro-preview'], { group: 'Cloud' }),
  preset('deepseek', 'DeepSeek', 'openai-chat', 'https://api.deepseek.com', ['deepseek-chat', 'deepseek-reasoner'], { group: 'Cloud' }),
  preset('openrouter', 'OpenRouter', 'openai-chat', 'https://openrouter.ai/api/v1', [], { group: 'Model routers' }),
  preset('xai', 'xAI', 'openai-responses', 'https://api.x.ai/v1', ['grok-4.5'], { group: 'Cloud' }),
  preset('mistral', 'Mistral AI', 'openai-chat', 'https://api.mistral.ai/v1', ['mistral-large-latest', 'mistral-small-latest'], { group: 'Cloud' }),
  preset('groq', 'Groq', 'openai-chat', 'https://api.groq.com/openai/v1', [], { group: 'Inference clouds' }),
  preset('cerebras', 'Cerebras', 'openai-chat', 'https://api.cerebras.ai/v1', [], { group: 'Inference clouds' }),
  preset('together', 'Together AI', 'openai-chat', 'https://api.together.xyz/v1', [], { group: 'Inference clouds' }),
  preset('fireworks', 'Fireworks AI', 'openai-chat', 'https://api.fireworks.ai/inference/v1', [], { group: 'Inference clouds' }),
  preset('moonshot', 'Moonshot / Kimi', 'openai-chat', 'https://api.moonshot.ai/v1', [], { group: 'China cloud' }),
  preset('qwen', 'Alibaba Qwen (DashScope)', 'openai-chat', 'https://dashscope.aliyuncs.com/compatible-mode/v1', ['qwen-plus', 'qwen-max'], { group: 'China cloud' }),
  preset('zhipu', 'Zhipu GLM', 'openai-chat', 'https://open.bigmodel.cn/api/paas/v4', [], { group: 'China cloud' }),
  preset('siliconflow', 'SiliconFlow', 'openai-chat', 'https://api.siliconflow.cn/v1', [], { group: 'China cloud' }),
  preset('minimax', 'MiniMax', 'openai-chat', 'https://api.minimax.io/v1', [], { group: 'China cloud' }),
  preset('ollama', 'Ollama', 'openai-chat', 'http://127.0.0.1:11434/v1', ['gpt-oss:20b', 'qwen3'], { auth: 'optional', group: 'Local' }),
  preset('lmstudio', 'LM Studio', 'openai-chat', 'http://127.0.0.1:1234/v1', [], { auth: 'optional', group: 'Local' }),
  preset('vllm', 'vLLM', 'openai-chat', 'http://127.0.0.1:8000/v1', [], { auth: 'optional', group: 'Local' }),
  preset('custom', 'Custom endpoint', 'openai-chat', '', [], { auth: 'optional', group: 'Custom' }),
]);

let sessionConfig = null;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getProviderPreset(id) {
  return AI_PROVIDER_PRESETS.find((entry) => entry.id === id) ?? null;
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return value.replace(/\/+$/, '');
  } catch {
    throw new Error('AI provider base URL must be an http(s) URL');
  }
}

export function configureAssistantProvider(input = {}) {
  const providerId = clean(input.providerId) || 'custom';
  const preset = getProviderPreset(providerId);
  if (!preset) throw new Error(`unknown AI provider '${providerId}'`);
  const protocol = clean(input.protocol) || preset.protocol;
  if (!AI_PROTOCOLS.some((entry) => entry.id === protocol)) {
    throw new Error(`unsupported AI protocol '${protocol}'`);
  }
  if (protocol === 'codex-app-server') {
    sessionConfig = { providerId, protocol, baseUrl: '', model: clean(input.model), apiKey: '' };
    return getAssistantProviderState();
  }
  const baseUrl = validateUrl(clean(input.baseUrl) || preset.baseUrl);
  const model = clean(input.model) || preset.models[0] || '';
  if (!model) throw new Error('AI provider model is required');
  const previousKey = sessionConfig?.apiKey ?? '';
  const apiKey = input.clearApiKey === true ? '' : clean(input.apiKey) || previousKey;
  if (preset.auth !== 'optional' && !apiKey) throw new Error(`${preset.name} requires an API key`);
  sessionConfig = { providerId, protocol, baseUrl, model, apiKey };
  return getAssistantProviderState();
}

export function clearAssistantProviderSession() {
  sessionConfig = null;
}

export function resolveAssistantConfiguration(environment = process.env) {
  if (sessionConfig) return { ...sessionConfig, source: 'session' };
  const requested = clean(environment.LOGICPILOT_AI_PROVIDER).toLowerCase();
  if (requested === 'codex') {
    return { providerId: 'codex', protocol: 'codex-app-server', baseUrl: '', model: clean(environment.LOGICPILOT_CODEX_MODEL), apiKey: '', source: 'environment' };
  }
  const genericKey = clean(environment.LOGICPILOT_AI_API_KEY) || clean(environment.OPENAI_API_KEY);
  if (genericKey || requested === 'api') {
    return {
      providerId: requested && requested !== 'api' && getProviderPreset(requested) ? requested : 'custom',
      protocol: clean(environment.LOGICPILOT_AI_PROTOCOL) || 'openai-chat',
      baseUrl: (clean(environment.LOGICPILOT_AI_BASE_URL) || clean(environment.OPENAI_BASE_URL) || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: clean(environment.LOGICPILOT_AI_MODEL) || clean(environment.OPENAI_MODEL) || 'gpt-4o-mini',
      apiKey: genericKey,
      source: 'environment',
    };
  }
  return { providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '', source: 'unconfigured' };
}

export function getAssistantProviderState(environment = process.env) {
  const active = resolveAssistantConfiguration(environment);
  return {
    protocols: AI_PROTOCOLS,
    providers: AI_PROVIDER_PRESETS,
    active: {
      providerId: active.providerId,
      protocol: active.protocol,
      baseUrl: active.baseUrl,
      model: active.model,
      source: active.source,
      configured: active.protocol === 'codex-app-server' || Boolean(active.model && (active.apiKey || getProviderPreset(active.providerId)?.auth === 'optional')),
      hasApiKey: Boolean(active.apiKey),
    },
  };
}
