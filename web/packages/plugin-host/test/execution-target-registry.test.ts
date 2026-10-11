import { describe, expect, it } from 'vitest';
import type { ExecutionRequest } from '@logicpilot/contracts';
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
  it('preserves class provider methods and receiver binding', async () => {
    class ClassProvider {
      readonly target = { ...target, id: 'logicpilot.class.runtime' };
      calls = 0;

      async execute(input: ExecutionRequest) {
        this.calls += 1;
        return {
          run: {
            schema: 'logicpilot.execution-run/v1' as const,
            contractVersion: 1 as const,
            runId: 'class-run',
            requestId: input.requestId,
            targetId: input.targetId,
            artifactRef: this.target.artifactRef,
            status: 'completed' as const,
            seed: input.seed,
          },
        };
      }
    }
    const provider = new ClassProvider();
    const registry = new ExecutionTargetRegistry();
    registry.register(provider);
    await registry.execute('logicpilot.class.runtime', {
      ...request,
      targetId: 'logicpilot.class.runtime',
    });
    expect(provider.calls).toBe(1);
  });

  it('drains admitted executions before a runtime generation swap', async () => {
    const registry = new ExecutionTargetRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registry.register({
      target,
      execute: async (input) => {
        await gate;
        return {
          run: {
            schema: 'logicpilot.execution-run/v1',
            contractVersion: 1,
            runId: 'drain-run',
            requestId: input.requestId,
            targetId: input.targetId,
            artifactRef: target.artifactRef,
            seed: input.seed,
            status: 'completed',
          },
        };
      },
    });
    const running = registry.execute(target.id, request);
    let drained = false;
    const draining = registry.beginDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    await expect(registry.execute(target.id, request)).rejects.toThrow(/draining/);
    release();
    await running;
    await draining;
    expect(drained).toBe(true);
    registry.resume();
    await expect(registry.execute(target.id, request)).resolves.toBeDefined();
  });

  it('returns a lifecycle handle and holds the generation lease until terminal', async () => {
    const registry = new ExecutionTargetRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registry.register({
      target,
      execute: async (input) => {
        await gate;
        return {
          run: {
            schema: 'logicpilot.execution-run/v1',
            contractVersion: 1,
            runId: 'session-run',
            requestId: input.requestId,
            targetId: input.targetId,
            artifactRef: target.artifactRef,
            seed: input.seed,
            status: 'completed',
          },
        };
      },
    });
    const handle = await registry.start(target.id, request);
    expect(['preparing', 'running']).toContain(handle.snapshot().status);
    let drained = false;
    const draining = registry.beginDrain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await handle.result;
    await draining;
    expect(handle.snapshot().status).toBe('completed');
    expect(drained).toBe(true);
  });

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

  it('rejects runs bound to another request or artifact revision', async () => {
    const registry = new ExecutionTargetRegistry();
    registry.register({
      target,
      execute: async () => ({
        run: {
          schema: 'logicpilot.execution-run/v1',
          contractVersion: 1,
          runId: 'wrong-binding',
          requestId: 'other-request',
          targetId: target.id,
          artifactRef: { artifactId: target.artifactRef.artifactId, revisionId: 'rev-2' },
          status: 'completed',
        },
      }),
    });
    await expect(registry.execute(target.id, request)).rejects.toThrow(/request id mismatch/);
  });

  it('rejects a request pinned to another artifact revision', async () => {
    const registry = new ExecutionTargetRegistry();
    registry.register({ target, execute: async () => ({ run: {} as never }) });
    await expect(
      registry.execute(target.id, {
        ...request,
        artifactRef: { artifactId: target.artifactRef.artifactId, revisionId: 'rev-2' },
      }),
    ).rejects.toThrow(/request artifact reference mismatch/);
  });

  it('allows a head target to execute a pin, but rejects a result for a different revision', async () => {
    const registry = new ExecutionTargetRegistry();
    let returnedRevision = 'rev-2';
    registry.register({
      target: { ...target, artifactRef: { artifactId: 'model.main' } },
      execute: async (input) => ({
        run: {
          schema: 'logicpilot.execution-run/v1',
          contractVersion: 1,
          runId: 'pinned-run',
          requestId: input.requestId,
          targetId: input.targetId,
          artifactRef: { artifactId: 'model.main', revisionId: returnedRevision },
          seed: input.seed,
          status: 'completed',
        },
      }),
    });
    const pinned = { ...request, artifactRef: { artifactId: 'model.main', revisionId: 'rev-2' } };
    expect((await registry.execute(target.id, pinned)).run.artifactRef.revisionId).toBe('rev-2');
    returnedRevision = 'rev-1';
    await expect(registry.execute(target.id, pinned)).rejects.toThrow(
      /artifact reference mismatch/,
    );
  });
});
