// Desktop app config: the Tauri shell hands the app server's http base and
// gateway ws URL to the page through the `app_config` command. In the
// browser (vite dev / app-server-served) the API is same-origin and the
// gateway URL comes from /api/config, so this returns null.

export interface AppConfig {
  apiBase: string;
  wsUrl: string;
  sessionToken: string;
  agentEngine: 'builtin' | 'sdk.openai-agents';
}

let cached: AppConfig | null | undefined;

export async function getAppConfig(): Promise<AppConfig | null> {
  if (cached !== undefined) return cached;
  cached = null;
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const config = (await invoke('app_config')) as {
        api_base: string;
        ws_url: string;
        session_token: string;
        agent_engine?: string;
      };
      cached = {
        apiBase: config.api_base,
        wsUrl: config.ws_url,
        sessionToken: config.session_token,
        agentEngine: config.agent_engine === 'sdk.openai-agents' ? 'sdk.openai-agents' : 'builtin',
      };
      return cached;
    } catch {
      // The Tauri command can briefly race the app-server bootstrap. Do not
      // cache this transient failure; the next retry must be allowed to
      // resolve the injected gateway port.
      cached = undefined;
      return null;
    }
  }
  // Vitest/Node callers do not have a browser origin to bootstrap from. Keep
  // the browser-only discovery out of server-side/unit-test fetch mocks.
  if (typeof window === 'undefined') {
    cached = null;
    return cached;
  }
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = (await response.json()) as {
      wsUrl?: string;
      sessionToken?: string;
      agentEngine?: string;
    };
    cached = {
      apiBase: '',
      wsUrl: config.wsUrl ?? '',
      sessionToken: config.sessionToken ?? '',
      agentEngine: config.agentEngine === 'sdk.openai-agents' ? 'sdk.openai-agents' : 'builtin',
    };
    return cached;
  } catch {
    cached = undefined;
    return null;
  }
}

export function sessionHeaders(config: AppConfig | null): Record<string, string> {
  return config?.sessionToken ? { 'x-logicpilot-session': config.sessionToken } : {};
}
