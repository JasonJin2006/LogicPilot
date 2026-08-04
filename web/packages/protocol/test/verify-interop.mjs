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
if (!existsSync(join(binDir, 'model_file.bin')) ||
    !existsSync(join(binDir, 'model_v2.bin')) ||
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
  ModelFileV2,
  NodeV2,
  SemanticsRefV2,
  VarV2,
  VarTypeV2,
  PortDirectionV2,
  StatechartV2,
  TransitionV2,
  TriggerKindV2,
  BehaviorBindingV2,
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
// F3: the same model as the IR v2 contract (model_v2.bin, thin Node)
// ---------------------------------------------------------------------------
const v2Bytes = new Uint8Array(readFileSync(join(binDir, 'model_v2.bin')));
const v2Buf = new ByteBuffer(v2Bytes);
check('ModelFileV2 identifier', ModelFileV2.bufferHasIdentifier(v2Buf), true);
const mf2 = ModelFileV2.getRootAsModelFile(v2Buf);
check('ModelFileV2 schema_version', mf2.schemaVersion(), 2);
const root2 = mf2.root();
check('v2 root library', root2?.semantics()?.library(), 'core');
check('v2 root block', root2?.semantics()?.block(), 'model');
check('v2 root children', root2?.childrenLength(), 3);

// child 0: DEVS atomic Server (state + typed ports + Statechart)
const server2 = root2?.children(0);
check('v2 child[0] library', server2?.semantics()?.library(), 'devs');
check('v2 child[0] block', server2?.semantics()?.block(), 'atomic');
check('v2 child[0] name', server2?.metadata()?.name(), 'Server');
check('v2 Server state[0] name', server2?.state(0)?.name(), 'busy');
check('v2 Server state[0] type', server2?.state(0)?.type(), VarTypeV2.Bool);
check('v2 Server state[0] value', server2?.state(0)?.boolValue(), false);
check('v2 Server ports', server2?.portsLength(), 2);
check('v2 Server port[0]', server2?.ports(0)?.name(), 'job_in');
check('v2 Server port[0] dir', server2?.ports(0)?.direction(),
      PortDirectionV2.Input);
check('v2 Server port[1]', server2?.ports(1)?.name(), 'job_out');
check('v2 Server port[1] dir', server2?.ports(1)?.direction(),
      PortDirectionV2.Output);
const statechart2 = server2?.behavior();
check('v2 statechart initial', statechart2?.initial(), 'active');
check('v2 statechart states', statechart2?.statesLength(), 1);
check('v2 statechart transitions', statechart2?.transitionsLength(), 2);
check('v2 transition[0] trigger', statechart2?.transitions(0)?.trigger(),
      TriggerKindV2.Message);
check('v2 transition[0] port', statechart2?.transitions(0)?.messagePort(),
      'job_in');
check('v2 transition[1] trigger', statechart2?.transitions(1)?.trigger(),
      TriggerKindV2.Timeout);
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
