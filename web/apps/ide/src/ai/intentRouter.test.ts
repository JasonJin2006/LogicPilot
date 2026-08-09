import { describe, expect, it } from 'vitest';

import { routeAiIntent } from './intentRouter';
import type { AiIntentContext } from './intentRouter';

const withMetrics: AiIntentContext = { hasModel: true, hasMetrics: true };
const withoutMetrics: AiIntentContext = { hasModel: true, hasMetrics: false };

describe('AI intent router: explicit commands', () => {
  it('routes /build and strips the command from the prompt', () => {
    const decision = routeAiIntent('/build an M/M/1 queue with rate 0.8', withMetrics);
    expect(decision.action).toBe('build');
    expect(decision.cleanedPrompt).toBe('an M/M/1 queue with rate 0.8');
    expect(decision.reason).toContain('/build');
  });

  it('routes /optimize case-insensitively and trims surrounding whitespace', () => {
    const decision = routeAiIntent('  /OPTIMIZE   the arrival rate  ', withMetrics);
    expect(decision.action).toBe('optimize');
    expect(decision.cleanedPrompt).toBe('the arrival rate');
  });

  it('routes /sweep to variation', () => {
    const decision = routeAiIntent('/sweep arrivals from 0.5 to 2.0', withMetrics);
    expect(decision.action).toBe('variation');
    expect(decision.cleanedPrompt).toBe('arrivals from 0.5 to 2.0');
  });

  it('routes /explain to explain even without metrics (command wins)', () => {
    const decision = routeAiIntent('/Explain why utilization is high', withoutMetrics);
    expect(decision.action).toBe('explain');
    expect(decision.cleanedPrompt).toBe('why utilization is high');
  });

  it('a command alone leaves an empty cleanedPrompt', () => {
    const decision = routeAiIntent('/sweep', withMetrics);
    expect(decision.action).toBe('variation');
    expect(decision.cleanedPrompt).toBe('');
  });

  it('an embedded command still wins and removal only trims at the ends', () => {
    const decision = routeAiIntent('please /explain the last run', withMetrics);
    expect(decision.action).toBe('explain');
    expect(decision.cleanedPrompt).toBe('please  the last run');
  });

  it('does not treat a longer word as a command', () => {
    const decision = routeAiIntent('/builder queue', withMetrics);
    expect(decision.action).toBe('build');
  });
});

describe('AI intent router: result questions (explain)', () => {
  it('routes English result questions to explain when metrics exist', () => {
    const prompts = [
      'why is the wait time so high',
      'explain the results',
      'what is the bottleneck',
      'interpret the metrics',
      'what does utilization mean',
    ];
    for (const prompt of prompts) {
      expect(routeAiIntent(prompt, withMetrics).action).toBe('explain');
    }
  });

  it('routes Chinese result questions to explain when metrics exist', () => {
    const prompts = [
      '为什么等待时间这么长',
      '解释一下瓶颈在哪里',
      '指标是什么意思',
      '利用率为什么这么低',
    ];
    for (const prompt of prompts) {
      expect(routeAiIntent(prompt, withMetrics).action).toBe('explain');
    }
  });

  it('falls back to build for result questions without metrics, explaining why', () => {
    const prompts = ['why is utilization high', '为什么等待时间这么长'];
    for (const prompt of prompts) {
      const decision = routeAiIntent(prompt, withoutMetrics);
      expect(decision.action).toBe('build');
      expect(decision.cleanedPrompt).toBe(prompt);
      expect(decision.reason.toLowerCase()).toContain('metric');
    }
  });

  it('gives explain priority over optimize when metrics exist (rule order)', () => {
    expect(routeAiIntent('为什么等待时间这么长', withMetrics).action).toBe('explain');
    expect(routeAiIntent('why is the wait time high', withMetrics).action).toBe('explain');
    // Documented boundary: the rule-2 explain keyword 等待时间 / wait time
    // outranks the rule-3 reduce-wait phrase when metrics exist.
    expect(routeAiIntent('降低等待时间', withMetrics).action).toBe('explain');
    expect(routeAiIntent('reduce the wait time', withMetrics).action).toBe('explain');
  });

  it('lets optimize win over the explain fallback when metrics are missing', () => {
    expect(routeAiIntent('降低等待时间', withoutMetrics).action).toBe('optimize');
  });
});

describe('AI intent router: optimization language', () => {
  it('routes English optimization language to optimize', () => {
    const prompts = [
      'optimize the service time',
      'find the best arrival rate',
      'reduce the wait',
      'improve throughput',
      'increase the throughput',
      'higher throughput',
    ];
    for (const prompt of prompts) {
      expect(routeAiIntent(prompt, withMetrics).action).toBe('optimize');
    }
  });

  it('routes Chinese optimization language to optimize', () => {
    const prompts = ['优化这个模型', '找到最优参数', '降低等待', '提高吞吐', '最佳方案是什么'];
    for (const prompt of prompts) {
      expect(routeAiIntent(prompt, withMetrics).action).toBe('optimize');
    }
  });

  it('does not treat a wait mention without a reduction verb as optimize', () => {
    expect(routeAiIntent('add a queue before the service', withMetrics).action).toBe('build');
  });
});

describe('AI intent router: parameter-study language (variation)', () => {
  it('routes English parameter-study language to variation', () => {
    const prompts = [
      'run a parameter sweep',
      'do a sensitivity analysis',
      'vary the arrival rate',
      'compare different parameters',
      'try different parameter values',
    ];
    for (const prompt of prompts) {
      expect(routeAiIntent(prompt, withMetrics).action).toBe('variation');
    }
  });

  it('routes Chinese parameter-study language to variation', () => {
    const prompts = [
      '参数扫描 arrival rate',
      '做一次敏感性分析',
      '对比不同参数下的结果',
      '扫描参数范围',
    ];
    for (const prompt of prompts) {
      expect(routeAiIntent(prompt, withMetrics).action).toBe('variation');
    }
  });
});

describe('AI intent router: default build', () => {
  it('routes model editing and unrecognized input to build', () => {
    const prompts = [
      'create an M/M/1 model',
      'add a queue before the service',
      'delete the sink block',
      'connect source to queue',
      'modify the arrival rate to 0.5',
      '创建一个新模型',
      '删除这个块',
      '把容量改成 200',
      'please just do something',
    ];
    for (const prompt of prompts) {
      const decision = routeAiIntent(prompt, withMetrics);
      expect(decision.action).toBe('build');
      expect(decision.cleanedPrompt).toBe(prompt);
      expect(decision.reason).not.toBe('');
    }
  });
});

describe('AI intent router: matching boundaries', () => {
  it('matches English keywords on word boundaries, not substrings', () => {
    const prompts = [
      'sweeping the floor does not help',
      'variational calculus is unrelated',
      'the optimizer plugin crashed',
      'anyway, add another server',
      'the bestiary lists nothing',
      'explainable artifacts remain',
    ];
    for (const prompt of prompts) {
      expect(routeAiIntent(prompt, withMetrics).action).toBe('build');
    }
  });

  it('does not treat a bare 参数 mention as a parameter study', () => {
    expect(routeAiIntent('把参数改成 0.5', withMetrics).action).toBe('build');
  });

  it('is case-insensitive for English keywords', () => {
    expect(routeAiIntent('WHY is the wait high', withMetrics).action).toBe('explain');
    expect(routeAiIntent('Optimize The Model', withMetrics).action).toBe('optimize');
    expect(routeAiIntent('Run A Parameter Sweep', withMetrics).action).toBe('variation');
    expect(routeAiIntent('EXPLAIN THE METRICS', withMetrics).action).toBe('explain');
  });
});

describe('AI intent router: edge cases and determinism', () => {
  it('handles empty and whitespace-only input without throwing', () => {
    for (const input of ['', '   ', '\n\t ']) {
      const decision = routeAiIntent(input, withMetrics);
      expect(decision.action).toBe('build');
      expect(decision.cleanedPrompt).toBe('');
      expect(decision.reason).not.toBe('');
    }
  });

  it('explicit commands override keyword routing', () => {
    const decision = routeAiIntent('/build why is the wait high', withMetrics);
    expect(decision.action).toBe('build');
    expect(decision.cleanedPrompt).toBe('why is the wait high');
  });

  it('is deterministic: the same input and context always agree', () => {
    const cases: Array<[string, AiIntentContext]> = [
      ['/optimize the model', withMetrics],
      ['why is the wait high', withMetrics],
      ['why is the wait high', withoutMetrics],
      ['run a parameter sweep', withMetrics],
      ['增加吞吐', withoutMetrics],
      ['add a server', withMetrics],
      ['', withMetrics],
    ];
    for (const [prompt, context] of cases) {
      const first = routeAiIntent(prompt, context);
      const second = routeAiIntent(prompt, context);
      expect(second).toEqual(first);
    }
  });
});
