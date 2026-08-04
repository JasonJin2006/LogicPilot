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
  assert.match(result.dsl, /poisson\(0\.8\)/);
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
  assert.match(dsl, /poisson\(1\.5\)/);
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

console.log('AI-BUILD TEST: PASS');
