import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginManifest } from '@logicpilot/contracts';
import { computePackageDigest, NodePluginRuntime } from '../src/index.js';

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true });
});

describe('NodePluginRuntime', () => {
  it('scans, dynamically loads and activates a package through PluginHost', async () => {
    const root = mkdtempSync(join(process.cwd(), '.node-runtime-'));
    cleanups.push(root);
    const pkg = join(root, 'runtime-plugin');
    mkdirSync(pkg);
    const manifest = {
      schema: 'logicpilot.plugin-manifest/v2',
      contractVersion: 1,
      id: 'logicpilot.runtime-plugin',
      version: '1.0.0',
      apiVersion: 1,
      provides: [],
      requires: [],
      entrypoints: { node: './activate.mjs' },
      permissions: [],
      trust: { minLevel: 't0' },
    } as PluginManifest;
    writeFileSync(
      join(pkg, 'activate.mjs'),
      'export function activate(ctx) { ctx.provide("ok", true); }',
    );
    writeFileSync(join(pkg, 'plugin.json'), JSON.stringify(manifest));
    // The scanner computes this digest and the dynamic loader verifies the
    // same manifest-bound value end to end.
    const digest = computePackageDigest(pkg, manifest);
    const runtime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
    });
    const host = await runtime.start();
    expect(host.phaseValue).toBe('active');
    expect(host.isActive('logicpilot.runtime-plugin')).toBe(true);
    expect(host.manifestOf('logicpilot.runtime-plugin')?.id).toBe(manifest.id);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    let changes = 0;
    const unsubscribe = runtime.subscribe(() => {
      changes += 1;
    });
    const stopWatch = runtime.watch(100);
    writeFileSync(
      join(pkg, 'activate.mjs'),
      'export function activate(ctx) { ctx.provide("ok", false); }',
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    stopWatch();
    unsubscribe();
    expect(changes).toBeGreaterThanOrEqual(1);
    await runtime.stop();
    expect(host.phaseValue).toBe('stopped');

    const lockedOut = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      requireLockfile: true,
      lockfile: {
        schema: 'logicpilot.plugin-lock/v1',
        contractVersion: 1,
        plugins: [
          {
            id: manifest.id,
            version: manifest.version,
            apiVersion: manifest.apiVersion,
            sha256: 'a'.repeat(64),
            trust: 't4',
            permissions: [],
          },
        ],
      },
    });
    const deniedHost = await lockedOut.start();
    expect(deniedHost.isActive(manifest.id)).toBe(false);
    await lockedOut.stop();

    const currentDigest = computePackageDigest(join(root, 'runtime-plugin'), manifest);
    const approvedRuntime = new NodePluginRuntime({
      roots: [{ scope: 'workspace', path: root }],
      defaultTrustLevel: 't4',
      requireLockfile: true,
      lockfile: {
        schema: 'logicpilot.plugin-lock/v1',
        contractVersion: 1,
        plugins: [
          {
            id: manifest.id,
            version: manifest.version,
            apiVersion: manifest.apiVersion,
            sha256: currentDigest,
            source: 'local-upload',
            trust: 't4',
            permissions: [],
          },
        ],
      },
    });
    const approvedHost = await approvedRuntime.start();
    expect(approvedHost.isActive(manifest.id)).toBe(true);
    await approvedRuntime.stop();
  });
});
