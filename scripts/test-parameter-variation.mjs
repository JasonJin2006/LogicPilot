import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  axisValues,
  cartesianPoints,
  runParameterVariation,
} from './parameter-variation.mjs';

const flag = process.argv.indexOf('--lpcli');
const lpcliPath = flag >= 0 ? process.argv[flag + 1] : undefined;

assert.deepEqual(axisValues({ name: 'x', min: 0.1, max: 0.3, step: 0.1 }),
  [0.1, 0.2, 0.3]);
assert.deepEqual(cartesianPoints([
  { name: 'x', variable: 'x', min: 1, max: 2, step: 1 },
  { name: 'y', variable: 'y', min: 10, max: 20, step: 10 },
]), [{ x: 1, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 10 }, { x: 2, y: 20 }]);

const dsl = readFileSync(new URL('../examples/des-parameter-variation.lp', import.meta.url),
  'utf8');
const result = await runParameterVariation({
  dsl, experimentName: 'CapacityStudy', lpcliPath,
  arrivals: 300, warmup: 30, concurrency: 2,
});
assert.equal(result.pointCount, 4);
assert.deepEqual(result.iterations.map((entry) => entry.parameters), [
  { arrival_rate: 0.6, server_count: 1 },
  { arrival_rate: 0.6, server_count: 2 },
  { arrival_rate: 0.8, server_count: 1 },
  { arrival_rate: 0.8, server_count: 2 },
]);
for (const iteration of result.iterations) {
  assert.equal(iteration.run.actualReps, 2);
  assert.equal(iteration.metrics.replications.length, 2);
  assert.deepEqual(
    iteration.metrics.replications.map((rep) => rep.seed),
    result.iterations[0].metrics.replications.map((rep) => rep.seed),
    'fixed-seed points must use common random numbers');
}
for (const arrival of [0.6, 0.8]) {
  const one = result.iterations.find((entry) =>
    entry.parameters.arrival_rate === arrival && entry.parameters.server_count === 1);
  const two = result.iterations.find((entry) =>
    entry.parameters.arrival_rate === arrival && entry.parameters.server_count === 2);
  assert.ok(two.metrics.summary.Wq.mean < one.metrics.summary.Wq.mean);
}

console.log('PARAMETER-VARIATION TEST: PASS');
