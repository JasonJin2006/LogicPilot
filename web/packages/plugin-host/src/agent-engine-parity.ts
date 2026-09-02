import type { AgentStepRequest, AgentStepResult, JsonValue } from '@logicpilot/contracts';
import type { AgentEngine } from './agent-engine-registry.js';

export interface AgentEngineParityCase {
  readonly id: string;
  readonly request: AgentStepRequest;
}

export interface AgentEngineParityResult {
  readonly caseId: string;
  readonly primaryMs: number;
  readonly candidateMs: number;
  readonly equivalent: boolean;
  readonly differences: readonly string[];
}

export interface AgentEngineParityReport {
  readonly primaryId: string;
  readonly candidateId: string;
  readonly cases: readonly AgentEngineParityResult[];
  readonly passed: boolean;
}

/** Run deterministic contract-level parity cases. The harness compares only
 * provider-neutral output and never executes tool calls itself. */
export async function benchmarkAgentEngines(
  primary: AgentEngine,
  candidate: AgentEngine,
  cases: readonly AgentEngineParityCase[],
): Promise<AgentEngineParityReport> {
  const results: AgentEngineParityResult[] = [];
  for (const testCase of cases) {
    const primaryStart = Date.now();
    const primaryResult = await primary.runStep(testCase.request);
    const primaryMs = Math.max(0, Date.now() - primaryStart);
    const candidateStart = Date.now();
    const candidateResult = await candidate.runStep({
      ...testCase.request,
      engineId: candidate.descriptor.id,
    });
    const candidateMs = Math.max(0, Date.now() - candidateStart);
    const differences = compareStepResults(primaryResult, candidateResult);
    results.push({
      caseId: testCase.id,
      primaryMs,
      candidateMs,
      equivalent: differences.length === 0,
      differences,
    });
  }
  return {
    primaryId: primary.descriptor.id,
    candidateId: candidate.descriptor.id,
    cases: results,
    passed: results.every((result) => result.equivalent),
  };
}

function compareStepResults(primary: AgentStepResult, candidate: AgentStepResult): string[] {
  const differences: string[] = [];
  if (primary.status !== candidate.status) differences.push('status differs');
  if (JSON.stringify(primary.message) !== JSON.stringify(candidate.message))
    differences.push('message differs');
  if (JSON.stringify(primary.plan ?? []) !== JSON.stringify(candidate.plan ?? []))
    differences.push('plan differs');
  if (JSON.stringify(primary.toolCalls) !== JSON.stringify(candidate.toolCalls))
    differences.push('tool calls differ');
  if (JSON.stringify(primary.toolResults) !== JSON.stringify(candidate.toolResults))
    differences.push('tool results differ');
  if (primary.error !== candidate.error) differences.push('error differs');
  return differences;
}

export function parityRequest(input: JsonValue, engineId = 'builtin'): AgentStepRequest {
  return {
    schema: 'logicpilot.agent-step-request/v1',
    contractVersion: 1,
    turnId: 'parity-turn',
    engineId,
    stepIndex: 0,
    input,
    tools: [],
  };
}
