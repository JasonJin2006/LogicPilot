// Connection + run-control store: owns the SimClient lifecycle and applies
// incoming telemetry frames to the shared viz state and the run store.
// Components read their slices with zustand selectors, so 10 Hz telemetry
// re-renders only the subscribers that actually display it.

import { create } from 'zustand';
import { MM1_STATE_SERVING, simTimeSeconds, type WireFrame } from '@logicpilot/renderer2d';
import { generateDsl, modelRunParams } from '@logicpilot/editor';
import { SimClient, type ConnState, type StartOptions } from '../client/simClient';
import { resetVizState, vizState, type VizAgent } from './vizState';
import { useModelStore } from './modelStore';
import { useRunStore } from './runStore';

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
  connect: () => void;
  disconnect: () => void;
  start: (options: StartOptions) => void;
  pause: () => void;
  resume: () => void;
  step: () => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
  compile: () => void;
  runCanvasModel: () => void;
}

let client: SimClient | null = null;
let nextEventId = 1;
// Continuation invoked when the next compile reply arrives (Run = compile,
// then start when the model compiles).
let pendingRunContinuation: ((ok: boolean) => void) | null = null;

const MAX_EVENTS = 200;

function makeEvent(kind: LogEvent['kind'], text: string): LogEvent {
  return {
    id: nextEventId++,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    kind,
    text,
  };
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
      useRunStore.getState().pushCharts(simTimeSeconds(frame.simTimeNs), frame.payload.values);
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

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
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
          events: appendEvent(state, 'error', message),
        })),
    });
    client.connect(get().url);
  },
  disconnect: () => {
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
  compile: () => {
    const source = generateDsl(useModelStore.getState().document);
    const sent = client?.compile(source) ?? false;
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
        reps: options.reps,
        arrivals: options.arrivals,
        warmup: options.warmup,
        speed: options.speed,
        lambda: params.lambda,
        mu: params.mu,
        servers: params.servers,
        failureRate: params.failureRate,
        repairRate: params.repairRate,
      });
    };
  },
}));
