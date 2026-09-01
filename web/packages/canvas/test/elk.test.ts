import { afterEach, describe, expect, it, vi } from 'vitest';
import { runElkLayout, type ElkLike } from '../src/layout/elk';

const result = { children: [{ id: 'node', x: 1, y: 2 }] };

function elkReturning(value: unknown): ElkLike {
  return {
    layout: vi.fn(async () => value),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runElkLayout', () => {
  it('uses the bundled implementation silently when Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const createWorkerElk = vi.fn(() => elkReturning(result));
    const createBundledElk = vi.fn(async () => elkReturning(result));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      runElkLayout({ graph: { id: 'root' }, createWorkerElk, createBundledElk }),
    ).resolves.toEqual(result);

    expect(createWorkerElk).not.toHaveBeenCalled();
    expect(createBundledElk).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs and falls back when an available Worker fails at runtime', async () => {
    vi.stubGlobal('Worker', class Worker {});
    const failure = new Error('worker blocked by policy');
    const createWorkerElk = vi.fn(() => {
      throw failure;
    });
    const createBundledElk = vi.fn(async () => elkReturning(result));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      runElkLayout({ graph: { id: 'root' }, createWorkerElk, createBundledElk }),
    ).resolves.toEqual(result);

    expect(createWorkerElk).toHaveBeenCalledOnce();
    expect(createBundledElk).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[canvas] ELK worker failed, falling back to main thread',
      failure,
    );
  });
});
