// Connection + run-control store: owns the SimClient lifecycle and applies
// incoming telemetry frames to the shared viz state and the run store.
// Components read their slices with zustand selectors, so 10 Hz telemetry
// re-renders only the subscribers that actually display it.

import { create } from 'zustand';
import { MM1_STATE_SERVING, simTimeSeconds, type WireFrame } from '@logicpilot/renderer2d';
import { SimClient, type ConnState, type StartOptions } from '../client/simClient';
import { resetVizState, vizState, type VizAgent } from './vizState';
import { useRunStore } from './runStore';

const DEFAULT_URL = 'ws://127.0.0.1:8089/sim';

export interface LogEvent {
  id: number;
  time: string;
  kind: 'ack' | 'error' | 'bad' | 'info';
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
}

let client: SimClient | null = null;
let nextEventId = 1;

const MAX_EVENTS = 200;

function appendEvent(state: ConnectionStore, kind: LogEvent['kind'], text: string): LogEvent[] {
  const event: LogEvent = {
    id: nextEventId++,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    kind,
    text,
  };
  const events = [...state.events, event];
  return events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
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
        set((state) => ({
          lastAck: message,
          events: appendEvent(state, 'ack', message),
        })),
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
}));
