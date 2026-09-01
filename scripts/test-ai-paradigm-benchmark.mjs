import assert from 'node:assert/strict';

import {
  PARADIGM_SCENARIOS,
  checksum,
  runParadigmTrial,
} from './benchmark-ai-paradigms.mjs';

const SOURCES = {
  process: `model M {
  resource R { capacity = 1 }
  source S { arrival = rate(0.8) }
  queue Q { capacity = 10 }
  service W { resource = R; time = exponential(1.0) }
  sink D { }
  couple S.out -> Q.in
  couple Q.out -> W.in
  couple W.out -> D.in
}
`,
  agent: `model M {
  agent Drone { count = 128 state active = true on_tick { flip active; bounce } }
}
`,
  statechart: `model M {
  statechart C {
    initial = Red
    state Red { } state Green { } state Yellow { }
    transition a { from = Red; to = Green; triggeredBy = timeout; timeout = 3.0 }
    transition b { from = Green; to = Yellow; triggeredBy = timeout; timeout = 3.0 }
    transition c { from = Yellow; to = Red; triggeredBy = timeout; timeout = 1.0 }
  }
}
`,
  continuous: `model M {
  continuous D {
    state S = 0.99 state I = 0.01 state R = 0.0
    param beta = 0.5 param gamma = 0.1
    d S/dt = -beta*S*I
    d I/dt = beta*S*I - gamma*I
    d R/dt = gamma*I
  }
}
`,
  devs: `model M {
  atomic Pulser { time_advance = constant(1.0) on_timeout { emit pulse } }
  atomic Sink { state seen = false time_advance = infinite on_input pulse { seen = true } }
  couple Pulser.pulse -> Sink.pulse
}
`,
};

for (const scenario of PARADIGM_SCENARIOS) {
  assert.equal(scenario.validate(SOURCES[scenario.paradigm]), true, scenario.id);
}

const scenario = PARADIGM_SCENARIOS.find((entry) => entry.paradigm === 'agent');
const responses = [
  {
    message: 'read source',
    done: false,
    toolCalls: [
      { id: 'read', name: 'read_workspace_file', arguments: { path: 'model/main.lp' } },
    ],
  },
  {
    message: 'apply source',
    done: false,
    toolCalls: [
      {
        id: 'patch',
        name: 'apply_source_patch',
        arguments: {
          path: 'model/main.lp',
          expectedChecksum: checksum('model Benchmark {\n}\n'),
          oldText: 'model Benchmark {\n}\n',
          newText: SOURCES.agent,
          summary: 'create agent model',
        },
      },
    ],
  },
  {
    message: 'compile',
    done: false,
    toolCalls: [{ id: 'compile', name: 'compile_model', arguments: {} }],
  },
  {
    message: 'run',
    done: false,
    toolCalls: [{ id: 'run', name: 'run_simulation', arguments: {} }],
  },
  { message: 'The agent model compiled and ran successfully.', done: true, toolCalls: [] },
];
let index = 0;
const result = await runParadigmTrial({
  scenario,
  runStep: async () => responses[index++],
});
assert.equal(result.passed, true);
assert.equal(result.score, result.maximumScore);
assert.deepEqual(result.toolNames, [
  'read_workspace_file',
  'apply_source_patch',
  'compile_model',
  'run_simulation',
]);

console.log('AI PARADIGM BENCHMARK TEST: PASS');
