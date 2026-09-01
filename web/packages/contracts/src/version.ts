// Platform plugin API version gate. The host rejects manifests whose apiVersion
// is outside this set; bumping is a breaking contract change that requires a
// baseline refresh (scripts/check-contract-conform.mjs).
export const SUPPORTED_PLUGIN_API_VERSIONS: readonly number[] = [1];

export function isSupportedPluginApiVersion(version: number): boolean {
  return SUPPORTED_PLUGIN_API_VERSIONS.includes(version);
}
