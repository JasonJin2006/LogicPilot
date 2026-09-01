// Live multi-paradigm assistant benchmark.
//
// Each trial starts from the same blank workspace file. The configured
// assistant must choose product tools, perform a checksum-guarded edit (or a
// valid structured DES patch), compile with the real lpcli, run the kernel,
// and finish. Transport reliability and conditional modeling accuracy are
// reported separately.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { resolveAssistantProvider, runAssistant } from './ai-assistant.mjs';
import { inspectMm1Patch } from './benchmark-ai-assistant.mjs';
import { findLpcli, logicPilotRoot } from './tool-paths.mjs';

const ROOT = logicPilotRoot();
const INITIAL_SOURCE = 'model Benchmark {\n}\n';
const CAPABILITIES = ['logicpilot-modeling', 'logicpilot-source-editing'];

function compact(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll(/\s+/g, '');
}

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

export const PARADIGM_SCENARIOS = Object.freeze([
  {
    id: 'process-mm1',
    paradigm: 'process',
    prompt:
      '在当前空白项目中建立到达率 0.8、服务率 1.0、单服务器的 M/M/1 Process 模型，编译并运行。',
    arrivals: 300,
    warmup: 30,
    validate(source) {
      const text = compact(source);
      return (
        /resource\w+\{/.test(text) &&
        /source\w+\{[^}]*arrival=rate\(0\.8/.test(text) &&
        /queue\w+\{/.test(text) &&
        /service\w+\{[^}]*time=exponential\(1(?:\.0*)?\)/.test(text) &&
        /sink\w+\{/.test(text) &&
        occurrences(source, /\bcouple\b/g) >= 3
      );
    },
  },
  {
    id: 'agent-swarm',
    paradigm: 'agent',
    prompt:
      '在 model/main.lp 中建立 128 个 Drone 的 Agent 模型：声明 active=true，每个 tick 翻转 active 并在单位方形边界反弹；编译并运行 5 个 tick。',
    arrivals: 5,
    warmup: 0,
    validate(source) {
      const text = compact(source);
      return (
        /agentdrone\{/.test(text) &&
        /count=128/.test(text) &&
        /stateactive(?:\:bool)?=true/.test(text) &&
        /on_tick\{[^}]*flipactive/.test(text) &&
        /on_tick\{[^}]*bounce/.test(text)
      );
    },
  },
  {
    id: 'statechart-traffic-light',
    paradigm: 'statechart',
    prompt:
      '在 model/main.lp 中建立 TrafficLight Statechart：Red 初始，Red 3 秒后到 Green，Green 3 秒后到 Yellow，Yellow 1 秒后回 Red；编译并运行 6 次迁移。',
    arrivals: 6,
    warmup: 0,
    validate(source) {
      const text = compact(source);
      return (
        /statechart\w+\{/.test(text) &&
        /initial=red/.test(text) &&
        /statered\{/.test(text) &&
        /stategreen\{/.test(text) &&
        /stateyellow\{/.test(text) &&
        occurrences(source, /\btransition\b/g) === 3 &&
        /timeout=3(?:\.0*)?/.test(text) &&
        /timeout=1(?:\.0*)?/.test(text)
      );
    },
  },
  {
    id: 'continuous-sir',
    paradigm: 'continuous',
    prompt:
      '在 model/main.lp 中建立连续 SIR 模型：S=0.99、I=0.01、R=0，beta=0.5、gamma=0.1，写出三条耦合微分方程；编译并运行。',
    arrivals: 500,
    warmup: 0,
    validate(source) {
      const text = compact(source);
      return (
        /continuous\w+\{/.test(text) &&
        /states=0\.99/.test(text) &&
        /statei=0\.01/.test(text) &&
        /stater=0(?:\.0*)?/.test(text) &&
        /parambeta=0\.5/.test(text) &&
        /paramgamma=0\.1/.test(text) &&
        /ds\/dt=-beta\*s\*i/.test(text) &&
        /di\/dt=beta\*s\*i-gamma\*i/.test(text) &&
        /dr\/dt=gamma\*i/.test(text)
      );
    },
  },
  {
    id: 'devs-pulse-chain',
    paradigm: 'devs',
    prompt:
      '在 model/main.lp 中建立 DEVS PulseChain：Pulser 每 1 秒 emit pulse；被动 Sink 收到 pulse 后把 seen 设为 true；显式 couple 两个原子，编译并运行 5 次内部迁移。',
    arrivals: 5,
    warmup: 0,
    validate(source) {
      const text = compact(source);
      return (
        occurrences(source, /\batomic\b/g) === 2 &&
        /time_advance=constant\(1(?:\.0*)?\)/.test(text) &&
        /on_timeout\{[^}]*emitpulse/.test(text) &&
        /state\w+=false/.test(text) &&
        /time_advance=infinite/.test(text) &&
        /on_inputpulse\{[^}]*=true/.test(text) &&
        /couple\w+\.pulse->\w+\.pulse/.test(text)
      );
    },
  },
]);

export function checksum(text) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function execute(executable, args, label) {
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    return {
      ok: false,
      error: `${label} failed (${result.status})`,
      diagnostics: `${result.stdout}${result.stderr}`.slice(-6000),
    };
  }
  return { ok: true, output: `${result.stdout}${result.stderr}`.slice(-6000) };
}

function canonicalMm1FromPatch(patch) {
  const inspected = inspectMm1Patch(patch);
  if (!inspected.valid) return null;
  return `model BenchmarkMM1 {
  resource Server { capacity = 1 }
  source Arrivals { arrival = rate(0.8) }
  queue WaitLine { capacity = 1000000 }
  service Handle { resource = Server; time = exponential(1.0) }
  sink Done { }
  couple Arrivals.out -> WaitLine.in
  couple WaitLine.out -> Handle.in
  couple Handle.out -> Done.in
}
`;
}

function createTrialState(scenario, directory) {
  return {
    scenario,
    directory,
    source: INITIAL_SOURCE,
    lastReadChecksum: null,
    readCount: 0,
    sourcePatchCount: 0,
    structuredPatchCount: 0,
    compiled: false,
    ran: false,
    compileDiagnostics: [],
    toolNames: [],
    irPath: join(directory, `${scenario.id}.lpir`),
    sourcePath: join(directory, `${scenario.id}.lp`),
  };
}

function compileCandidate(state, lpcli) {
  writeFileSync(state.sourcePath, state.source, 'utf8');
  const result = execute(lpcli, ['compile', state.sourcePath, '-o', state.irPath], 'compile');
  state.compiled = result.ok;
  state.compileDiagnostics = result.ok ? [] : [result.diagnostics];
  return result.ok
    ? { ok: true, phase: 'compiler', diagnostics: [] }
    : { ok: false, phase: 'compiler', diagnostics: state.compileDiagnostics, error: result.error };
}

function runCandidate(state, lpcli) {
  if (!state.compiled) {
    const compiled = compileCandidate(state, lpcli);
    if (!compiled.ok) return compiled;
  }
  const result = execute(
    lpcli,
    [
      'run',
      '--model-file',
      state.irPath,
      '--seed=42',
      '--reps=1',
      `--arrivals=${state.scenario.arrivals}`,
      `--warmup=${state.scenario.warmup}`,
    ],
    'run',
  );
  state.ran = result.ok;
  return result.ok
    ? { ok: true, status: 'finished', summary: result.output }
    : { ok: false, status: 'failed', error: result.error, diagnostics: result.diagnostics };
}

function executeTool(call, state, lpcli) {
  state.toolNames.push(call.name);
  const args = call.arguments ?? {};
  switch (call.name) {
    case 'inspect_model':
      return {
        ok: true,
        model:
          state.source === INITIAL_SOURCE
            ? "model 'Benchmark' nodes (0):"
            : `model source present (${state.source.length} chars)`,
      };
    case 'inspect_selection':
      return { ok: true, selection: null, message: 'nothing selected' };
    case 'read_workspace_file': {
      if (args.path !== 'model/main.lp') return { ok: false, error: 'only model/main.lp exists' };
      state.readCount += 1;
      state.lastReadChecksum = checksum(state.source);
      return {
        ok: true,
        path: 'model/main.lp',
        checksum: state.lastReadChecksum,
        content: state.source,
      };
    }
    case 'apply_source_patch': {
      if (args.path !== 'model/main.lp') return { ok: false, error: 'only model/main.lp exists' };
      if (args.expectedChecksum !== checksum(state.source))
        return { ok: false, error: 'source file changed; read it again before patching' };
      if (state.lastReadChecksum !== args.expectedChecksum)
        return { ok: false, error: 'no matching prior read; call read_workspace_file first' };
      if (typeof args.oldText !== 'string' || !state.source.includes(args.oldText))
        return { ok: false, error: 'oldText was not found exactly' };
      if (typeof args.newText !== 'string') return { ok: false, error: 'newText must be a string' };
      state.source = state.source.replace(args.oldText, args.newText);
      state.sourcePatchCount += 1;
      state.compiled = false;
      return {
        ok: true,
        path: 'model/main.lp',
        checksum: checksum(state.source),
        summary: args.summary,
        changed: true,
      };
    }
    case 'apply_model_patch': {
      if (state.scenario.paradigm !== 'process')
        return {
          ok: false,
          phase: 'preflight',
          error:
            'ModelPatch cannot express this method behavior; read model/main.lp and use apply_source_patch.',
        };
      const source = canonicalMm1FromPatch(args.patch);
      if (source === null)
        return { ok: false, phase: 'preflight', error: 'invalid or incomplete M/M/1 patch' };
      state.source = source;
      state.structuredPatchCount += 1;
      const compiled = compileCandidate(state, lpcli);
      return compiled.ok
        ? { ok: true, applied: args.patch.operations.length, compiled }
        : compiled;
    }
    case 'compile_model':
      return compileCandidate(state, lpcli);
    case 'inspect_diagnostics':
      return { ok: true, compiled: state.compiled, diagnostics: state.compileDiagnostics };
    case 'run_simulation':
      return runCandidate(state, lpcli);
    case 'wait_for_run':
      return state.ran
        ? { ok: true, status: 'finished' }
        : { ok: false, status: 'none', error: 'no successful run' };
    case 'inspect_run_metrics':
      return state.ran
        ? { ok: true, summary: 'the requested model completed on the real kernel' }
        : { ok: false, error: 'no run metrics available' };
    default:
      return { ok: false, error: `${call.name} is outside this benchmark` };
  }
}

function evaluateTrial(responses, state, transportError) {
  const editApplied = state.sourcePatchCount > 0 || state.structuredPatchCount > 0;
  const guardedEdit =
    state.structuredPatchCount > 0 || (state.readCount > 0 && state.sourcePatchCount > 0);
  const semanticModel = editApplied && state.scenario.validate(state.source);
  const finished = responses.at(-1)?.done === true;
  const criteria = {
    transportCompleted: transportError === null,
    choseGuardedEdit: guardedEdit,
    producedParadigmSemantics: semanticModel,
    compiledWithRealCompiler: state.compiled,
    ranOnRealKernel: state.ran,
    completedAfterEvidence: finished && state.ran,
  };
  const score = Object.values(criteria).filter(Boolean).length;
  const passed = score === Object.keys(criteria).length;
  let failureClass = 'success';
  if (transportError !== null) failureClass = 'transport';
  else if (!editApplied || !guardedEdit) failureClass = 'tool-planning';
  else if (!semanticModel) failureClass = 'semantic';
  else if (!state.compiled) failureClass = 'compiler';
  else if (!state.ran) failureClass = 'runtime';
  else if (!finished) failureClass = 'completion';
  return {
    passed,
    score,
    maximumScore: Object.keys(criteria).length,
    criteria,
    failureClass,
    error: transportError,
    responses: responses.length,
    toolNames: state.toolNames,
    responseTrace: responses.map((response) => ({
      message: response.message,
      done: response.done,
      toolCalls: response.toolCalls,
    })),
    candidateSource: state.source,
    finalMessage: finished ? responses.at(-1).message : '',
  };
}

export async function runParadigmTrial({ scenario, lpcli = findLpcli(), runStep = runAssistant }) {
  assert.ok(lpcli, 'lpcli was not found');
  const directory = mkdtempSync(join(tmpdir(), `logicpilot-ai-${scenario.id}-`));
  const state = createTrialState(scenario, directory);
  const responses = [];
  const messages = [{ role: 'user', content: scenario.prompt }];
  let transportError = null;
  try {
    for (let step = 0; step < 7; ++step) {
      let response;
      try {
        response = await runStep({
          messages,
          context: {
            project: 'AI paradigm benchmark',
            workspaceRoot: directory,
            modelSummary: "model 'Benchmark' nodes (0):",
            selection: 'nothing selected',
            dsl: state.source,
            diagnostics: state.compileDiagnostics,
            runStatus: state.ran ? 'finished' : 'none',
            runMetrics: state.ran ? 'real kernel run completed' : 'no run metrics yet',
          },
          capabilities: CAPABILITIES,
        });
      } catch (error) {
        transportError = error instanceof Error ? error.message : String(error);
        break;
      }
      responses.push(response);
      if (response.done) break;
      if (!Array.isArray(response.toolCalls) || response.toolCalls.length === 0) break;
      const toolResults = response.toolCalls.map((call) => {
        const result = executeTool(call, state, lpcli);
        return { toolCallId: call.id, ok: result.ok !== false, result };
      });
      messages.push({
        role: 'assistant',
        content: response.message,
        toolCalls: response.toolCalls,
        toolResults,
      });
    }
    return evaluateTrial(responses, state, transportError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function positiveInteger(args, name, fallback) {
  const inline = args.find((argument) => argument.startsWith(`--${name}=`));
  const index = args.indexOf(`--${name}`);
  const raw = inline?.slice(name.length + 3) ?? (index >= 0 ? args[index + 1] : fallback);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`--${name} must be positive`);
  return parsed;
}

function stringOption(args, name) {
  const inline = args.find((argument) => argument.startsWith(`--${name}=`));
  const index = args.indexOf(`--${name}`);
  return inline?.slice(name.length + 3) ?? (index >= 0 ? args[index + 1] : undefined);
}

export async function runParadigmBenchmark({
  trials = 3,
  lpcli = findLpcli(),
  reportPath,
  scenarios = PARADIGM_SCENARIOS,
} = {}) {
  const provider = resolveAssistantProvider();
  if (provider === 'unconfigured') {
    const skipped = { skipped: true, provider, trials: 0, results: [] };
    console.log('AI PARADIGM BENCHMARK: SKIP (configure an HTTP provider or Codex login)');
    return skipped;
  }
  const results = [];
  for (const scenario of scenarios) {
    for (let trial = 1; trial <= trials; ++trial) {
      const started = performance.now();
      const result = await runParadigmTrial({ scenario, lpcli });
      const row = {
        scenario: scenario.id,
        paradigm: scenario.paradigm,
        trial,
        durationMs: performance.now() - started,
        ...result,
      };
      results.push(row);
      console.log(
        `${row.passed ? 'PASS' : 'FAIL'} ${scenario.id} ${trial}/${trials} ` +
          `(${row.score}/${row.maximumScore}, ${row.failureClass})`,
      );
    }
  }
  const transportCompleted = results.filter((result) => result.criteria.transportCompleted);
  const passed = results.filter((result) => result.passed);
  const byParadigm = Object.fromEntries(
    scenarios.map((scenario) => {
      const rows = results.filter((result) => result.scenario === scenario.id);
      const completed = rows.filter((result) => result.criteria.transportCompleted);
      return [
        scenario.paradigm,
        {
          trials: rows.length,
          passed: rows.filter((result) => result.passed).length,
          transportCompleted: completed.length,
          passRate: rows.filter((result) => result.passed).length / rows.length,
          conditionalAccuracy:
            completed.length === 0
              ? null
              : completed.filter((result) => result.passed).length / completed.length,
        },
      ];
    }),
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    skipped: false,
    provider,
    trialsPerParadigm: trials,
    summary: {
      trials: results.length,
      passed: passed.length,
      passRate: passed.length / results.length,
      transportCompleted: transportCompleted.length,
      transportReliability: transportCompleted.length / results.length,
      conditionalAccuracy:
        transportCompleted.length === 0 ? null : passed.length / transportCompleted.length,
      failureClasses: Object.fromEntries(
        [...new Set(results.map((result) => result.failureClass))].map((failureClass) => [
          failureClass,
          results.filter((result) => result.failureClass === failureClass).length,
        ]),
      ),
    },
    byParadigm,
    results,
  };
  if (reportPath) writeFileSync(resolve(ROOT, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ summary: report.summary, byParadigm }, null, 2));
  return report;
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  const requestedScenario = stringOption(args, 'scenario');
  const scenarios = requestedScenario
    ? PARADIGM_SCENARIOS.filter((scenario) => scenario.id === requestedScenario)
    : PARADIGM_SCENARIOS;
  if (scenarios.length === 0) throw new Error(`unknown --scenario '${requestedScenario}'`);
  const report = await runParadigmBenchmark({
    trials: positiveInteger(args, 'trials', 3),
    lpcli: stringOption(args, 'lpcli') ?? findLpcli(),
    reportPath: stringOption(args, 'report'),
    scenarios,
  });
  if (!report.skipped && report.summary.passed !== report.summary.trials) process.exitCode = 1;
}
