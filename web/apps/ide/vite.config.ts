// LogicPilot IDE dev server.
//
// Telemetry is consumed via a direct WebSocket to the lp-server gateway
// (default ws://127.0.0.1:8089/sim), so no HTTP proxy is required here.
// The AI model panel POSTs to /api/ai-build, which runs the model build
// loop (scripts/ai-build.mjs) inside the dev server process.
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { handleAiBuild } from './scripts/ai-endpoint.mjs';

// Exposes the AI model build loop (scripts/ai-build.mjs) to the IDE at
// POST /api/ai-build during development.
const aiBuildPlugin = (): Plugin => ({
  name: 'logicpilot-ai-build',
  configureServer(server) {
    server.middlewares.use('/api/ai-build', (req, res) => {
      void handleAiBuild(req, res);
    });
  },
});

export default defineConfig({
  plugins: [react(), aiBuildPlugin()],
  server: {
    port: 5173,
  },
});
