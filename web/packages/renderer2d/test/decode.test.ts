// Decode-path unit tests: build wire frames with the flatbuffers Builder
// (same construction order the C++ gateway uses) and assert the pure
// decoder returns the expected plain-data views.

import { Builder } from 'flatbuffers';
import {
  AgentDelta,
  Counter,
  Counters,
  Frame,
  FrameHeader,
  FrameKind,
  FramePayload,
  RunFinished,
  RunStatus,
  Tick,
} from '@logicpilot/protocol';
import { describe, expect, it } from 'vitest';

import { decodeWireFrame, runStatusName, simTimeSeconds } from '../src/decode.js';

function buildCountersFrame(
  seq: bigint,
  simTimeNs: bigint,
  entries: Array<[string, number]>,
): Uint8Array {
  const builder = new Builder(1024);
  const counterOffsets = entries.map(([name, value]) =>
    Counter.createCounter(builder, builder.createString(name), value),
  );
  const valuesOffset = Counters.createValuesVector(builder, counterOffsets);
  const countersOffset = Counters.createCounters(builder, valuesOffset);
  const headerOffset = FrameHeader.createFrameHeader(
    builder,
    1,
    seq,
    simTimeNs,
    FrameKind.Counters,
  );
  const frameOffset = Frame.createFrame(
    builder,
    headerOffset,
    FramePayload.Counters,
    countersOffset,
  );
  Frame.finishSizePrefixedFrameBuffer(builder, frameOffset);
  return builder.asUint8Array();
}

function buildTickFrame(seq: bigint, simTimeNs: bigint): Uint8Array {
  const builder = new Builder(1024);
  const deltas = [
    // Customer in service at the origin (state_bits bit 0 = 1).
    AgentDelta.createAgentDelta(builder, 7n, 0x3, 0, 0, 1n, 0, false),
    // First waiting customer in the queue.
    AgentDelta.createAgentDelta(builder, 12n, 0x3, 1, 0, 0n, 0, false),
  ];
  const deltasOffset = Tick.createDeltasVector(builder, deltas);
  const tickOffset = Tick.createTick(builder, simTimeNs, deltasOffset);
  const headerOffset = FrameHeader.createFrameHeader(builder, 1, seq, simTimeNs, FrameKind.Tick);
  const frameOffset = Frame.createFrame(builder, headerOffset, FramePayload.Tick, tickOffset);
  Frame.finishSizePrefixedFrameBuffer(builder, frameOffset);
  return builder.asUint8Array();
}

function buildRunFinishedFrame(seq: bigint): Uint8Array {
  const builder = new Builder(1024);
  const stats = [
    Counter.createCounter(builder, builder.createString('Wq.mean'), 4.03),
    Counter.createCounter(builder, builder.createString('throughput.mean'), 0.799),
  ];
  const statsOffset = RunFinished.createStatsVector(builder, stats);
  const payloadOffset = RunFinished.createRunFinished(
    builder,
    builder.createString('run-1'),
    RunStatus.Completed,
    0,
    statsOffset,
  );
  const headerOffset = FrameHeader.createFrameHeader(builder, 1, seq, 0n, FrameKind.RunFinished);
  const frameOffset = Frame.createFrame(
    builder,
    headerOffset,
    FramePayload.RunFinished,
    payloadOffset,
  );
  Frame.finishSizePrefixedFrameBuffer(builder, frameOffset);
  return builder.asUint8Array();
}

describe('decodeWireFrame', () => {
  it('decodes a Counters frame into named values', () => {
    const bytes = buildCountersFrame(42n, 1_500_000_000n, [
      ['queue_length', 3],
      ['busy', 1],
      ['throughput', 0.8],
      ['mean_wait', 4.1],
    ]);
    const frame = decodeWireFrame(bytes);
    expect(frame).not.toBeNull();
    if (!frame) return;
    expect(frame.kind).toBe('counters');
    expect(frame.version).toBe(1);
    expect(frame.seq).toBe(42n);
    expect(frame.simTimeNs).toBe(1_500_000_000n);
    if (frame.kind !== 'counters') return;
    expect(frame.payload.values['queue_length']).toBe(3);
    expect(frame.payload.values['busy']).toBe(1);
    expect(frame.payload.values['throughput']).toBeCloseTo(0.8);
    expect(frame.payload.values['mean_wait']).toBeCloseTo(4.1);
    expect(simTimeSeconds(frame.simTimeNs)).toBeCloseTo(1.5);
  });

  it('decodes a Tick frame with stable agent ids and MM1 positions', () => {
    const frame = decodeWireFrame(buildTickFrame(7n, 2_000_000_000n));
    expect(frame).not.toBeNull();
    if (!frame || frame.kind !== 'tick') throw new Error('expected tick frame');
    expect(frame.payload.deltas).toHaveLength(2);
    const serving = frame.payload.deltas[0];
    const waiting = frame.payload.deltas[1];
    expect(serving?.id).toBe(7n);
    expect(serving?.posX).toBe(0);
    expect(serving?.stateBits & 1n).toBe(1n);
    expect(waiting?.id).toBe(12n);
    expect(waiting?.posX).toBe(1);
    expect(waiting?.stateBits).toBe(0n);
  });

  it('decodes a RunFinished frame with stats and status', () => {
    const frame = decodeWireFrame(buildRunFinishedFrame(99n));
    expect(frame).not.toBeNull();
    if (!frame || frame.kind !== 'run-finished') {
      throw new Error('expected run-finished frame');
    }
    expect(frame.payload.runId).toBe('run-1');
    expect(frame.payload.statusName).toBe('Completed');
    expect(frame.payload.stats['Wq.mean']).toBeCloseTo(4.03);
    expect(frame.payload.stats['throughput.mean']).toBeCloseTo(0.799);
    expect(runStatusName(RunStatus.Cancelled)).toBe('Cancelled');
  });

  it('rejects frames without the LPWR identifier', () => {
    const bytes = buildCountersFrame(1n, 0n, [['queue_length', 0]]);
    // Size-prefixed layout: [size 4B][root offset 4B][identifier 4B][...].
    // Corrupt the identifier at bytes 8..11.
    bytes[8] = 0x58; // 'X'
    bytes[9] = 0x58;
    bytes[10] = 0x58;
    bytes[11] = 0x58;
    expect(decodeWireFrame(bytes)).toBeNull();
  });

  it('rejects frames with an unknown wire version', () => {
    const builder = new Builder(256);
    const valuesOffset = Counters.createValuesVector(builder, []);
    const countersOffset = Counters.createCounters(builder, valuesOffset);
    const headerOffset = FrameHeader.createFrameHeader(
      builder,
      99, // not v1
      1n,
      0n,
      FrameKind.Counters,
    );
    const frameOffset = Frame.createFrame(
      builder,
      headerOffset,
      FramePayload.Counters,
      countersOffset,
    );
    Frame.finishSizePrefixedFrameBuffer(builder, frameOffset);
    expect(decodeWireFrame(builder.asUint8Array())).toBeNull();
  });
});
