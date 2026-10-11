/** Compatibility boundary for the old lp-server WebSocket gateway.
 * New execution consumers must use ExecutionClient/ExecutionStore. Keeping
 * this alias explicit makes the remaining legacy path easy to remove after
 * canvas telemetry migration. */
export { logConsoleEvent, useConnectionStore as useLegacyGatewayStore } from './connectionStore';
