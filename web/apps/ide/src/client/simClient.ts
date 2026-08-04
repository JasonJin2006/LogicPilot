// WebSocket transport for the lp-server gateway (ws://host:port/sim).
//
// Control messages are JSON text frames; telemetry is size-prefixed LPWR
// FlatBuffer binary frames decoded via the pure @logicpilot/renderer2d path.

import { decodeWireFrame, type WireFrame } from '@logicpilot/renderer2d';

export type ConnState = 'disconnected' | 'connecting' | 'connected';

export interface SimClientEvents {
  /** A successfully decoded telemetry frame. */
  onFrame: (frame: WireFrame) => void;
  /** Binary frame that failed identifier/version validation. */
  onBadFrame: (reason: string) => void;
  /** JSON control ack / error text from the gateway. */
  onText: (message: string) => void;
  onStateChange: (state: ConnState) => void;
  onError: (message: string) => void;
}

export interface StartOptions {
  seed?: number;
  reps?: number;
  arrivals?: number;
  warmup?: number;
  speed?: number;
  // Per-run model parameter overrides (canvas model -> M/M/1 driver).
  lambda?: number;
  mu?: number;
  servers?: number;
  failureRate?: number;
  repairRate?: number;
}

export class SimClient {
  private ws: WebSocket | null = null;
  private state: ConnState = 'disconnected';

  constructor(private readonly events: SimClientEvents) {}

  getState(): ConnState {
    return this.state;
  }

  connect(url: string): void {
    if (this.ws) {
      this.disconnect();
    }
    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.setState('disconnected');
      this.events.onError(`invalid URL: ${String(err)}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.setState('connected');
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.setState('disconnected');
      }
    };
    ws.onerror = () => {
      this.events.onError(`websocket error (${url})`);
    };
    ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);
    this.ws = ws;
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    this.setState('disconnected');
  }

  /** Send a JSON control frame; returns false when not connected. */
  sendControl(cmd: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.events.onError('not connected');
      return false;
    }
    this.ws.send(JSON.stringify(cmd));
    return true;
  }

  start(options: StartOptions): boolean {
    const cmd: Record<string, unknown> = { cmd: 'start' };
    for (const key of [
      'seed',
      'reps',
      'arrivals',
      'warmup',
      'speed',
      'lambda',
      'mu',
      'servers',
      'failureRate',
      'repairRate',
    ] as const) {
      const value = options[key];
      if (value !== undefined && Number.isFinite(value)) {
        cmd[key === 'failureRate' ? 'failure_rate' : key] = value;
      }
    }
    return this.sendControl(cmd);
  }

  pause(): boolean {
    return this.sendControl({ cmd: 'pause' });
  }

  resume(): boolean {
    return this.sendControl({ cmd: 'resume' });
  }

  step(): boolean {
    return this.sendControl({ cmd: 'step' });
  }

  stop(): boolean {
    return this.sendControl({ cmd: 'stop' });
  }

  setSpeed(speed: number): boolean {
    return this.sendControl({ cmd: 'speed', speed });
  }

  /** Ask the gateway to compile DSL source; the reply carries the
   *  diagnostics document. Source is base64-encoded so quotes/newlines
   *  survive the flat control-plane JSON parser. */
  compile(source: string): boolean {
    const bytes = new TextEncoder().encode(source);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return this.sendControl({ cmd: 'compile', source_b64: btoa(binary) });
  }

  private handleMessage(data: unknown): void {
    if (typeof data === 'string') {
      this.events.onText(data);
      return;
    }
    if (data instanceof ArrayBuffer) {
      const frame = decodeWireFrame(new Uint8Array(data));
      if (frame === null) {
        this.events.onBadFrame(`undecodable binary frame (${data.byteLength} bytes)`);
        return;
      }
      this.events.onFrame(frame);
      return;
    }
    this.events.onBadFrame('unexpected message payload type');
  }

  private setState(state: ConnState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange(state);
  }
}
