import { getAppConfig, sessionHeaders } from '../state/appConfig';

export interface AiProtocolInfo {
  id: string;
  label: string;
}
export interface AiProviderPreset {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  models: string[];
  auth?: 'login' | 'optional';
  group: string;
}
export interface AiProviderState {
  protocols: AiProtocolInfo[];
  providers: AiProviderPreset[];
  active: {
    providerId: string;
    protocol: string;
    baseUrl: string;
    model: string;
    source: string;
    configured: boolean;
    hasApiKey: boolean;
  };
}

async function endpoint(path: string, init?: RequestInit) {
  const config = await getAppConfig();
  const response = await fetch(`${config?.apiBase ?? ''}${path}`, {
    cache: 'no-store',
    ...init,
    headers: { ...sessionHeaders(config), ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(String(data?.error ?? `request failed (${response.status})`));
  return data;
}

export function getAiProviderState(): Promise<AiProviderState> {
  return endpoint('/api/ai-providers');
}

export function saveAiProvider(input: {
  providerId: string;
  protocol: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Promise<AiProviderState> {
  return endpoint('/api/ai-providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function resetAiProvider(): Promise<AiProviderState> {
  return endpoint('/api/ai-providers', { method: 'DELETE' });
}

export function testAiProvider(input?: {
  providerId: string;
  protocol: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Promise<{ ok: true; latencyMs: number }> {
  return endpoint('/api/ai-providers/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
}

export interface AiProviderModelsResult {
  ok: true;
  providerId: string;
  protocol: string;
  models: string[];
}

export function listAiProviderModels(input?: {
  providerId: string;
  protocol: string;
  baseUrl: string;
  model?: string;
  apiKey?: string;
}): Promise<AiProviderModelsResult> {
  return endpoint('/api/ai-providers/models', {
    method: input ? 'POST' : 'GET',
    headers: input ? { 'content-type': 'application/json' } : undefined,
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
}
