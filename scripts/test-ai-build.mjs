// Regression test for the AI model build loop (rule-based provider, offline):
// NL -> DSL -> compile -> run, plus the diagnostics-driven repair path
// (--test-sabotage-first) and the provider's keyword/spec extraction.
//
// Usage: node scripts/test-ai-build.mjs [--lpcli <path>]
import assert from 'node:assert/strict';

import { buildModel } from './ai-build.mjs';
import { ruleBasedProvider } from './ai-provider.mjs';

const lpcli = (() => {
  const flag = process.argv.indexOf('--lpcli');
  return flag >= 0 && process.argv[flag + 1] ? process.argv[flag + 1] : '';
})();

const base = { lpcli: lpcli || undefined };

// 1. Generate + compile + run from a clear prompt.
{
  const result = await buildModel({
    ...base,
    prompt:
        'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0',
    maxIterations: 2,
  });
  assert.equal(result.ok, true, 'clean prompt must compile');
  assert.match(result.dsl, /rate\(0\.8\)/);
  assert.match(result.dsl, /exponential\(1\.0\)/);
}

// 2. The repair loop: a sabotaged first attempt must recover via the
// structured diagnostics within the iteration budget.
{
  const result = await buildModel({
    ...base,
    prompt:
        'build an M/M/1 queue model with arrival rate 0.8 and service rate 1.0',
    maxIterations: 3,
    sabotageFirst: true,
  });
  assert.equal(result.ok, true, 'repair loop must converge');
  assert.ok(result.iterations > 1, 'must have required at least one repair');
}

// 3. Provider keyword extraction: servers / queue capacity / failure /
// arrival / service.
{
  const dsl = ruleBasedProvider(
      'a queue with 2 servers, queue capacity 50, failure rate 0.1, ' +
      'arrival 1.5, service 2.0');
  assert.match(dsl, /capacity = 2/);
  assert.match(dsl, /failure_rate = 0\.1/);
  assert.match(dsl, /rate\(1\.5\)/);
  assert.match(dsl, /exponential\(2\.0\)/);
  assert.match(dsl, /capacity = 50/);
}

// 4. Diagnostic repair keeps the spec well-formed.
{
  const dsl = ruleBasedProvider('a queue with 2 servers', [
    { code: 'LP3001', message: 'out of range' },
  ]);
  assert.match(dsl, /capacity = 2/);
}

// 5. Continuous-model generation from an ODE prompt.
{
  const dsl = ruleBasedProvider(
      'build an exponential decay model with rate 0.5');
  assert.match(dsl, /continuous/);
  assert.match(dsl, /d y\/dt = -k\*y/);
  assert.match(dsl, /param k = 0\.5/);
}

// 6. ai-build with a decay prompt returns the sampled trajectory.
{
  const result = await buildModel({
    ...base,
    prompt: 'build an exponential decay model with rate 0.5',
    maxIterations: 2,
    run: true,
  });
  assert.equal(result.ok, true);
  assert.ok(result.trajectory !== null &&
      Array.isArray(result.trajectory.points) &&
      result.trajectory.points.length > 0);
}

// 7. DES feature templates: priority / measure / seize / batch / assembly /
// timeout prompts generate models that carry the requested semantics.
{
  const priority = ruleBasedProvider(
      'a priority queue with arrival rate 0.8 and service rate 1.0');
  assert.match(priority, /queuing = queuing_priority/);
  assert.match(priority, /state priority: float = 2/);

  const measured = ruleBasedProvider(
      'measure time in system for a queue with arrival rate 0.8');
  assert.match(measured, /timeMeasureStart/);
  assert.match(measured, /timeMeasureEnd/);

  const seizing = ruleBasedProvider(
      'seize a resource for each job with arrival rate 1.0');
  assert.match(seizing, /seize Grab/);
  assert.match(seizing, /release Drop/);

  const batched = ruleBasedProvider(
      'batch jobs in groups of 3 with arrival rate 1.0');
  assert.match(batched, /batch Group/);
  assert.match(batched, /unbatch Split/);

  const assembled = ruleBasedProvider(
      'an assembly line with parts and kits');
  assert.match(assembled, /assembler Build/);
  assert.match(assembled, /quantity125 = 2/);

  const timed = ruleBasedProvider(
      'a queue with timeout for arrival rate 0.8');
  assert.match(timed, /enableTimeout = true/);
  assert.match(timed, /outTimeout/);
}

// 8. The priority template must survive the full compile+run loop.
{
  const result = await buildModel({
    ...base,
    prompt: 'a priority queue with arrival rate 0.8 and service rate 1.0',
    maxIterations: 2,
  });
  assert.equal(result.ok, true, 'priority template must compile');
}

console.log('AI-BUILD TEST: PASS');
