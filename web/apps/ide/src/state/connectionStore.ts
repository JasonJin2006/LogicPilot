// Connection + run-control store: owns the SimClient lifecycle and applies
// incoming telemetry frames to the shared viz state and the run store.
// Components read their slices with zustand selectors, so 10 Hz telemetry
// re-renders only the subscribers that actually display it.

import { create } from 'zustand';
import { MM1_STATE_SERVING, type WireFrame } from '@logicpilot/renderer2d';
import { generateDsl, modelRunParams } from '@logicpilot/editor';
import { SimClient, type ConnState, type StartOptions } from '../client/simClient';
import { parseBlockCounters, resetVizState, vizState, type VizAgent } from './vizState';
import { useModelStore } from './modelStore';
import { useRunStore } from './runStore';
import { getAppConfig } from './appConfig';

const DEFAULT_URL = 'ws://127.0.0.1:8089/sim';

export interface LogEvent {
  id: number;
  time: string;
  kind: 'ack' | 'error' | 'bad' | 'info' | 'warn';
  text: string;
}

interface ConnectionStore {
  url: string;
  conn: ConnState;
  seq: bigint | null;
  simTimeNs: bigint | null;
  fps: number;
  lastAck: string;
  error: string;
  badFrames: number;
  events: LogEvent[];

  setUrl: (url: string) => void;
  setFps: (fps: number) => void;
  /** Connect now and retry silently while the gateway boots. */
  autoConnect: () => void;
  connect: () => void;
  disconnect: () => void;
  start: (options: StartOptions) => void;
  pause: () => void;
  resume: () => void;
  step: () => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
  /** Compile the canvas model, or `source` when given (file editor). */
  compile: (source?: string) => void;
  runCanvasModel: () => void;
}

let client: SimClient | null = null;
let nextEventId = 1;
let configResolved = false;
// Continuation invoked when the next compile reply arrives (Run = compile,
// then start when the model compiles).
let pendingRunContinuation: ((ok: boolean) => void) | null = null;
// Auto-connect retry loop: the desktop gateway may still be booting when the
// page first loads; retry a few times silently, then give up (the status dot
// turns red and Settings offers a manual Connect). A manual disconnect
// cancels the loop.
let retryTimer: number | null = null;
let retryCount = 0;
const AUTO_CONNECT_INTERVAL_MS = 2000;
const AUTO_CONNECT_MAX_RETRIES = 15;

function stopAutoConnect(): void {
  if (retryTimer !== null) {
    window.clearInterval(retryTimer);
    retryTimer = null;
  }
  retryCount = 0;
}

const MAX_EVENTS = 200;

// Resolve the gateway URL from the app server (/api/config); the desktop
// client injects the lp-server port there, the vite dev server reports the
// default. Falls back to DEFAULT_URL when the endpoint is unavailable.
async function resolveGatewayConfig(): Promise<void> {
  if (configResolved) return;
  configResolved = true;
  const desktop = await getAppConfig();
  if (desktop?.wsUrl) {
    useConnectionStore.setState({ url: desktop.wsUrl });
    return;
  }
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (response.ok) {
      const config = (await response.json()) as { wsUrl?: string };
      if (config.wsUrl) {
        useConnectionStore.setState({ url: config.wsUrl });
      }
    }
  } catch {
    // keep the default
  }
}

function makeEvent(kind: LogEvent['kind'], text: string): LogEvent {
  return {
    id: nextEventId++,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    kind,
    text,
  };
}

/** Append a line to the console (project diagnostics, sync conflicts, ...)
 *  from outside the connection lifecycle. */
export function logConsoleEvent(kind: LogEvent['kind'], text: string): void {
  useConnectionStore.setState((state) => ({
    events: appendEvent(state, kind, text),
  }));
}

function appendEvent(state: ConnectionStore, kind: LogEvent['kind'], text: string): LogEvent[] {
  const event = makeEvent(kind, text);
  const events = [...state.events, event];
  return events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
}

interface CompileDiagnostic {
  code?: string;
  severity?: string;
  message?: string;
  span?: { line?: number; column?: number };
}

// Compile replies are a diagnostics document; render them as structured
// console lines instead of a raw ack.
function parseCompileReply(message: string): { ok: boolean; events: LogEvent[] } | null {
  let parsed: { ok?: boolean; diagnostics?: CompileDiagnostic[] };
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('diagnostics' in parsed)) {
    return null;
  }
  const diagnostics = Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
  const events: LogEvent[] = diagnostics.map((diagnostic) => {
    const where = diagnostic.span
      ? ` (${diagnostic.span.line ?? '?'}:${diagnostic.span.column ?? '?'})`
      : '';
    return makeEvent(
      diagnostic.severity === 'warning' || diagnostic.severity === 'warn' ? 'warn' : 'error',
      `${diagnostic.code ?? 'LP'}: ${diagnostic.message ?? ''}${where}`,
    );
  });
  events.push(
    parsed.ok
      ? makeEvent('info', `compile ok: ${diagnostics.length} diagnostic(s)`)
      : makeEvent('error', `compile failed: ${diagnostics.length} error(s)`),
  );
  return { ok: parsed.ok === true, events };
}

// Apply one telemetry frame to viz + run stores (single writer).
function applyFrame(frame: WireFrame): void {
  switch (frame.kind) {
    case 'run-started': {
      resetVizState(vizState);
      useRunStore.getState().reset();
      useRunStore.getState().started(frame.payload);
      useConnectionStore.setState((state) => ({
        badFrames: 0,
        events: appendEvent(state, 'info', `run ${frame.payload.runId} started`),
      }));
      break;
    }
    case 'tick': {
      const agents = new Map<string, VizAgent>();
      for (const d of frame.payload.deltas) {
        agents.set(d.id.toString(), {
          x: d.posX,
          y: d.posY,
          serving: (d.stateBits & MM1_STATE_SERVING) !== 0n,
        });
      }
      vizState.agents = agents;
      vizState.tickVersion += 1;
      break;
    }
    case 'counters': {
      vizState.busy = (frame.payload.values['busy'] ?? 0) >= 1;
      vizState.servers = Math.max(1, Math.round(frame.payload.values['servers'] ?? 1));
      vizState.downServers = Math.max(0, Math.round(frame.payload.values['down_servers'] ?? 0));
      vizState.queueLength = Math.max(0, Math.round(frame.payload.values['queue_length'] ?? 0));
      vizState.throughput = frame.payload.values['throughput'] ?? 0;
      vizState.meanWait = frame.payload.values['mean_wait'] ?? 0;
      vizState.blocks = parseBlockCounters(frame.payload.values);
      break;
    }
    case 'run-finished': {
      useRunStore.getState().finished(frame.payload);
      useConnectionStore.setState((state) => ({
        events: appendEvent(state, 'info', `run ${frame.payload.runId} finished`),
      }));
      break;
    }
  }
  useConnectionStore.setState({ seq: frame.seq, simTimeNs: frame.simTimeNs });
}

export const useConnectionStore = create<ConnectionStore>((set, get) => {
  const connectNow = (silent: boolean): void => {
    client?.disconnect();
    set({ conn: 'connecting' });
    client = new SimClient({
      onFrame: applyFrame,
      onBadFrame: (reason) =>
        set((state) => ({
          badFrames: state.badFrames + 1,
          error: reason,
          events: appendEvent(state, 'bad', reason),
        })),
      onText: (message) =>
        set((state) => {
          const compileEvents = parseCompileReply(message);
          if (compileEvents) {
            const continuation = pendingRunContinuation;
            pendingRunContinuation = null;
            if (continuation) continuation(compileEvents.ok);
            return { events: [...state.events, ...compileEvents.events] };
          }
          return {
            lastAck: message,
            events: appendEvent(state, 'ack', message),
          };
        }),
      onStateChange: (conn) => set({ conn }),
      onError: (message) =>
        set((state) => ({
          error: message,
          // Retries are silent: the gateway is expected to still be booting
          // on the first few attempts, and the console should not spam.
          events: silent ? state.events : appendEvent(state, 'error', message),
        })),
    });
    void resolveGatewayConfig().then(() => client?.connect(get().url));
  };
  return {
    url: DEFAULT_URL,
    conn: 'disconnected',
    seq: null,
    simTimeNs: null,
    fps: 0,
    lastAck: '',
    error: '',
    badFrames: 0,
    events: [],

    setUrl: (url) => set({ url }),
    setFps: (fps) => set({ fps }),
    connect: () => {
      stopAutoConnect();
      connectNow(false);
    },
    autoConnect: () => {
      stopAutoConnect();
      connectNow(false);
      // Keep retrying while the desktop gateway boots; stop once connected
      // (or after the budget is spent) so a dead endpoint does not spam.
      retryTimer = window.setInterval(() => {
        if (get().conn === 'connected') {
          stopAutoConnect();
          return;
        }
        retryCount += 1;
        if (retryCount > AUTO_CONNECT_MAX_RETRIES) {
          stopAutoConnect();
          return;
        }
        connectNow(true);
      }, AUTO_CONNECT_INTERVAL_MS);
    },
    disconnect: () => {
      stopAutoConnect();
      client?.disconnect();
      client = null;
      set({ conn: 'disconnected' });
    },
    start: (options) => {
      client?.start(options);
    },
    pause: () => {
      client?.pause();
    },
    resume: () => {
      client?.resume();
    },
    step: () => {
      client?.step();
    },
    stop: () => {
      client?.stop();
    },
    setSpeed: (speed) => {
      client?.setSpeed(speed);
    },
    compile: (source?: string) => {
      const compiled = source ?? generateDsl(useModelStore.getState().document);
      const sent = client?.compile(compiled) ?? false;
      if (!sent) {
        set((state) => ({ events: appendEvent(state, 'error', 'compile: not connected') }));
      }
    },
    runCanvasModel: () => {
      const source = generateDsl(useModelStore.getState().document);
      const sent = client?.compile(source) ?? false;
      if (!sent) {
        set((state) => ({ events: appendEvent(state, 'error', 'run canvas: not connected') }));
        return;
      }
      pendingRunContinuation = (ok) => {
        if (!ok) {
          return; // diagnostics already echoed to the console
        }
        const params = modelRunParams(useModelStore.getState().document);
        if (!params.ok) {
          set((state) => ({
            events: appendEvent(state, 'error', `run canvas: ${params.error ?? 'invalid model'}`),
          }));
          return;
        }
        const options = useRunStore.getState().runOptions;
        client?.start({
          seed: options.seed,
          seedMode: options.seedMode,
          reps: options.reps,
          replicationMode: options.replicationMode,
          minReps: options.minReps,
          maxReps: options.maxReps,
          errorPercent: options.errorPercent,
          precisionMetric: options.precisionMetric,
          arrivals: options.arrivals,
          warmup: options.warmup,
          confidence: options.confidence,
          speed: options.speed,
          lambda: params.lambda,
          mu: params.mu,
          servers: params.servers,
          failureRate: params.failureRate,
          repairRate: params.repairRate,
        });
      };
    },
  };
});
