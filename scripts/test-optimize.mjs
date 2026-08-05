// Regression test for the optimizer + NL optimization path:
// template substitution, metric parsing, grid search via lpcli (monotonic
// Wq), deterministic GA on a synthetic objective, and aiOptimize end-to-end.
import assert from 'node:assert/strict';

import { aiOptimize } from './ai-optimize.mjs';
import { optimize, parseMetric, substitute } from './optimize.mjs';

const flag = process.argv.indexOf('--lpcli');
if (flag >= 0 && process.argv[flag + 1]) {
  process.env.LPCLI = process.argv[flag + 1];
}

const MM_TEMPLATE = `model Opt {
  resource Server {
    capacity = {{servers}}
  }
  source Arrivals {
    arrival = poisson(0.8)
  }
  queue WaitLine {
    capacity = 1000000
  }
  service Handle {
    resource = Server
    time = exponential(1.0)
  }
  sink Done { }
  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in
}
`;

// 1. Template substitution.
assert.equal(substitute('capacity = {{servers}}', 'servers', 3),
             'capacity = 3');

// 2. lpcli run summary metric parsing.
{
  const sample = `summary: 3 replications, 95% CI
  throughput   mean=0.7986 std=0.0057 CI=[0.7844, 0.8129]
  W            mean=4.7105 std=1.1106 CI=[1.9515, 7.4695]
  Wq           mean=3.7145 std=1.0842 CI=[1.0210, 6.4079]`;
  assert.ok(Math.abs(parseMetric(sample, 'throughput') - 0.7986) < 1e-9);
  assert.ok(Math.abs(parseMetric(sample, 'Wq') - 3.7145) < 1e-9);
}

// 3. Grid search via lpcli: more servers strictly cut Wq (M/M/c), so the
// minimum over 1..4 must land on 4.
{
  const result = await optimize({
    template: MM_TEMPLATE,
    variable: 'servers',
    min: 1,
    max: 4,
    objective: 'minimize',
    metric: 'Wq',
    strategy: 'grid',
    reps: 3,
    arrivals: 5000,
    warmup: 500,
  });
  assert.equal(result.best.value, 4);
  assert.equal(result.strategy, 'grid');
  assert.equal(result.evaluations.length, 4);
}

// 4. Deterministic GA on a synthetic objective (injected evaluate).
{
  const fitness = async (x) => 100 - (x - 7) ** 2;
  const result = await optimize({
    template: '',
    variable: 'x',
    min: 1,
    max: 30,  // range > budget forces the GA path
    objective: 'maximize',
    metric: 'fitness',
    strategy: 'ga',
    budget: 20,
    seed: 42,
    evaluate: fitness,
  });
  assert.equal(result.strategy, 'ga');
  assert.ok(result.evaluations.length <= 20);
  assert.ok(Math.abs(result.best.value - 7) <= 2);
}

// 5. NL optimization end-to-end.
{
  const result = await aiOptimize({
    prompt:
        'minimize Wq over servers 1..4 for an M/M/1 queue with arrival 0.8 ' +
        'and service 1.0',
  });
  assert.equal(result.kind, 'optimize');
  assert.equal(result.variable, 'servers');
  assert.equal(result.objective, 'minimize');
  assert.equal(result.metric, 'Wq');
  assert.equal(result.best.value, 4);
  assert.match(result.dslTemplate, /\{\{servers\}\}/);
  // The search spec must have come from the model's declared experiment.
  assert.equal(result.declaredByModel, true);
}

console.log('OPTIMIZE TEST: PASS');
