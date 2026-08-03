// Pure wire-frame decoding for the LogicPilot browser visualization slice.
//
// Contract: schemas/wire.fbs (F2 freeze, ADR-0004). Every telemetry frame is a
// size-prefixed FlatBuffer with identifier "LPWR" and wire version 1:
//   FrameHeader{version, seq, sim_time_ns, kind} + FramePayload union.
//
// This module is intentionally DOM-free and side-effect free so the decode
// step can move to a Web Worker later without refactoring: it maps raw bytes
// to plain data objects (views) and nothing else.

import { ByteBuffer } from 'flatbuffers';
import {
  Counters,
  Frame,
  FramePayload,
  RunFinished,
  RunStarted,
  RunStatus,
  Tick,
} from '@logicpilot/protocol';

/** Wire protocol version this decoder accepts (schemas/wire.fbs v1). */
export const WIRE_VERSION = 1;

/** FlatBuffer file identifier carried by every telemetry frame. */
export const WIRE_IDENTIFIER = 'LPWR';

/** AgentDelta.flags bit 0: pos_x/pos_y valid. */
export const DELTA_FLAG_POSITION = 0x1;
/** AgentDelta.flags bit 1: state_bits valid. */
export const DELTA_FLAG_STATE = 0x2;

/** MM1 mapping: state_bits bit 0 marks the customer currently in service. */
export const MM1_STATE_SERVING = 1n;

export interface FrameHeaderView {
  /** Wire protocol version (always WIRE_VERSION for accepted frames). */
  version: number;
  /** Monotonic per-run frame sequence number. */
  seq: bigint;
  /** Simulated time of this frame in nanoseconds. */
  simTimeNs: bigint;
}

export interface AgentView {
  /** Stable agent id (customer ordinal for the MM1 mapping). */
  id: bigint;
  flags: number;
  posX: number;
  posY: number;
  stateBits: bigint;
}

export interface RunStartedView {
  runId: string;
  modelName: string;
  seed: bigint;
}

export interface TickView {
  simTimeNs: bigint;
  /** Agents currently in the system; ids are stable across ticks. */
  deltas: AgentView[];
}

export interface CountersView {
  /** Named counters (queue_length, busy, throughput, mean_wait, ...). */
  values: Record<string, number>;
}

export interface RunFinishedView {
  runId: string;
  status: RunStatus;
  statusName: string;
  error: string | null;
  /** Cross-replication stats (throughput.mean, Wq.ci_low, ...). */
  stats: Record<string, number>;
}

export type WireFrame =
  | (FrameHeaderView & { kind: 'run-started'; payload: RunStartedView })
  | (FrameHeaderView & { kind: 'tick'; payload: TickView })
  | (FrameHeaderView & { kind: 'counters'; payload: CountersView })
  | (FrameHeaderView & { kind: 'run-finished'; payload: RunFinishedView });

/** Human-readable name for a RunStatus enum value. */
export function runStatusName(status: RunStatus): string {
  switch (status) {
    case RunStatus.Completed:
      return 'Completed';
    case RunStatus.Failed:
      return 'Failed';
    case RunStatus.Cancelled:
      return 'Cancelled';
    default:
      return `Unknown(${status})`;
  }
}

/**
 * Check the "LPWR" file identifier on a size-prefixed frame. Layout of a
 * size-prefixed FlatBuffer: [size 4B][root offset 4B][identifier 4B][...],
 * so the identifier sits at bytes 8..11 (ByteBuffer.__has_identifier only
 * understands non-prefixed buffers, hence the manual check).
 */
export function hasWireIdentifier(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  for (let i = 0; i < WIRE_IDENTIFIER.length; i++) {
    if (bytes[8 + i] !== WIRE_IDENTIFIER.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Decode one size-prefixed LPWR telemetry frame into a plain-data view.
 *
 * Returns `null` when the buffer is not a valid v1 wire frame (bad
 * identifier, unknown version, or missing/unknown payload). Consumers must
 * treat `null` as a protocol violation and surface it, never crash.
 */
export function decodeWireFrame(bytes: Uint8Array): WireFrame | null {
  if (!hasWireIdentifier(bytes)) {
    return null;
  }
  const bb = new ByteBuffer(bytes);
  const frame = Frame.getSizePrefixedRootAsFrame(bb);

  const header = frame.header();
  const version = header ? header.version() : 0;
  if (version !== WIRE_VERSION) {
    return null;
  }
  const base: FrameHeaderView = {
    version,
    seq: header ? header.seq() : 0n,
    simTimeNs: header ? header.simTimeNs() : 0n,
  };

  switch (frame.payloadType()) {
    case FramePayload.RunStarted: {
      const p = frame.payload(new RunStarted()) as RunStarted | null;
      if (!p) return null;
      return {
        ...base,
        kind: 'run-started',
        payload: {
          runId: asString(p.runId()),
          modelName: asString(p.modelName()),
          seed: p.seed(),
        },
      };
    }
    case FramePayload.Tick: {
      const p = frame.payload(new Tick()) as Tick | null;
      if (!p) return null;
      const deltas: AgentView[] = [];
      for (let i = 0; i < p.deltasLength(); i++) {
        const d = p.deltas(i);
        if (!d) continue;
        deltas.push({
          id: d.id(),
          flags: d.flags(),
          posX: d.posX(),
          posY: d.posY(),
          stateBits: d.stateBits(),
        });
      }
      return {
        ...base,
        kind: 'tick',
        payload: { simTimeNs: p.simTimeNs(), deltas },
      };
    }
    case FramePayload.Counters: {
      const p = frame.payload(new Counters()) as Counters | null;
      if (!p) return null;
      const values: Record<string, number> = {};
      for (let i = 0; i < p.valuesLength(); i++) {
        const c = p.values(i);
        if (!c) continue;
        values[asString(c.name())] = c.value();
      }
      return { ...base, kind: 'counters', payload: { values } };
    }
    case FramePayload.RunFinished: {
      const p = frame.payload(new RunFinished()) as RunFinished | null;
      if (!p) return null;
      const stats: Record<string, number> = {};
      for (let i = 0; i < p.statsLength(); i++) {
        const c = p.stats(i);
        if (!c) continue;
        stats[asString(c.name())] = c.value();
      }
      const status = p.status();
      return {
        ...base,
        kind: 'run-finished',
        payload: {
          runId: asString(p.runId()),
          status,
          statusName: runStatusName(status),
          error: p.error() === null ? null : asString(p.error()),
          stats,
        },
      };
    }
    default:
      return null;
  }
}

/** Convenience: simulated time in fractional seconds. */
export function simTimeSeconds(simTimeNs: bigint): number {
  return Number(simTimeNs) / 1e9;
}

function asString(s: string | Uint8Array | null): string {
  if (s === null) return '';
  if (typeof s === 'string') return s;
  return decodeUtf8(s);
}

// Minimal UTF-8 decoder so this module stays free of DOM/Node globals
// (flatbuffers string accessors return strings at runtime; the byte path is
// only a defensive fallback).
function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++] ?? 0;
    let code: number;
    if (b0 < 0x80) {
      code = b0;
    } else if (b0 < 0xe0) {
      code = ((b0 & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    } else if (b0 < 0xf0) {
      code = ((b0 & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f);
    } else {
      code =
        ((b0 & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
    }
    out += String.fromCodePoint(code);
  }
  return out;
}
