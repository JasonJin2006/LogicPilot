// Desktop app config: the Tauri shell hands the app server's http base and
// gateway ws URL to the page through the `app_config` command. In the
// browser (vite dev / app-server-served) the API is same-origin and the
// gateway URL comes from /api/config, so this returns null.

export interface AppConfig {
  apiBase: string;
  wsUrl: string;
}

let cached: AppConfig | null | undefined;

export async function getAppConfig(): Promise<AppConfig | null> {
  if (cached !== undefined) return cached;
  cached = null;
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const config = (await invoke('app_config')) as { api_base: string; ws_url: string };
      cached = { apiBase: config.api_base, wsUrl: config.ws_url };
      return cached;
    } catch {
      // The Tauri command can briefly race the app-server bootstrap. Do not
      // cache this transient failure; the next retry must be allowed to
      // resolve the injected gateway port.
      return null;
    }
  }
  cached = null;
  return cached;
}
