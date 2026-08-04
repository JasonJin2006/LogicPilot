#!/usr/bin/env node
// Node/TS side of the F1/F2 schema interop test.
//
// Reads the buffers produced by the C++ schema_interop_writer
// (scripts/interop) and asserts every key field matches the values written
// by the C++ side. Run via the one-click driver:
//
//   pwsh scripts/run-schema-interop.ps1
//
// or manually:
//
//   node web/packages/protocol/test/verify-interop.mjs [bin-dir]
//
// Default bin dir: build/interop/interop-out.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// test/ -> protocol -> packages -> web -> repo root.
const root = join(here, '..', '..', '..', '..');
const binDir = process.argv[2] ?? join(root, 'build', 'interop', 'interop-out');

// The buffers are produced by the C++ schema_interop_writer
// (scripts/run-schema-interop.ps1). Without them there is nothing to verify;
// skip loudly so `pnpm test` stays usable in toolchain-less jobs, while the
// kernel CI job's "Schema interop" step enforces the real check.
if (!existsSync(join(binDir, 'model_v2.bin')) ||
    !existsSync(join(binDir, 'counters_frame.bin'))) {
  console.warn(
    `[verify-interop] SKIP: C++ interop artifacts not found in ${binDir}. ` +
      'Run pwsh scripts/run-schema-interop.ps1 first.',
  );
  process.exit(0);
}

const { ByteBuffer } = await import('flatbuffers');
const {
  ModelFile,
  Node,
  SemanticsRef,
  Var,
  VarType,
  PortDirection,
  Statechart,
  Transition,
  TriggerKind,
  BehaviorBinding,
  Frame,
  FrameKind,
  FramePayload,
  Counters,
} = await import('../dist/index.js');

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  // flatbuffers reads 64-bit fields as BigInt; normalize for comparison.
  const a = typeof actual === 'bigint' ? Number(actual) : actual;
  const e = typeof expected === 'bigint' ? Number(expected) : expected;
  const ok =
    typeof e === 'number' && typeof a === 'number'
      ? Math.abs(a - e) < 1e-9
      : a === e;
  const fmt = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${label}: expected ${fmt(e)}, got ${fmt(a)}`);
  } else {
    console.log(`ok   ${label} = ${fmt(a)}`);
  }
}

// ---------------------------------------------------------------------------
// F2: counters_frame.bin
// ---------------------------------------------------------------------------
const frameBytes = new Uint8Array(readFileSync(join(binDir, 'counters_frame.bin')));
const frameBuf = new ByteBuffer(frameBytes);
check('Frame identifier', Frame.bufferHasIdentifier(frameBuf), true);
const frame = Frame.getRootAsFrame(frameBuf);

check('frame.header.version', frame.header()?.version(), 1);
check('frame.header.seq', frame.header()?.seq(), 7);
check('frame.header.sim_time_ns', frame.header()?.simTimeNs(), 1500000000);
check('frame.header.kind', frame.header()?.kind(), FrameKind.Counters);
check('frame.payloadType', frame.payloadType(), FramePayload.Counters);

const counters = frame.payload(new Counters());
check('counters length', counters?.valuesLength(), 4);
{
  const expected = {
    arrival_rate: 2.0,
    service_rate: 3.0,
    utilization: 2.0 / 3.0,
    entities_served: 1234.0,
  };
  for (let i = 0; i < (counters?.valuesLength() ?? 0); i += 1) {
    const c = counters?.values(i);
    const name = c?.name();
    check(`counters[${name}]`, c?.value(), expected[name]);
  }
}

// ---------------------------------------------------------------------------
// F1: the model as the IR v2 contract (model_v2.bin, thin Node)
// ---------------------------------------------------------------------------
const v2Bytes = new Uint8Array(readFileSync(join(binDir, 'model_v2.bin')));
const v2Buf = new ByteBuffer(v2Bytes);
check('ModelFile identifier', ModelFile.bufferHasIdentifier(v2Buf), true);
const mf = ModelFile.getRootAsModelFile(v2Buf);
check('ModelFile schema_version', mf.schemaVersion(), 2);
const root2 = mf.root();
check('v2 root library', root2?.semantics()?.library(), 'core');
check('v2 root block', root2?.semantics()?.block(), 'model');
check('v2 root children', root2?.childrenLength(), 3);

// child 0: DEVS atomic Server (state + typed ports + Statechart)
const server2 = root2?.children(0);
check('v2 child[0] library', server2?.semantics()?.library(), 'devs');
check('v2 child[0] block', server2?.semantics()?.block(), 'atomic');
check('v2 child[0] name', server2?.metadata()?.name(), 'Server');
check('v2 Server state[0] name', server2?.state(0)?.name(), 'busy');
check('v2 Server state[0] type', server2?.state(0)?.type(), VarType.Bool);
check('v2 Server state[0] value', server2?.state(0)?.boolValue(), false);
check('v2 Server ports', server2?.portsLength(), 2);
check('v2 Server port[0]', server2?.ports(0)?.name(), 'job_in');
check('v2 Server port[0] dir', server2?.ports(0)?.direction(),
      PortDirection.Input);
check('v2 Server port[1]', server2?.ports(1)?.name(), 'job_out');
check('v2 Server port[1] dir', server2?.ports(1)?.direction(),
      PortDirection.Output);
const statechart2 = server2?.behavior();
check('v2 statechart initial', statechart2?.initial(), 'active');
check('v2 statechart states', statechart2?.statesLength(), 1);
check('v2 statechart transitions', statechart2?.transitionsLength(), 2);
check('v2 transition[0] trigger', statechart2?.transitions(0)?.trigger(),
      TriggerKind.Message);
check('v2 transition[0] port', statechart2?.transitions(0)?.messagePort(),
      'job_in');
check('v2 transition[1] trigger', statechart2?.transitions(1)?.trigger(),
      TriggerKind.Timeout);
check('v2 transition[1] ta kind',
      statechart2?.transitions(1)?.timeoutDistribution()?.kind(), 3);
check('v2 transition[1] ta rate',
      statechart2?.transitions(1)?.timeoutDistribution()?.params(0), 3.0);

// child 1: process flow (source/queue/service blocks + couplings)
const flow2 = root2?.children(1);
check('v2 child[1] library', flow2?.semantics()?.library(), 'process');
check('v2 child[1] block', flow2?.semantics()?.block(), 'flow');
check('v2 child[1] name', flow2?.metadata()?.name(), 'Arrivals');
check('v2 flow children', flow2?.childrenLength(), 3);
check('v2 flow source block', flow2?.children(0)?.semantics()?.block(),
      'source');
check('v2 flow source name', flow2?.children(0)?.metadata()?.name(),
      'Clients');
check('v2 source arrival kind',
      flow2?.children(0)?.params(0)?.distribution()?.kind(), 4);
check('v2 source arrival rate',
      flow2?.children(0)?.params(0)?.distribution()?.params(0), 2.0);
check('v2 flow queue block', flow2?.children(1)?.semantics()?.block(),
      'queue');
check('v2 queue capacity', flow2?.children(1)?.params(0)?.intValue(), 0);
check('v2 flow service block', flow2?.children(2)?.semantics()?.block(),
      'service');
check('v2 service rate kind',
      flow2?.children(2)?.params(0)?.distribution()?.kind(), 3);
check('v2 service resource', flow2?.children(2)?.params(1)?.stringValue(),
      'Server');
check('v2 service servers', flow2?.children(2)?.params(2)?.intValue(), 1);
check('v2 flow couplings', flow2?.couplingsLength(), 2);
check('v2 coupling[0]',
      [flow2?.couplings(0)?.fromModel(), flow2?.couplings(0)?.toModel()]
          .join('->'),
      'Clients->WaitLine');
check('v2 coupling[1]',
      [flow2?.couplings(1)?.fromModel(), flow2?.couplings(1)?.toModel()]
          .join('->'),
      'WaitLine->Server');

// child 2: ABM agent (behavior bindings)
const agent2 = root2?.children(2);
check('v2 child[2] library', agent2?.semantics()?.library(), 'agent');
check('v2 child[2] block', agent2?.semantics()?.block(), 'agent');
check('v2 child[2] name', agent2?.metadata()?.name(), 'Observer');
check('v2 agent behaviors', agent2?.behaviorsLength(), 1);
check('v2 behavior trigger', agent2?.behaviors(0)?.trigger(), 'on_tick');
check('v2 behavior handler', agent2?.behaviors(0)?.handlerRef(),
      'agent.observer.collect');

// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`[verify-interop] ${failures}/${checks} checks FAILED`);
  process.exit(1);
}
console.log(`[verify-interop] all ${checks} checks passed (C++ -> FlatBuffers -> TS)`);
