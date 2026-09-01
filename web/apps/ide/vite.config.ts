// LogicPilot IDE dev server.
//
// Telemetry is consumed via a direct WebSocket to the lp-server gateway
// (default ws://127.0.0.1:8089/sim), so no HTTP proxy is required here.
// The AI panel's one-shot actions POST to /api/ai-build etc., which run
// inside the dev server process; the assistant runtime uses /api/assistant
// and /api/assistant/stream through the same middleware.
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { createApiRequestPolicy } from '../../../app/request-policy.mjs';

import {
  handleAiAssistant,
  handleAiAssistantStream,
  handleAiProviderModels,
  handleAiProviders,
  handleAiProviderTest,
  handleMcpCall,
  handleMcpCapabilities,
  handleAiBuild,
  handleAiCompareMetrics,
  handleAiExplain,
  handleAiOptimize,
  handleAiPatch,
  handleParameterVariation,
  handleAiQueryMetrics,
  handleAiRun,
  handleAiValidate,
  handleConfig,
} from './scripts/ai-endpoint.mjs';

// Exposes the AI model build loop (scripts/ai-build.mjs) to the IDE at
// POST /api/ai-build during development.
const aiBuildPlugin = (): Plugin => ({
  name: 'logicpilot-ai-build',
  configureServer(server) {
    const runWithApiPolicy = createApiRequestPolicy();
    server.middlewares.use('/api/ai-providers/test', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiProviderTest(req, res));
    });
    server.middlewares.use('/api/ai-providers/models', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiProviderModels(req, res));
    });
    server.middlewares.use('/api/ai-providers', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiProviders(req, res));
    });
    server.middlewares.use('/api/mcp/capabilities', (req, res) => {
      void runWithApiPolicy(req, res, () => handleMcpCapabilities(req, res));
    });
    server.middlewares.use('/api/mcp/call', (req, res) => {
      void runWithApiPolicy(req, res, () => handleMcpCall(req, res));
    });
    server.middlewares.use('/api/ai-build', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiBuild(req, res));
    });
    server.middlewares.use('/api/ai-optimize', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiOptimize(req, res));
    });
    server.middlewares.use('/api/ai-run', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiRun(req, res));
    });
    server.middlewares.use('/api/parameter-variation', (req, res) => {
      void runWithApiPolicy(req, res, () => handleParameterVariation(req, res));
    });
    server.middlewares.use('/api/ai-validate', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiValidate(req, res));
    });
    server.middlewares.use('/api/ai-patch', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiPatch(req, res));
    });
    server.middlewares.use('/api/ai-query-metrics', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiQueryMetrics(req, res));
    });
    server.middlewares.use('/api/ai-compare-metrics', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiCompareMetrics(req, res));
    });
    server.middlewares.use('/api/ai-explain', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiExplain(req, res));
    });
    server.middlewares.use('/api/assistant/stream', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiAssistantStream(req, res));
    });
    server.middlewares.use('/api/assistant', (req, res) => {
      void runWithApiPolicy(req, res, () => handleAiAssistant(req, res));
    });
    server.middlewares.use('/api/config', (req, res) => {
      void runWithApiPolicy(req, res, () => handleConfig(req, res));
    });
  },
});

export default defineConfig({
  plugins: [react(), aiBuildPlugin()],
  server: {
    port: 5173,
  },
  // Keep Rollup's graph-aware chunking. A catch-all node_modules/manual
  // vendor chunk makes the dynamically imported 1.4 MB ELK fallback eager
  // and also creates cycles with elk-api; the default splitter keeps it out
  // of index.html and loads it only when Worker startup fails.
});
