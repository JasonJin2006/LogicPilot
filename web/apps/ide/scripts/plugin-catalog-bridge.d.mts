// Type declarations for the plugin catalog bridge (Phase 2B-1, ADR-0071).
// The implementation lives in plugin-catalog-bridge.mjs; the scan/validation
// logic is in @logicpilot/plugin-catalog (Node-only, never bundled).
export function handlePluginCatalog(req: unknown, res: unknown): Promise<void>;
export function handlePlugins(req: unknown, res: unknown): Promise<void>;
export function startNodePluginRuntime(): Promise<unknown>;
export function stopNodePluginRuntime(): Promise<void>;
