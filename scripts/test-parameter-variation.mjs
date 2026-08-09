import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  axisValues,
  cartesianPoints,
  runParameterVariation,
  sampleMonteCarlo,
} from './parameter-variation.mjs';

const flag = process.argv.indexOf('--lpcli');
const lpcliPath = flag >= 0 ? process.argv[flag + 1] : undefined;

assert.deepEqual(axisValues({ name: 'x', min: 0.1, max: 0.3, step: 0.1 }),
  [0.1, 0.2, 0.3]);
assert.deepEqual(cartesianPoints([
  { name: 'x', variable: 'x', min: 1, max: 2, step: 1 },
  { name: 'y', variable: 'y', min: 10, max: 20, step: 10 },
]), [{ x: 1, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 10 }, { x: 2, y: 20 }]);

// Freeform value sets: an explicit list replaces the range/step expansion.
assert.deepEqual(axisValues({ name: 'mode', values: [1, 5, 9] }), [1, 5, 9]);

// Monte Carlo sampling is seeded and deterministic, and stays in range.
const sampled = sampleMonteCarlo(
  [{ name: 'x', variable: 'x', min: 0, max: 1, step: 0.1 }],
  4,
  7,
);
assert.equal(sampled.length, 4);
assert.deepEqual(sampleMonteCarlo(
  [{ name: 'x', variable: 'x', min: 0, max: 1, step: 0.1 }], 4, 7), sampled);
for (const point of sampled) {
  assert.ok(point.x >= 0 && point.x <= 1);
  assert.equal(point.x * 10, Math.round(point.x * 10), 'sampled values snap to the step');
}
assert.notDeepEqual(
  sampleMonteCarlo([{ name: 'x', variable: 'x', min: 0, max: 1, step: 0.1 }], 4, 8),
  sampled,
);

// Freeform value sets work in Monte Carlo mode too (with validation).
const freeform = sampleMonteCarlo([{ name: 'mode', variable: 'mode', values: [2, 4, 8] }], 8, 3);
assert.equal(freeform.length, 8);
for (const point of freeform) {
  assert.ok([2, 4, 8].includes(point.mode));
}
assert.deepEqual(
  sampleMonteCarlo([{ name: 'mode', variable: 'mode', values: [2, 4, 8] }], 8, 3),
  freeform,
  'freeform sampling is seeded and reproducible');

// Shared axis validation: grid and Monte Carlo reject the same bad shapes
// with understandable messages instead of TypeError/undefined crashes.
const expectAxisError = (axis, pattern) => {
  assert.throws(() => axisValues(axis), pattern);
  assert.throws(() => sampleMonteCarlo([axis], 1, 1), pattern);
  assert.throws(() => cartesianPoints([axis]), pattern);
};
expectAxisError({ name: 'x', variable: 'x', values: [] }, /values must be a non-empty/);
expectAxisError({ name: 'x', variable: 'x', values: [1, 'two'] }, /values must be a non-empty/);
expectAxisError({ name: 'x', variable: 'x', values: [1, Number.NaN] }, /values must be a non-empty/);
expectAxisError({ name: 'x', variable: 'x', values: [1, Infinity] }, /values must be a non-empty/);
// Value expansion itself does not need the variable, but point generation
// (grid + Monte Carlo) does.
assert.deepEqual(axisValues({ name: 'x', values: [1, 2] }), [1, 2]);
assert.throws(() => sampleMonteCarlo([{ name: 'x', values: [1, 2] }], 1, 1), /missing its variable/);
assert.throws(() => cartesianPoints([{ name: 'x', values: [1, 2] }]), /missing its variable/);
expectAxisError({ name: 'x', variable: '', min: 0, max: 1 }, /variable must be a valid identifier/);
expectAxisError({ name: 'x', variable: 'x', min: 2, max: 1 }, /min <= max/);
expectAxisError({ name: 'x', variable: 'x', min: Number.NaN, max: 1 }, /finite min <= max/);
expectAxisError({ name: 'x', variable: 'x', min: 0, max: 1, step: -1 }, /step must be a positive/);
expectAxisError({ name: 'x', variable: 'x', min: 0, max: 1, step: Infinity }, /step must be a positive/);
expectAxisError(null, /each axis must be an object/);
assert.throws(() => sampleMonteCarlo('not-an-array', 1, 1), /axes must be a list/);
assert.throws(() => cartesianPoints({}), /axes must be a list/);

// Seed semantics: the 32-bit sampler state rejects out-of-range seeds
// instead of silently truncating (seed 2^32 and 2^33 would collide).
assert.throws(() => sampleMonteCarlo([{ variable: 'x', min: 0, max: 1 }], 1, 0x100000000),
  /seed must be an integer in \[0, 4294967295\]/);
assert.throws(() => sampleMonteCarlo([{ variable: 'x', min: 0, max: 1 }], 1, -1),
  /seed must be an integer in \[0, 4294967295\]/);
assert.equal(sampleMonteCarlo([{ variable: 'x', min: 0, max: 1 }], 2, 0xFFFFFFFF).length, 2);

// A Monte Carlo axis without a step samples continuously within [min, max].
const continuous = sampleMonteCarlo([{ variable: 'x', min: 0, max: 1 }], 50, 5);
for (const point of continuous) {
  assert.ok(point.x >= 0 && point.x <= 1);
}

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

// Monte Carlo execution: a seeded sample instead of the Cartesian grid.
const monteCarlo = await runParameterVariation({
  dsl, experimentName: 'CapacityStudy', lpcliPath,
  sampling: 'monte_carlo',
  samples: 3,
  seed: 11,
  arrivals: 300, warmup: 30, concurrency: 2,
});
assert.equal(monteCarlo.pointCount, 3);
assert.equal(monteCarlo.sampling, 'monte_carlo');
assert.equal(monteCarlo.seed, 11);
assert.equal(monteCarlo.iterations.length, 3);
for (const iteration of monteCarlo.iterations) {
  assert.ok(Object.hasOwn(iteration.parameters, 'arrival_rate'));
  assert.ok(Object.hasOwn(iteration.parameters, 'server_count'));
  assert.equal(iteration.run.actualReps, 2);
}

console.log('PARAMETER-VARIATION TEST: PASS');
