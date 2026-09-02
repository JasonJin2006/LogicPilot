// PluginHost gate tests (plan §16 Phase 2): discovery layering, deterministic
// activation, capability grants, lifecycle/effect cleanup, audit log and the
// package manager install/upgrade/rollback flows.
import { describe, expect, it } from 'vitest';
import type { PluginLockfile, PluginManifest, PermissionGrant } from '@logicpilot/contracts';
import {
  AuditLog,
  PackageError,
  PackageManager,
  PluginHost,
  type DiscoveredPlugin,
  type DiscoverySource,
  type PluginModule,
} from '../src/index.js';

let manifestSeq = 0;

const TEST_SHA = 'a'.repeat(64);

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  manifestSeq += 1;
  return {
    schema: 'logicpilot.plugin-manifest/v2',
    contractVersion: 1,
    id: `logicpilot.test-${manifestSeq}`,
    version: '1.0.0',
    apiVersion: 1,
    provides: [],
    requires: [],
    entrypoints: {},
    permissions: [],
    trust: { minLevel: 't0' },
    integrity: { sha256: TEST_SHA },
    ...overrides,
  };
}

function source(
  scope: DiscoverySource['scope'],
  plugins: readonly DiscoveredPlugin[],
): DiscoverySource {
  return { scope, discover: () => plugins };
}

function discovered(
  manifest: PluginManifest,
  load: () => PluginModule | Promise<PluginModule> = () => ({ activate() {} }),
): DiscoveredPlugin {
  return { manifest, scope: 'workspace', load };
}

describe('PluginHost discovery', () => {
  it('merges system/user/workspace layers with later layers overriding by id', async () => {
    const sharedId = 'logicpilot.shared';
    const host = new PluginHost({
      sources: [
        {
          scope: 'system',
          discover: () => [discovered(makeManifest({ id: sharedId, version: '1.0.0' }))],
        },
        {
          scope: 'user',
          discover: () => [
            discovered(makeManifest({ id: sharedId, version: '2.0.0' })),
            discovered(makeManifest({ id: 'logicpilot.user-only' })),
          ],
        },
      ],
    });
    const found = await host.discover();
    const ids = found.map((plugin) => plugin.manifest.id).sort();
    expect(ids).toEqual(['logicpilot.shared', 'logicpilot.user-only']);
    expect(host.manifestOf(sharedId)?.version).toBe('2.0.0');
  });

  it('skips plugins with unsupported apiVersion and records the denial', async () => {
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(makeManifest({ apiVersion: 99 })),
          discovered(makeManifest()),
        ]),
      ],
    });
    const found = await host.discover();
    expect(found).toHaveLength(1);
    expect(host.auditLog.list().some((entry) => entry.action === 'deny')).toBe(true);
  });

  it('rejects duplicate ids within the same scope', async () => {
    const manifest = makeManifest();
    const host = new PluginHost({
      sources: [source('workspace', [discovered(manifest), discovered(manifest)])],
    });
    await expect(host.discover()).rejects.toMatchObject({ code: 'duplicate-id' });
  });

  it('discovers every source registered for the same scope', async () => {
    const host = new PluginHost({
      sources: [
        source('system', [discovered(makeManifest({ id: 'logicpilot.one' }))]),
        source('system', [discovered(makeManifest({ id: 'logicpilot.two' }))]),
      ],
    });
    await expect(host.discover()).resolves.toHaveLength(2);
  });

  it('rejects malformed manifests at the host boundary', async () => {
    const malformed = { ...makeManifest(), schema: 'wrong' } as PluginManifest;
    const host = new PluginHost({
      sources: [source('workspace', [discovered(malformed)])],
    });
    await expect(host.discover()).rejects.toMatchObject({ code: 'invalid-manifest' });
  });
});

describe('PluginHost activation', () => {
  it('activates dependencies first in deterministic order', async () => {
    const order: string[] = [];
    const load = (id: string) => (): PluginModule => ({
      activate() {
        order.push(id);
      },
    });
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(
            makeManifest({ id: 'logicpilot.a', requires: [{ id: 'logicpilot.b' }] }),
            load('a'),
          ),
          discovered(makeManifest({ id: 'logicpilot.b' }), load('b')),
          discovered(makeManifest({ id: 'logicpilot.c' }), load('c')),
        ]),
      ],
    });
    const activated = await host.start();
    expect(order).toEqual(['b', 'a', 'c']);
    expect(activated).toEqual(['logicpilot.b', 'logicpilot.a', 'logicpilot.c']);
  });

  it('rejects missing non-optional dependencies', async () => {
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(makeManifest({ requires: [{ id: 'logicpilot.missing' }] })),
        ]),
      ],
    });
    await expect(host.start()).rejects.toMatchObject({ code: 'missing-dependency' });
  });

  it('rejects dependency cycles', async () => {
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(makeManifest({ id: 'logicpilot.x', requires: [{ id: 'logicpilot.y' }] })),
          discovered(makeManifest({ id: 'logicpilot.y', requires: [{ id: 'logicpilot.x' }] })),
        ]),
      ],
    });
    await expect(host.start()).rejects.toMatchObject({ code: 'dependency-cycle' });
  });

  it('rejects unsatisfied version ranges', async () => {
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(
            makeManifest({
              id: 'logicpilot.consumer',
              requires: [{ id: 'logicpilot.lib', range: '^2.0.0' }],
            }),
          ),
          discovered(makeManifest({ id: 'logicpilot.lib', version: '1.0.0' })),
        ]),
      ],
    });
    await expect(host.start()).rejects.toMatchObject({ code: 'version-conflict' });
  });

  it('rolls back earlier plugins and the failing activation scope', async () => {
    const cleanup: string[] = [];
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(makeManifest({ id: 'logicpilot.base' }), () => ({
            activate(ctx) {
              ctx.effect(() => cleanup.push('base'));
            },
          })),
          discovered(
            makeManifest({
              id: 'logicpilot.failing',
              requires: [{ id: 'logicpilot.base' }],
            }),
            () => ({
              activate(ctx) {
                ctx.effect(() => cleanup.push('failing'));
                throw new Error('activation failed');
              },
            }),
          ),
        ]),
      ],
    });
    await expect(host.start()).rejects.toThrow('activation failed');
    expect(cleanup).toEqual(['failing', 'base']);
    expect(host.ids()).toEqual([]);
    expect(host.phaseValue).toBe('stopped');
  });
});

describe('capability grants and trust', () => {
  const grant = (permissionId: string, granted = true): PermissionGrant => ({
    permissionId,
    granted,
  });

  it('filters grants to requested permissions only', async () => {
    let seenGrants: readonly PermissionGrant[] = [];
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(
            makeManifest({ id: 'logicpilot.g', permissions: ['knowledge.draft.write'] }),
            () => ({
              activate(ctx) {
                seenGrants = ctx.grants;
              },
            }),
          ),
        ]),
      ],
      grants: new Map([
        ['logicpilot.g', [grant('knowledge.draft.write'), grant('plugin.install')]],
      ]),
    });
    await host.start();
    expect(seenGrants.map((g) => g.permissionId)).toEqual(['knowledge.draft.write']);
    expect(host.auditLog.forPlugin('logicpilot.g').some((e) => e.action === 'deny')).toBe(true);
  });

  it('rejects plugins below the required trust level', async () => {
    const host = new PluginHost({
      sources: [source('workspace', [discovered(makeManifest({ trust: { minLevel: 't3' } }))])],
      defaultTrustLevel: 't1',
    });
    await expect(host.start()).rejects.toMatchObject({ code: 'trust-denied' });
  });

  it('honors per-plugin trust overrides', async () => {
    const manifest = makeManifest({ trust: { minLevel: 't3' } });
    const host = new PluginHost({
      sources: [source('workspace', [discovered(manifest)])],
      defaultTrustLevel: 't1',
      trustOverrides: new Map([[manifest.id, 't4']]),
    });
    // Override satisfies the requirement.
    await expect(host.start()).resolves.toHaveLength(1);
  });
});

describe('lifecycle: services, events, effects', () => {
  it('cleans up effects and subscriptions on stop in reverse order', async () => {
    const cleanupOrder: string[] = [];
    const received: string[] = [];
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(makeManifest({ id: 'logicpilot.fx' }), () => ({
            activate(ctx) {
              ctx.effect(() => cleanupOrder.push('effect-1'));
              ctx.effect(() => cleanupOrder.push('effect-2'));
              ctx.on('ping', () => received.push('ping'));
              ctx.provide('answer', 42);
            },
          })),
        ]),
      ],
    });
    await host.start();
    expect(host.isActive('logicpilot.fx')).toBe(true);
    await host.stop('logicpilot.fx');
    expect(cleanupOrder).toEqual(['effect-2', 'effect-1']);
    expect(host.isActive('logicpilot.fx')).toBe(false);
  });

  it('lets plugins consume services provided by other plugins', async () => {
    let answer = 0;
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(makeManifest({ id: 'logicpilot.provider' }), () => ({
            activate(ctx) {
              ctx.provide('answer', 42);
            },
          })),
          discovered(
            makeManifest({ id: 'logicpilot.consumer', requires: [{ id: 'logicpilot.provider' }] }),
            () => ({
              activate(ctx) {
                answer = ctx.service<number>('answer');
              },
            }),
          ),
        ]),
      ],
    });
    await host.start();
    expect(answer).toBe(42);
    await expect(host.stop('logicpilot.provider')).rejects.toMatchObject({
      code: 'dependent-active',
    });
    await host.stop('logicpilot.consumer');
    await expect(host.stop('logicpilot.provider')).resolves.toBeUndefined();
  });

  it('runs stopAll in reverse activation order', async () => {
    const stops: string[] = [];
    const host = new PluginHost({
      sources: [
        source('workspace', [
          discovered(makeManifest({ id: 'logicpilot.first' }), () => ({
            activate() {},
            deactivate() {
              stops.push('first');
            },
          })),
          discovered(makeManifest({ id: 'logicpilot.second' }), () => ({
            activate() {},
            deactivate() {
              stops.push('second');
            },
          })),
        ]),
      ],
    });
    await host.start();
    await host.stopAll();
    expect(stops).toEqual(['second', 'first']);
    expect(host.phaseValue).toBe('stopped');
  });
});

describe('audit log', () => {
  it('is append-only and monotonically increasing', () => {
    const audit = new AuditLog();
    const first = audit.append('discover', 'a');
    const second = audit.append('activate', 'a');
    expect(second.seq).toBe(first.seq + 1);
    expect(audit.list()).toHaveLength(2);
    expect(audit.forPlugin('a')).toHaveLength(2);
  });

  it('notifies the onAudit hook for every entry', async () => {
    const events: string[] = [];
    const host = new PluginHost({
      sources: [source('workspace', [discovered(makeManifest())])],
      onAudit: (entry) => events.push(entry.action),
    });
    await host.start();
    expect(events).toContain('discover');
    expect(events).toContain('activate');
  });
});

describe('PackageManager', () => {
  function makeManager() {
    let saved: import('@logicpilot/contracts').PluginLockfile | null = null;
    let snapshot: import('@logicpilot/contracts').PluginLockfile | null = null;
    const audit = new AuditLog();
    const manager = new PackageManager(
      {
        readLockfile: () => saved,
        writeLockfile: (lockfile) => {
          saved = lockfile;
        },
        snapshotLockfile: () => {
          snapshot = saved;
        },
        readSnapshot: () => snapshot,
      },
      audit,
    );
    return { manager, audit };
  }

  it('installs a valid manifest and writes a lockfile entry', async () => {
    const { manager } = makeManager();
    const entry = await manager.install({ manifestJson: makeManifest({ id: 'logicpilot.p1' }) });
    expect(entry.id).toBe('logicpilot.p1');
    expect(entry.sha256).toBe(TEST_SHA);
    expect(await manager.installedIds()).toEqual(['logicpilot.p1']);
  });

  it('uses the store version token for an optimistic conditional write', async () => {
    let saved: PluginLockfile | null = null;
    let version: string | null = null;
    let conditionalWrites = 0;
    const manager = new PackageManager(
      {
        readLockfile: () => saved,
        readLockfileState: () => ({ lockfile: saved, version }),
        writeLockfile: (lockfile) => {
          saved = lockfile;
        },
        readLockfileVersion: () => version,
        writeLockfileIfVersion: (lockfile, expected) => {
          expect(expected).toBe(version);
          saved = lockfile;
          version = `v${++conditionalWrites}`;
        },
      },
      new AuditLog(),
    );
    await manager.install({ manifestJson: makeManifest({ id: 'logicpilot.cas' }) });
    expect(conditionalWrites).toBe(1);
    expect(saved?.plugins[0]?.id).toBe('logicpilot.cas');
  });

  it('rejects manifests that fail contract validation', async () => {
    const { manager } = makeManager();
    await expect(manager.install({ manifestJson: { id: 'not-a-manifest' } })).rejects.toMatchObject(
      { code: 'invalid-manifest' },
    );
  });

  it('rejects double install and requires integrity or manifest digest', async () => {
    const { manager } = makeManager();
    await manager.install({ manifestJson: makeManifest({ id: 'logicpilot.p1' }) });
    await expect(
      manager.install({ manifestJson: makeManifest({ id: 'logicpilot.p1' }) }),
    ).rejects.toMatchObject({ code: 'already-installed' });
    const manifest = makeManifest({ id: 'logicpilot.p2' });
    const { integrity, ...withoutIntegrity } = manifest;
    void integrity;
    await expect(manager.install({ manifestJson: withoutIntegrity })).rejects.toMatchObject({
      code: 'integrity-missing',
    });
    await manager.install({ manifestJson: manifest, sha256: TEST_SHA });
  });

  it('rejects installs that would create dependency cycles or missing deps', async () => {
    const { manager } = makeManager();
    await expect(
      manager.install({
        manifestJson: makeManifest({ id: 'logicpilot.p1', requires: [{ id: 'logicpilot.ghost' }] }),
      }),
    ).rejects.toMatchObject({ code: 'dependency' });
  });

  it('rejects install and upgrade operations that violate dependency versions', async () => {
    const { manager } = makeManager();
    await manager.install({
      manifestJson: makeManifest({ id: 'logicpilot.lib', version: '1.0.0' }),
    });
    await expect(
      manager.install({
        manifestJson: makeManifest({
          id: 'logicpilot.bad-app',
          requires: [{ id: 'logicpilot.lib', range: '^2.0.0' }],
        }),
      }),
    ).rejects.toMatchObject({ code: 'dependency' });
    await manager.install({
      manifestJson: makeManifest({
        id: 'logicpilot.app',
        requires: [{ id: 'logicpilot.lib', range: '^1.0.0' }],
      }),
    });
    await expect(
      manager.upgrade({
        manifestJson: makeManifest({ id: 'logicpilot.lib', version: '2.0.0' }),
      }),
    ).rejects.toMatchObject({ code: 'dependency' });
  });

  it('upgrades forward only and blocks uninstall while depended on', async () => {
    const { manager } = makeManager();
    await manager.install({
      manifestJson: makeManifest({ id: 'logicpilot.lib', version: '1.0.0' }),
    });
    await manager.install({
      manifestJson: makeManifest({ id: 'logicpilot.app', requires: [{ id: 'logicpilot.lib' }] }),
    });
    await expect(manager.uninstall('logicpilot.lib')).rejects.toMatchObject({ code: 'dependency' });
    await manager.upgrade({
      manifestJson: makeManifest({ id: 'logicpilot.lib', version: '1.1.0' }),
    });
    await expect(
      manager.upgrade({ manifestJson: makeManifest({ id: 'logicpilot.lib', version: '1.1.0' }) }),
    ).rejects.toMatchObject({ code: 'invalid-manifest' });
  });

  it('rolls back to the previous snapshot after an upgrade', async () => {
    const { manager } = makeManager();
    await manager.install({
      manifestJson: makeManifest({ id: 'logicpilot.p1', version: '1.0.0' }),
    });
    await manager.upgrade({
      manifestJson: makeManifest({ id: 'logicpilot.p1', version: '2.0.0' }),
    });
    expect((await manager.lockfile()).plugins[0]?.version).toBe('2.0.0');
    const restored = await manager.rollback();
    expect(restored).toBe(true);
    expect((await manager.lockfile()).plugins[0]?.version).toBe('1.0.0');
  });

  it('requires a fresh upgrade digest and drops obsolete permission grants', async () => {
    const { manager } = makeManager();
    await manager.install({
      manifestJson: makeManifest({
        id: 'logicpilot.secure',
        permissions: ['knowledge.draft.write', 'view.draft.write'],
      }),
      grants: [
        { permissionId: 'knowledge.draft.write', granted: true },
        { permissionId: 'view.draft.write', granted: true },
      ],
    });
    const upgrade = makeManifest({
      id: 'logicpilot.secure',
      version: '2.0.0',
      permissions: ['knowledge.draft.write'],
    });
    const { integrity, ...withoutIntegrity } = upgrade;
    void integrity;
    await expect(manager.upgrade({ manifestJson: withoutIntegrity })).rejects.toMatchObject({
      code: 'integrity-missing',
    });
    await manager.upgrade({ manifestJson: upgrade });
    expect((await manager.lockfile()).plugins[0]?.permissions).toEqual([
      { permissionId: 'knowledge.draft.write', granted: true },
    ]);
  });

  it('records grant decisions in the audit log', async () => {
    const { manager, audit } = makeManager();
    await manager.install({
      manifestJson: makeManifest({ id: 'logicpilot.p1', permissions: ['knowledge.draft.write'] }),
    });
    await manager.setGrant('logicpilot.p1', {
      permissionId: 'knowledge.draft.write',
      granted: true,
    });
    expect(audit.forPlugin('logicpilot.p1').some((entry) => entry.action === 'grant')).toBe(true);
  });

  it('throws typed errors for unknown plugins', async () => {
    const { manager } = makeManager();
    await expect(manager.uninstall('logicpilot.ghost')).rejects.toBeInstanceOf(PackageError);
    await expect(
      manager.setGrant('logicpilot.ghost', { permissionId: 'plugin.install', granted: true }),
    ).rejects.toBeInstanceOf(PackageError);
  });
});
