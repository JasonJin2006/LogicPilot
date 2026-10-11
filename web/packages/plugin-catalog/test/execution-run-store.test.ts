import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExecutionSession } from '@logicpilot/contracts';
import { FileSystemExecutionRunStore } from '../src/index.js';

const roots: string[] = [];

function session(runId: string, status: ExecutionSession['status'] = 'queued'): ExecutionSession {
  return {
    schema: 'logicpilot.execution-session/v1',
    contractVersion: 1,
    runId,
    requestId: 'request-' + runId,
    targetId: 'logicpilot.test.target',
    status,
    stateVersion: 0,
    capabilities: { cancel: false, telemetry: false, snapshot: true },
    createdAt: '2026-09-05T00:00:00.000Z',
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('FileSystemExecutionRunStore', () => {
  it('atomically upserts sessions and reloads them in a new store instance', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-execution-store-'));
    roots.push(root);
    const first = new FileSystemExecutionRunStore({ rootDir: root });
    first.upsert(session('run-1'));
    first.upsert(session('run-1', 'completed'));
    first.upsert(session('run-2'));
    const second = new FileSystemExecutionRunStore({ rootDir: root });
    expect(second.list().map((item) => [item.runId, item.status])).toEqual([
      ['run-1', 'completed'],
      ['run-2', 'queued'],
    ]);
  });

  it('rejects malformed persisted sessions', () => {
    const root = mkdtempSync(join(tmpdir(), 'logicpilot-execution-store-'));
    roots.push(root);
    const store = new FileSystemExecutionRunStore({ rootDir: root });
    expect(() => store.upsert({ ...session('run-1'), status: 'not-a-state' } as never)).toThrow(
      /execution session is invalid/,
    );
  });
});
