import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionClient } from './executionClient';

const session = {
  schema: 'logicpilot.execution-session/v1' as const,
  contractVersion: 1 as const,
  runId: 'run-1',
  requestId: 'request-1',
  targetId: 'logicpilot.native.session',
  status: 'running' as const,
  stateVersion: 0,
  capabilities: { cancel: true, telemetry: true, snapshot: true },
  createdAt: '2026-09-06T00:00:00.000Z',
};

afterEach(() => vi.restoreAllMocks());

describe('ExecutionClient', () => {
  it('uses the unified start/query/command HTTP envelope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && JSON.parse(String(init.body)).action === 'start')
        return new Response(JSON.stringify({ session }), { status: 202 });
      if (init?.method === 'POST')
        return new Response(
          JSON.stringify({
            schema: 'logicpilot.execution-command-ack/v1',
            contractVersion: 1,
            commandId: 'command-1',
            runId: 'run-1',
            accepted: true,
            stateVersion: 1,
            status: 'paused',
          }),
          { status: 200 },
        );
      expect(url).toContain('/api/execution/runs/run-1?afterSeq=-1');
      return new Response(
        JSON.stringify({
          schema: 'logicpilot.execution-session-query/v1',
          contractVersion: 1,
          session,
          events: [],
          nextSeq: 0,
          gap: false,
        }),
        { status: 200 },
      );
    });
    const client = createExecutionClient();
    expect(
      await client.start({
        requestId: 'request-1',
        targetId: session.targetId,
        inputs: { dsl: 'model X {}' },
      }),
    ).toEqual(session);
    expect((await client.query('run-1')).session.runId).toBe('run-1');
    expect(
      (
        await client.command({
          schema: 'logicpilot.execution-command/v1',
          contractVersion: 1,
          commandId: 'command-1',
          runId: 'run-1',
          action: 'pause',
          expectedStateVersion: 0,
        })
      ).accepted,
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('lists sessions through the execution service collection route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schema: 'logicpilot.execution-runs/v1',
          contractVersion: 1,
          sessions: [session],
        }),
        { status: 200 },
      ),
    );
    await expect(createExecutionClient().listRuns()).resolves.toEqual([session]);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('/api/execution/runs');
  });

  it('surfaces structured HTTP errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'state-version-mismatch' }), { status: 409 }),
    );
    await expect(createExecutionClient().query('run-1')).rejects.toThrow('state-version-mismatch');
  });
});
