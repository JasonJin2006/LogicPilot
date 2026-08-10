// Live quality benchmark for the tool-calling AI assistant.
//
// Unlike schema/unit tests, this calls the configured OpenAI-compatible
// model and scores whether it can turn a blank canvas into a valid M/M/1,
// run it, and ground the final explanation in returned metrics. With no API
// key it exits successfully with an explicit SKIP, keeping normal local/CI
// gates deterministic.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { resolveAssistantProvider, runAssistant } from './ai-assistant.mjs';

export const MM1_BENCHMARK_METRICS = Object.freeze({
  summary: {
    Wq: { mean: 4, stddev: 0.1, ci_low: 3.8, ci_high: 4.2 },
    utilization: { mean: 0.8, stddev: 0, ci_low: 0.8, ci_high: 0.8 },
  },
  blocks: [
    {
      name: 'WaitLine',
      kind: 'queue',
      capacity: 1000000,
      arrived_mean: 100,
      departed_mean: 100,
      mean_occupancy: 3.2,
      utilization: 0.8,
      availability: 1,
    },
  ],
});

const MM1_PROMPT = '从空白画布建立一个到达率 0.8、服务率 1.0 的 M/M/1 队列，运行仿真并解释结果。';

const BLANK_CONTEXT = Object.freeze({
  project: 'AI benchmark',
  modelSummary: "model 'BenchmarkMM1' nodes (0):",
  selection: 'nothing selected',
  dsl: '',
  diagnostics: 'no diagnostics (nothing compiled yet)',
  runStatus: 'none',
  runMetrics: 'no run metrics yet',
});

function normalizeExpression(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll(/\s+/g, '');
}

function connectionExists(operations, from, to) {
  return operations.some(
    (operation) => operation.op === 'connect' && operation.from === from && operation.to === to,
  );
}

/** Score the first build patch without relying on block names chosen by the model. */
export function inspectMm1Patch(patch) {
  const operations = Array.isArray(patch?.operations) ? patch.operations : [];
  const added = operations.filter((operation) => operation?.op === 'add_block');
  const byKind = (kind) => added.find((operation) => operation.kind === kind);
  const resource = byKind('resource');
  const source = byKind('source');
  const queue = byKind('queue');
  const service = byKind('service');
  const sink = byKind('sink');
  const completeKinds = [resource, source, queue, service, sink].every(Boolean);
  const parametersCorrect =
    completeKinds &&
    resource.params?.capacity === 1 &&
    /^rate\(0\.8(?:0*)?\)$/.test(normalizeExpression(source.params?.arrival)) &&
    /^exponential\(1(?:\.0*)?\)$/.test(normalizeExpression(service.params?.time)) &&
    service.params?.resource === resource.name &&
    Number(queue.params?.capacity) > 0;
  const topologyCorrect =
    completeKinds &&
    connectionExists(operations, source.name, queue.name) &&
    connectionExists(operations, queue.name, service.name) &&
    connectionExists(operations, service.name, sink.name);
  return {
    versionCorrect: patch?.version === 1,
    completeKinds,
    parametersCorrect,
    topologyCorrect,
    valid: patch?.version === 1 && completeKinds === true && parametersCorrect && topologyCorrect,
  };
}

/** Evaluate a completed transcript. This function is pure and unit-tested. */
export function evaluateMm1Transcript(responses) {
  const calls = responses.flatMap((response) => response.toolCalls ?? []);
  const firstApply = calls.find((call) => call.name === 'apply_model_patch');
  const patch = inspectMm1Patch(firstApply?.arguments?.patch);
  const ran = calls.some((call) => call.name === 'run_simulation');
  const finished = responses.at(-1)?.done === true;
  const finalMessage = finished ? (responses.at(-1)?.message ?? '') : '';
  const groundedWq = /(?:^|\D)4(?:\.0*)?(?:\D|$)/.test(finalMessage);
  const groundedUtilization =
    /(?:^|\D)0\.8(?:0*)?(?:\D|$)/.test(finalMessage) ||
    /(?:^|\D)80(?:\.0*)?\s*%/.test(finalMessage);
  const mentionsQueueLength = /(?:\bLq\b|队列平均占用|平均队列长度)/i.test(finalMessage);
  const groundedQueueLength =
    !mentionsQueueLength || /(?:^|\D)3\.2(?:0*)?(?:\D|$)/.test(finalMessage);
  const contradictsEvidence = /(?:不符|不一致|矛盾|does not match|inconsistent|contradict)/i.test(
    finalMessage,
  );
  const criteria = {
    oneAtomicCompletePatch: patch.versionCorrect && patch.completeKinds,
    correctMm1Parameters: patch.parametersCorrect,
    correctFlowTopology: patch.topologyCorrect,
    requestedSimulationRun: ran,
    groundedFinalAnswer: finished && groundedWq && groundedUtilization,
    consistentExplanation: finished && groundedQueueLength && !contradictsEvidence,
  };
  const passed = Object.values(criteria).filter(Boolean).length;
  return {
    passed: passed === Object.keys(criteria).length,
    score: passed,
    maximumScore: Object.keys(criteria).length,
    criteria,
    finalMessage,
  };
}

function toolResult(call, state) {
  switch (call.name) {
    case 'inspect_model':
      return {
        ok: true,
        model: state.modelValid
          ? "model 'BenchmarkMM1' nodes (5): resource, source, queue, service, sink"
          : "model 'BenchmarkMM1' nodes (0):",
      };
    case 'inspect_selection':
      return { ok: true, selection: null, message: 'no block is selected' };
    case 'apply_model_patch': {
      const inspected = inspectMm1Patch(call.arguments?.patch);
      state.firstPatch ??= call.arguments?.patch;
      if (!inspected.valid) {
        return {
          ok: false,
          error: 'DES preflight rejected an incomplete or invalid M/M/1 topology',
          phase: 'preflight',
          diagnostics: [{ code: 'BENCH-MM1', message: 'build the complete valid flow' }],
        };
      }
      state.modelValid = true;
      return {
        ok: true,
        applied: call.arguments.patch.operations.length,
        summary: call.arguments.summary,
        compiled: { ok: true, phase: 'compiler', diagnostics: [] },
        model: "model 'BenchmarkMM1' nodes (5): valid M/M/1 flow",
      };
    }
    case 'compile_model':
      return state.modelValid
        ? { ok: true, phase: 'compiler', diagnostics: [] }
        : {
            ok: false,
            phase: 'preflight',
            error: 'model is incomplete',
            diagnostics: [{ code: 'BENCH-MM1', message: 'model is incomplete' }],
          };
    case 'run_simulation':
      if (!state.modelValid) return { ok: false, error: 'model must pass preflight before run' };
      state.ran = true;
      return {
        ok: true,
        status: 'finished',
        summary: 'benchmark run finished: Wq=4.0, Lq=3.2, utilization=0.8',
        metrics: MM1_BENCHMARK_METRICS,
      };
    case 'inspect_run_metrics':
      return state.ran
        ? { ok: true, summary: 'benchmark run metrics', metrics: MM1_BENCHMARK_METRICS }
        : { ok: false, error: 'no run metrics available - run the model first' };
    case 'wait_for_run':
      return state.ran
        ? { ok: true, status: 'finished', metrics: MM1_BENCHMARK_METRICS }
        : { ok: false, status: 'none', error: 'no run requested' };
    case 'inspect_diagnostics':
      return { ok: true, compiled: state.modelValid, diagnostics: [] };
    default:
      return { ok: false, error: `${call.name} is outside this benchmark scenario` };
  }
}

/** Run one live trial. runStep is injectable so the loop remains testable offline. */
export async function runMm1Trial({ runStep = runAssistant, maxSteps = 6 } = {}) {
  const messages = [{ role: 'user', content: MM1_PROMPT }];
  const responses = [];
  const state = { modelValid: false, ran: false, firstPatch: null };
  for (let step = 0; step < maxSteps; ++step) {
    let response;
    try {
      response = await runStep({ messages, context: BLANK_CONTEXT });
    } catch (error) {
      return {
        ...evaluateMm1Transcript(responses),
        responses: responses.length,
        failedStep: step + 1,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    responses.push(response);
    if (response.done) break;
    if (!Array.isArray(response.toolCalls) || response.toolCalls.length === 0) break;
    const results = response.toolCalls.map((call) => {
      const result = toolResult(call, state);
      return { toolCallId: call.id, ok: result.ok !== false, result };
    });
    messages.push({
      role: 'assistant',
      content: response.message,
      toolCalls: response.toolCalls,
      toolResults: results,
    });
  }
  return { ...evaluateMm1Transcript(responses), responses: responses.length };
}

function integerArgument(args, name, fallback) {
  const prefix = `--${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  const splitIndex = args.indexOf(`--${name}`);
  const raw = inline?.slice(prefix.length) ?? (splitIndex >= 0 ? args[splitIndex + 1] : undefined);
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

export async function runBenchmarkCli(args = process.argv.slice(2)) {
  const trials = integerArgument(args, 'trials', 3);
  const provider = resolveAssistantProvider();
  if (provider === 'unconfigured') {
    console.log(
      'AI-ASSISTANT BENCHMARK: SKIP (configure OPENAI_API_KEY or LOGICPILOT_AI_PROVIDER=codex)',
    );
    return { skipped: true, passed: true, trials: 0, passRate: null };
  }
  const results = [];
  for (let trial = 1; trial <= trials; ++trial) {
    let result;
    try {
      result = await runMm1Trial();
    } catch (error) {
      result = {
        passed: false,
        score: 0,
        maximumScore: 6,
        criteria: {},
        finalMessage: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(result);
    console.log(
      `trial ${trial}/${trials}: ${result.passed ? 'PASS' : 'FAIL'} ` +
        `(${result.score}/${result.maximumScore})`,
    );
  }
  const passedTrials = results.filter((result) => result.passed).length;
  const passRate = passedTrials / trials;
  const summary = {
    skipped: false,
    passed: passRate === 1,
    provider,
    model:
      provider === 'codex'
        ? (process.env.LOGICPILOT_CODEX_MODEL ?? 'Codex CLI default')
        : (process.env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    trials,
    passedTrials,
    passRate,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.passed) process.exitCode = 1;
  return summary;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  await runBenchmarkCli();
}
