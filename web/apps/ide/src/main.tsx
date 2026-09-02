import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startIdePluginHost } from './plugins/host';
import './styles/index.css';

async function bootstrap(): Promise<void> {
  try {
    // Plugin activation must finish before App (and therefore layoutStore)
    // is evaluated. Otherwise persisted layouts can validate against an
    // incomplete panel/document registry and silently discard plugin tabs.
    await startIdePluginHost();
  } catch (error) {
    // A broken plugin must not blank the fixed shell. The host rolls back
    // partial activation before rejecting, then App loads with core panels.
    globalThis.reportError(error);
  }

  const { default: App } = await import('./App');
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('root element not found');

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
