import { describe, expect, it } from 'vitest';
import { ExecutionTargetRegistry } from '../src/index.js';

const target = {
  schema: 'logicpilot.execution-target/v1',
  contractVersion: 1,
  id: 'logicpilot.test.runtime',
  artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
  runtime: { kind: 'interpreter', pluginId: 'logicpilot.test' },
} as const;

const request = {
  schema: 'logicpilot.execution-request/v1',
  contractVersion: 1,
  requestId: 'request-1',
  targetId: target.id,
  seed: 42,
  budget: { maxSteps: 10, maxWallMs: 1_000 },
} as const;

describe('ExecutionTargetRegistry', () => {
  it('validates and dispatches a revision-bound run and evidence', async () => {
    const registry = new ExecutionTargetRegistry();
    const dispose = registry.register({
      target,
      execute: async (input) => ({
        run: {
          schema: 'logicpilot.execution-run/v1',
          contractVersion: 1,
          runId: 'run-1',
          requestId: input.requestId,
          targetId: input.targetId,
          artifactRef: target.artifactRef,
          status: 'completed',
          seed: input.seed,
        },
        evidence: {
          schema: 'logicpilot.execution-evidence/v1',
          contractVersion: 1,
          runId: 'run-1',
          digest: 'a'.repeat(64),
          metrics: { steps: 10 },
        },
      }),
    });
    const result = await registry.execute(target.id, request);
    expect(result.run.status).toBe('completed');
    expect(result.evidence?.runId).toBe('run-1');
    dispose();
    expect(registry.list()).toEqual([]);
  });

  it('rejects target mismatches and provider results bound to another target', async () => {
    const registry = new ExecutionTargetRegistry();
    registry.register({
      target,
      execute: async () => ({
        run: {
          schema: 'logicpilot.execution-run/v1',
          contractVersion: 1,
          runId: 'wrong-run',
          requestId: 'request-1',
          targetId: 'other-target',
          artifactRef: target.artifactRef,
          status: 'failed',
        },
      }),
    });
    await expect(
      registry.execute(target.id, { ...request, targetId: 'other-target' }),
    ).rejects.toThrow(/target id mismatch/);
    await expect(registry.execute(target.id, request)).rejects.toThrow(/target id mismatch/);
  });
});
