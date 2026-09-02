// Node-only entrypoint. Keep filesystem stores out of the browser-safe
// @logicpilot/plugin-host root so Vite cannot externalize node:fs/path into
// the IDE bundle.
export * from './plugin-draft-store.js';
