// Pure AI intent router: classifies a copilot prompt into one of the four
// AI actions (build / optimize / variation / explain) without any side
// effects. Deterministic by construction: no browser APIs, clocks, or
// randomness — the same (input, context) pair always yields the same
// decision, which the test suite locks in.
//
// Priority order (per product rules):
//   1. explicit /build /optimize /sweep /explain commands
//   2. result questions ("why", "bottleneck", "指标"...) when metrics exist
//   3. optimization language ("optimize", "best", "降低等待", "提高吞吐"...)
//   4. parameter-study language ("sweep", "variation", "参数扫描"...)
//   5. everything else defaults to build (model creation/editing)
//   6. result questions without metrics fall back to build, explaining why

export type AiAction = 'build' | 'optimize' | 'variation' | 'explain';

export interface AiIntentContext {
  hasModel: boolean;
  hasMetrics: boolean;
}

export interface AiIntentDecision {
  action: AiAction;
  cleanedPrompt: string;
  reason: string;
}

// English keywords are matched on word boundaries (\b) so "sweep" does not
// match "sweeping", "why" does not match "anyway", and "best" does not match
// "bestiary". Chinese phrases carry no whitespace boundaries, so they are
// matched by plain containment of the listed phrase.
const en = (words: readonly string[]): RegExp => new RegExp(`\\b(?:${words.join('|')})\\b`, 'i');

const EXPLAIN_EN = en([
  'explain',
  'explains',
  'explained',
  'explain the results',
  'interpret',
  'why',
  'bottleneck',
  'bottlenecks',
  'metric',
  'metrics',
  'utilization',
  'utilisation',
  'wait time',
  'wait times',
  'waiting time',
  'waiting times',
]);
const EXPLAIN_ZH = [
  '解释',
  '为什么',
  '原因',
  '瓶颈',
  '指标',
  '利用率',
  '等待时间',
  '等待时长',
  '结果如何',
];

const OPTIMIZE_EN = en([
  'optimize',
  'optimizes',
  'optimized',
  'optimizing',
  'optimise',
  'optimises',
  'optimised',
  'optimising',
  'optimization',
  'optimisation',
  'best',
  'optimal',
  'optimum',
  'higher throughput',
  'better throughput',
  'greater throughput',
]);
const OPTIMIZE_ZH = [
  '优化',
  '最佳',
  '最优',
  '最佳化',
  '调优',
  '降低等待',
  '减少等待',
  '缩短等待',
  '提高吞吐',
  '提升吞吐',
  '增加吞吐',
  '增大吞吐',
  '改善吞吐',
];
// Verb + noun composition covers natural phrasing ("reduce the wait time")
// without treating every wait mention as an optimization request: a
// wait-related noun only counts when a reduction verb is also present, and
// "throughput" only counts with an improvement verb.
const OPTIMIZE_REDUCE_VERBS = en([
  'reduce',
  'reduces',
  'reduced',
  'lower',
  'lowers',
  'lowered',
  'decrease',
  'decreases',
  'decreased',
  'minimize',
  'minimizes',
  'minimized',
  'shorten',
  'shortens',
  'shortened',
]);
const OPTIMIZE_WAIT_NOUNS = en([
  'wait',
  'waits',
  'waiting',
  'wait time',
  'wait times',
  'waiting time',
  'waiting times',
]);
const OPTIMIZE_IMPROVE_VERBS = en([
  'improve',
  'improves',
  'improved',
  'increase',
  'increases',
  'increased',
  'raise',
  'raises',
  'raised',
  'boost',
  'boosts',
  'boosted',
  'maximize',
  'maximizes',
  'maximized',
]);
const OPTIMIZE_THROUGHPUT_NOUNS = en(['throughput', 'throughputs']);

const VARIATION_EN = en([
  'sweep',
  'sweeps',
  'variation',
  'variations',
  'vary',
  'varies',
  'varying',
  'parameter sweep',
  'parameter sweeps',
  'parameter scan',
  'parameter study',
  'parameter studies',
  'sensitivity analysis',
  'sensitivity analyses',
  'compare different parameters',
  'compare parameters',
  'different parameter values',
  'different parameters',
]);
const VARIATION_ZH = [
  '参数扫描',
  '扫描参数',
  '敏感性分析',
  '灵敏度分析',
  '对比不同参数',
  '对比参数',
  '参数对比',
  '参数变化',
  '参数变体',
  '参数组合',
  '参数试验',
];

// Slash commands are the strongest signal; the whole token is stripped from
// cleanedPrompt (leading/trailing trim only, no internal whitespace folding).
const COMMAND_RE = /\/\s*(build|optimize|sweep|explain)\b/gi;

function commandAction(command: string): AiAction {
  switch (command.toLowerCase()) {
    case 'build':
      return 'build';
    case 'optimize':
      return 'optimize';
    case 'sweep':
      return 'variation';
    case 'explain':
      return 'explain';
    default:
      return 'build';
  }
}

function hasEn(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function hasZh(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export function routeAiIntent(input: string, context: AiIntentContext): AiIntentDecision {
  const text = input.trim();
  if (text === '') {
    return { action: 'build', cleanedPrompt: '', reason: 'Empty prompt; routed to build.' };
  }

  // Rule 1: explicit commands win over any keyword routing.
  const commands = Array.from(text.matchAll(COMMAND_RE));
  const command = commands[0]?.[1] ?? '';
  if (command !== '') {
    const action = commandAction(command);
    const cleanedPrompt = text.replace(COMMAND_RE, '').trim();
    return {
      action,
      cleanedPrompt,
      reason: `Explicit /${command.toLowerCase()} command; routed to ${action}.`,
    };
  }

  // Rule 2: result questions route to explain only when run metrics exist.
  const explainIntent = hasEn(text, EXPLAIN_EN) || hasZh(text, EXPLAIN_ZH);
  if (context.hasMetrics && explainIntent) {
    return {
      action: 'explain',
      cleanedPrompt: text,
      reason: 'Result question with run metrics available; routed to explain.',
    };
  }

  // Rule 3: optimization language (explicit words or verb + target pairs).
  if (
    hasEn(text, OPTIMIZE_EN) ||
    hasZh(text, OPTIMIZE_ZH) ||
    (hasEn(text, OPTIMIZE_REDUCE_VERBS) && hasEn(text, OPTIMIZE_WAIT_NOUNS)) ||
    (hasEn(text, OPTIMIZE_IMPROVE_VERBS) && hasEn(text, OPTIMIZE_THROUGHPUT_NOUNS))
  ) {
    return {
      action: 'optimize',
      cleanedPrompt: text,
      reason: 'Optimization language detected; routed to optimize.',
    };
  }

  // Rule 4: parameter-study language.
  if (hasEn(text, VARIATION_EN) || hasZh(text, VARIATION_ZH)) {
    return {
      action: 'variation',
      cleanedPrompt: text,
      reason: 'Parameter-study language detected; routed to variation.',
    };
  }

  // Rule 6: result questions without metrics fall back to build.
  if (explainIntent) {
    return {
      action: 'build',
      cleanedPrompt: text,
      reason:
        'Prompt asks to explain results, but no run metrics are available to explain; routed to build.',
    };
  }

  // Rule 5: model creation/editing and everything else defaults to build.
  return {
    action: 'build',
    cleanedPrompt: text,
    reason: 'No explicit or keyword intent matched; defaulting to build.',
  };
}
