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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ByteBuffer } from 'flatbuffers';

import {
  ModelFile,
  ModelKind,
  ParamValue,
  DistributionKind,
  TimeAdvanceKind,
  PortDirection,
  ProcessNodeKind,
  QueueDiscipline,
  AtomicModel,
  CoupledModel,
  AgentModel,
  ProcessModel,
  SourceNode,
  QueueNode,
  ServiceNode,
  IntValue,
  FloatValue,
  BoolValue,
  Frame,
  FrameKind,
  FramePayload,
  Counters,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const binDir = process.argv[2] ?? join(root, 'build', 'interop', 'interop-out');

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
// F1: model_file.bin
// ---------------------------------------------------------------------------
const mfBytes = new Uint8Array(readFileSync(join(binDir, 'model_file.bin')));
const mfBuf = new ByteBuffer(mfBytes);
check('ModelFile identifier', ModelFile.bufferHasIdentifier(mfBuf), true);
const mf = ModelFile.getRootAsModelFile(mfBuf);

check('ModelFile.schema_version', mf.schemaVersion(), 1);
check('ModelFile.metadata.name', mf.metadata()?.name(), 'interop-demo');
check('ModelFile.metadata.version', mf.metadata()?.version(), '1.0.0');

check('ModelFile.params length', mf.paramsLength(), 2);
{
  const seed = mf.params(0);
  check('param[0].name', seed?.name(), 'seed');
  check('param[0].valueType', seed?.valueType(), ParamValue.IntValue);
  check('param[0].value', seed?.value(new IntValue())?.value(), 42);
  const horizon = mf.params(1);
  check('param[1].name', horizon?.name(), 'horizon');
  check('param[1].valueType', horizon?.valueType(), ParamValue.FloatValue);
  check('param[1].value', horizon?.value(new FloatValue())?.value(), 100.0);
}

const rootModel = mf.root();
check('root.kindType', rootModel?.kindType(), ModelKind.CoupledModel);
const coupled = rootModel?.kind(new CoupledModel());
check('coupled.name', coupled?.metadata()?.name(), 'QueueDemo');
check('coupled.children length', coupled?.childrenLength(), 3);

// child 0: DEVS atomic -------------------------------------------------------
{
  const child = coupled?.children(0);
  check('child[0].kindType', child?.kindType(), ModelKind.AtomicModel);
  const atomic = child?.kind(new AtomicModel());
  check('atomic.name', atomic?.metadata()?.name(), 'Server');
  check('atomic.state length', atomic?.stateLength(), 1);
  const busy = atomic?.state(0);
  check('atomic.state[0].name', busy?.name(), 'busy');
  check('atomic.state[0].value', busy?.value(new BoolValue())?.value(), false);
  check('atomic.ta.kind', atomic?.ta()?.kind(), TimeAdvanceKind.Distribution);
  const taDist = atomic?.ta()?.distribution();
  check('atomic.ta.distribution.kind', taDist?.kind(), DistributionKind.Exponential);
  check('atomic.ta.distribution.params[0]', taDist?.params(0), 3.0);
  check('atomic.delta_ext.trigger_port', atomic?.externalTransition()?.triggerPort(), 'job_in');
  check('atomic.delta_int.output_port', atomic?.internalTransition()?.outputPort(), 'job_out');
  check('atomic.input_ports length', atomic?.inputPortsLength(), 1);
  check('atomic.input_ports[0].name', atomic?.inputPorts(0)?.name(), 'job_in');
  check('atomic.input_ports[0].direction', atomic?.inputPorts(0)?.direction(), PortDirection.Input);
  check('atomic.output_ports[0].name', atomic?.outputPorts(0)?.name(), 'job_out');
}

// child 1: mm1-style process ---------------------------------------------------
{
  const child = coupled?.children(1);
  check('child[1].kindType', child?.kindType(), ModelKind.ProcessModel);
  const proc = child?.kind(new ProcessModel());
  check('process.name', proc?.metadata()?.name(), 'Arrivals');
  check('process.nodes length', proc?.nodesLength(), 4);
  check('process.couplings length', proc?.couplingsLength(), 3);

  const sourceNode = proc?.nodes(0);
  check('node[0].name', sourceNode?.name(), 'Clients');
  check('node[0].kindType', sourceNode?.kindType(), ProcessNodeKind.SourceNode);
  const source = sourceNode?.kind(new SourceNode());
  check('source.arrival.kind', source?.arrival()?.kind(), DistributionKind.Poisson);
  check('source.arrival.params[0]', source?.arrival()?.params(0), 2.0);
  check('source.max_arrivals', source?.maxArrivals(), -1);

  const queueNode = proc?.nodes(1);
  check('node[1].name', queueNode?.name(), 'WaitLine');
  const queue = queueNode?.kind(new QueueNode());
  check('queue.capacity', queue?.capacity(), 0);
  check('queue.discipline', queue?.discipline(), QueueDiscipline.Fifo);

  const serviceNode = proc?.nodes(2);
  check('node[2].name', serviceNode?.name(), 'Server');
  const service = serviceNode?.kind(new ServiceNode());
  check('service.time.kind', service?.serviceTime()?.kind(), DistributionKind.Exponential);
  check('service.time.params[0]', service?.serviceTime()?.params(0), 3.0);
  check('service.resource', service?.resource(), 'Server');
  check('service.servers', service?.servers(), 1);

  check('node[3].name', proc?.nodes(3)?.name(), 'Done');
  check('coupling[0]', [proc?.couplings(0)?.fromModel(), proc?.couplings(0)?.toModel()].join('->'), 'Clients->WaitLine');
  check('coupling[1]', [proc?.couplings(1)?.fromModel(), proc?.couplings(1)?.toModel()].join('->'), 'WaitLine->Server');
  check('coupling[2]', [proc?.couplings(2)?.fromModel(), proc?.couplings(2)?.toModel()].join('->'), 'Server->Done');
}

// child 2: ABM agent -----------------------------------------------------------
{
  const child = coupled?.children(2);
  check('child[2].kindType', child?.kindType(), ModelKind.AgentModel);
  const agent = child?.kind(new AgentModel());
  check('agent.name', agent?.metadata()?.name(), 'Observer');
  check('agent.components length', agent?.componentsLength(), 1);
  check('agent.components[0].name', agent?.components(0)?.name(), 'sensor');
  check('agent.components[0].type', agent?.components(0)?.componentType(), 'radius-sensor');
  check('agent.behaviors length', agent?.behaviorsLength(), 1);
  check('agent.behaviors[0].name', agent?.behaviors(0)?.name(), 'collect');
  check('agent.behaviors[0].trigger', agent?.behaviors(0)?.trigger(), 'on_tick');
  check('agent.state_machine.name', agent?.stateMachine()?.name(), 'ObserverFSM');
  check('agent.state_machine.initial', agent?.stateMachine()?.initialState(), 'idle');
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
console.log('');
if (failures > 0) {
  console.error(`[verify-interop] ${failures}/${checks} checks FAILED`);
  process.exit(1);
}
console.log(`[verify-interop] all ${checks} checks passed (C++ -> FlatBuffers -> TS)`);
