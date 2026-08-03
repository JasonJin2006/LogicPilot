// LogicPilot IDE dev server.
//
// Telemetry is consumed via a direct WebSocket to the lp-server gateway
// (default ws://127.0.0.1:8089/sim), so no HTTP proxy is required here.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
