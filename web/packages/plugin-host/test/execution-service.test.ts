import { describe, expect, it } from 'vitest';
import { ExecutionService, ExecutionTargetRegistry } from '../src/index.js';
import type { ExecutionSession } from '@logicpilot/contracts';

const target = {
  schema: 'logicpilot.execution-target/v1',
  contractVersion: 1,
  id: 'logicpilot.service.runtime',
  artifactRef: { artifactId: 'model.main', revisionId: 'rev-1' },
  runtime: { kind: 'interpreter', pluginId: 'logicpilot.service' },
  capabilities: { cancel: false, telemetry: false, snapshot: true },
} as const;

const request = {
  schema: 'logicpilot.execution-request/v1',
  contractVersion: 1,
  requestId: 'service-request-1',
  targetId: target.id,
  artifactRef: target.artifactRef,
  seed: 42,
} as const;

describe('ExecutionService', () => {
  it('recovers an unfinished persisted session as an explicit interruption', () => {
    let sessions: ExecutionSession[] = [
      {
        schema: 'logicpilot.execution-session/v1' as const,
        contractVersion: 1 as const,
        runId: 'old-run',
        requestId: 'old-request',
        targetId: target.id,
        status: 'running' as const,
        stateVersion: 2,
        capabilities: { cancel: false, telemetry: false, snapshot: true },
        createdAt: '2026-09-05T00:00:00.000Z',
      },
    ];
    const store = {
      list: () => sessions,
      upsert: (session: ExecutionSession) => {
        sessions = [session];
      },
    };
    const service = new ExecutionService({
      registry: new ExecutionTargetRegistry(),
      store,
    });
    const recovered = service.get('old-run');
    expect(recovered?.status).toBe('failed');
    expect(recovered?.error).toMatch(/interrupted/);
    expect(recovered?.stateVersion).toBe(3);
  });

  it('assigns one run id and makes identical request retries idempotent', async () => {
    const registry = new ExecutionTargetRegistry();
    let calls = 0;
    registry.register({
      target,
      execute: async (input) => {
        calls += 1;
        return {
          run: {
            schema: 'logicpilot.execution-run/v1',
            contractVersion: 1,
            runId: input.runId!,
            requestId: input.requestId,
            targetId: input.targetId,
            artifactRef: target.artifactRef,
            seed: input.seed,
            status: 'completed',
          },
        };
      },
    });
    const service = new ExecutionService({ registry });
    const first = await service.start(request);
    const second = await service.start(request);
    expect(second.runId).toBe(first.runId);
    expect(calls).toBe(1);
    await service.wait(first.runId);
    expect(service.get(first.runId)?.status).toBe('completed');
    const eventQuery = service.events(first.runId, -1);
    expect(eventQuery?.events.map((event) => event.kind)).toEqual(['state', 'terminal']);
    expect(eventQuery?.nextSeq).toBe(1);
    const received: string[] = [];
    const subscription = service.subscribe(first.runId, -1, (event) => received.push(event.kind));
    expect(subscription.initial?.events.length).toBe(2);
    subscription.unsubscribe();
    expect(received).toEqual([]);
  });

  it('rejects reuse of a request id with a different payload', async () => {
    const registry = new ExecutionTargetRegistry();
    registry.register({
      target,
      execute: async (input) => ({
        run: {
          schema: 'logicpilot.execution-run/v1',
          contractVersion: 1,
          runId: input.runId!,
          requestId: input.requestId,
          targetId: input.targetId,
          artifactRef: target.artifactRef,
          seed: input.seed,
          status: 'completed',
        },
      }),
    });
    const service = new ExecutionService({ registry });
    await service.start(request);
    await expect(service.start({ ...request, seed: 43 })).rejects.toThrow(/different payload/);
  });

  it('rejects a command that the provider did not declare', async () => {
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
            runId: input.runId!,
            requestId: input.requestId,
            targetId: input.targetId,
            artifactRef: target.artifactRef,
            seed: input.seed,
            status: 'completed',
          },
        };
      },
    });
    const service = new ExecutionService({ registry });
    const session = await service.start({ ...request, requestId: 'service-request-2' });
    const ack = await service.command({
      schema: 'logicpilot.execution-command/v1',
      contractVersion: 1,
      commandId: 'command-1',
      runId: session.runId,
      action: 'pause',
      expectedStateVersion: service.get(session.runId)!.stateVersion,
    });
    expect(ack.accepted).toBe(false);
    expect(ack.errorCode).toBe('capability-unsupported');
    release();
    await service.wait(session.runId);
  });
});
