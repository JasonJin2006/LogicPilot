// PackageManager (plan §16 Phase 2): install / uninstall / upgrade / rollback
// on top of the frozen PluginManifest v2 and PluginLockfile contracts, with a
// persistent permission-grant table and an append-only audit trail.
//
// Storage is injected: the host package never touches the filesystem or
// IndexedDB itself - shells provide an ObjectStore for their environment.

import type {
  PluginLockEntry,
  PluginLockfile,
  PluginManifest,
  PermissionGrant,
} from '@logicpilot/contracts';
import type { AuditAction, AuditLog } from './host.js';
import {
  isSupportedPluginApiVersion,
  resolveActivationOrder,
  satisfiesRange,
  validateContract,
} from '@logicpilot/contracts';

export interface PackageStore {
  /** Read the whole lockfile, or null when absent. */
  readLockfile(): PluginLockfile | null | Promise<PluginLockfile | null>;
  /** Optional atomic read of the lockfile and its optimistic version token. */
  readLockfileState?():
    | { readonly lockfile: PluginLockfile | null; readonly version: string | null }
    | Promise<{ readonly lockfile: PluginLockfile | null; readonly version: string | null }>;
  writeLockfile(lockfile: PluginLockfile): void | Promise<void>;
  /** Optional optimistic-concurrency token for a lockfile snapshot. */
  readLockfileVersion?(): string | null | Promise<string | null>;
  writeLockfileIfVersion?(
    lockfile: PluginLockfile,
    expectedVersion: string | null,
  ): void | Promise<void>;
  /** Optional rollback snapshot kept by the store itself. */
  snapshotLockfile?(): void | Promise<void>;
  readSnapshot?(): PluginLockfile | null | Promise<PluginLockfile | null>;
  /** Optional durable append-only audit sink. */
  appendAudit?(entry: {
    readonly seq: number;
    readonly timestamp: string;
    readonly action: AuditAction;
    readonly pluginId?: string;
    readonly detail?: string;
  }): void | Promise<void>;
  /** Optional package-tree transaction hooks. Implementations must stage and
   * validate a package before commit, then keep the previous tree available
   * until finalizePackage is called. */
  stagePackage?(input: {
    readonly pluginId: string;
    readonly sourcePath: string;
    readonly manifest: PluginManifest;
    readonly sha256: string;
    readonly operation: 'install' | 'upgrade';
  }): unknown | Promise<unknown>;
  commitPackage?(stage: unknown): unknown | Promise<unknown>;
  prepareRemovePackage?(pluginId: string): unknown | Promise<unknown>;
  finalizePackage?(commit: unknown): void | Promise<void>;
  rollbackPackage?(commit: unknown): void | Promise<void>;
}

export interface InstallInput {
  /** Raw manifest JSON as found in the package's plugin.json. */
  readonly manifestJson: unknown;
  /** Content digest of the package payload (sha256 hex). Required unless the
   *  manifest already carries integrity information. */
  readonly sha256?: string;
  readonly source?: string;
  /** Optional local package directory. Stores that implement tree
   * transactions copy it into their controlled package root. */
  readonly packagePath?: string;
  /** Permission grants approved by the user for this install. */
  readonly grants?: readonly PermissionGrant[];
}

export class PackageError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-manifest'
      | 'already-installed'
      | 'not-installed'
      | 'api-version'
      | 'dependency'
      | 'integrity-missing'
      | 'invalid-lockfile'
      | 'storage',
  ) {
    super(message);
    this.name = 'PackageError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class PackageManager {
  constructor(
    private readonly store: PackageStore,
    private readonly audit: AuditLog,
  ) {}

  async lockfile(): Promise<PluginLockfile> {
    return (await this.readState()).lockfile;
  }

  private async readState(): Promise<{
    lockfile: PluginLockfile;
    version: string | null;
  }> {
    const state = this.store.readLockfileState
      ? await this.store.readLockfileState()
      : {
          lockfile: await this.store.readLockfile(),
          version: this.store.readLockfileVersion ? await this.store.readLockfileVersion() : null,
        };
    const stored = state.lockfile;
    if (stored === null) {
      return {
        lockfile: { schema: 'logicpilot.plugin-lock/v1', contractVersion: 1, plugins: [] },
        version: state.version,
      };
    }
    const validated = validateContract('PluginLockfile', stored);
    if (!validated.ok) {
      throw new PackageError(
        `invalid lockfile: ${validated.errors.join('; ')}`,
        'invalid-lockfile',
      );
    }
    return { lockfile: validated.value, version: state.version };
  }

  private async write(lockfile: PluginLockfile, expectedVersion: string | null): Promise<void> {
    if (this.store.writeLockfileIfVersion) {
      await this.store.writeLockfileIfVersion(lockfile, expectedVersion);
      return;
    }
    await this.store.writeLockfile(lockfile);
  }

  private async record(action: AuditAction, pluginId?: string, detail?: string): Promise<void> {
    const entry = this.audit.append(action, pluginId, detail);
    await this.store.appendAudit?.(entry);
  }

  private async preparePackage(
    input: InstallInput,
    manifest: PluginManifest,
    sha256: string,
    operation: 'install' | 'upgrade',
  ): Promise<unknown | null> {
    if (input.packagePath === undefined) return null;
    if (!this.store.stagePackage || !this.store.commitPackage) {
      throw new PackageError('package store does not support directory transactions', 'storage');
    }
    try {
      const stage = await this.store.stagePackage({
        pluginId: manifest.id,
        sourcePath: input.packagePath,
        manifest,
        sha256,
        operation,
      });
      return await this.store.commitPackage(stage);
    } catch (error) {
      throw new PackageError(
        `cannot stage package '${manifest.id}': ${(error as Error).message}`,
        'storage',
      );
    }
  }

  private async finalizePackage(commit: unknown): Promise<void> {
    await this.store.finalizePackage?.(commit);
  }

  private async rollbackPackage(commit: unknown): Promise<void> {
    await this.store.rollbackPackage?.(commit);
  }

  async installedIds(): Promise<readonly string[]> {
    return (await this.lockfile()).plugins.map((entry) => entry.id);
  }

  /** Validates and installs a plugin package. */
  async install(input: InstallInput): Promise<PluginLockEntry> {
    const validated = validateContract('PluginManifest', input.manifestJson);
    if (!validated.ok) {
      throw new PackageError(
        `invalid manifest: ${validated.errors.join('; ')}`,
        'invalid-manifest',
      );
    }
    const manifest: PluginManifest = validated.value;
    const state = await this.readState();
    const lock = state.lockfile;

    if (lock.plugins.some((entry) => entry.id === manifest.id)) {
      throw new PackageError(`plugin '${manifest.id}' is already installed`, 'already-installed');
    }
    if (!isSupportedPluginApiVersion(manifest.apiVersion)) {
      await this.record(
        'deny',
        manifest.id,
        `install: unsupported apiVersion ${manifest.apiVersion}`,
      );
      throw new PackageError(`unsupported apiVersion ${manifest.apiVersion}`, 'api-version');
    }

    const sha256 = manifest.integrity?.sha256 ?? input.sha256;
    if (!sha256) {
      throw new PackageError(
        `plugin '${manifest.id}' has no integrity digest and none was provided`,
        'integrity-missing',
      );
    }

    // The resulting dependency graph must resolve with the new entry added.
    const projected: PluginLockEntry = {
      id: manifest.id,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      sha256,
      ...(input.source !== undefined ? { source: input.source } : {}),
      trust: 't0',
      permissions: (input.grants ?? []).filter((grant) =>
        manifest.permissions.includes(grant.permissionId),
      ),
      dependencies: manifest.requires,
    };
    const nextEntries = [...lock.plugins, projected];
    const resolution = resolveActivationOrder(nextEntries.map(toLockResolution));
    if (!resolution.ok) {
      throw new PackageError(
        `installing '${manifest.id}' breaks dependency resolution: missing=[${resolution.missing.join(', ')}] cycles=[${resolution.cycles.join(', ')}]`,
        'dependency',
      );
    }
    assertDependencyVersions(nextEntries, `installing '${manifest.id}'`);

    const packageCommit = await this.preparePackage(input, manifest, sha256, 'install');
    try {
      await this.write(
        {
          schema: 'logicpilot.plugin-lock/v1',
          contractVersion: 1,
          plugins: [...lock.plugins, projected].sort((a, b) => (a.id < b.id ? -1 : 1)),
        },
        state.version,
      );
    } catch (error) {
      if (packageCommit !== null) await this.rollbackPackage(packageCommit);
      throw error;
    }
    if (packageCommit !== null) await this.finalizePackage(packageCommit);
    await this.record('install', manifest.id, `version=${manifest.version}`);
    return projected;
  }

  /** Upgrades an installed plugin, validating its manifest and migration path. */
  async upgrade(input: InstallInput): Promise<PluginLockEntry> {
    const validated = validateContract('PluginManifest', input.manifestJson);
    if (!validated.ok) {
      throw new PackageError(
        `invalid manifest: ${validated.errors.join('; ')}`,
        'invalid-manifest',
      );
    }
    const manifest: PluginManifest = validated.value;
    const state = await this.readState();
    const lock = state.lockfile;
    const current = lock.plugins.find((entry) => entry.id === manifest.id);
    if (!current) {
      throw new PackageError(`plugin '${manifest.id}' is not installed`, 'not-installed');
    }
    if (!isSupportedPluginApiVersion(manifest.apiVersion)) {
      await this.record(
        'deny',
        manifest.id,
        `upgrade: unsupported apiVersion ${manifest.apiVersion}`,
      );
      throw new PackageError(`unsupported apiVersion ${manifest.apiVersion}`, 'api-version');
    }
    // Version must move forward; equal or downgrades are rejected (rollback is
    // the dedicated path for going back).
    if (compareVersions(manifest.version, current.version) <= 0) {
      throw new PackageError(
        `upgrade must move forward: ${current.version} -> ${manifest.version}`,
        'invalid-manifest',
      );
    }
    const sha256 = manifest.integrity?.sha256 ?? input.sha256;
    if (!sha256) {
      throw new PackageError(
        `plugin '${manifest.id}' upgrade has no integrity digest`,
        'integrity-missing',
      );
    }

    const permissionDecisions = new Map(
      current.permissions
        .filter((grant) => manifest.permissions.includes(grant.permissionId))
        .map((grant) => [grant.permissionId, grant]),
    );
    for (const grant of input.grants ?? []) {
      if (manifest.permissions.includes(grant.permissionId)) {
        permissionDecisions.set(grant.permissionId, grant);
      }
    }

    const next: PluginLockEntry = {
      ...current,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      sha256,
      ...(input.source !== undefined ? { source: input.source } : {}),
      permissions: [...permissionDecisions.values()],
      dependencies: manifest.requires,
    };
    const others = lock.plugins.filter((entry) => entry.id !== manifest.id);
    const resolution = resolveActivationOrder([next, ...others].map(toLockResolution));
    if (!resolution.ok) {
      throw new PackageError(
        `upgrading '${manifest.id}' breaks dependency resolution: missing=[${resolution.missing.join(', ')}] cycles=[${resolution.cycles.join(', ')}]`,
        'dependency',
      );
    }
    assertDependencyVersions([next, ...others], `upgrading '${manifest.id}'`);
    await this.store.snapshotLockfile?.();
    const packageCommit = await this.preparePackage(input, manifest, sha256, 'upgrade');
    try {
      await this.write(
        {
          schema: 'logicpilot.plugin-lock/v1',
          contractVersion: 1,
          plugins: [next, ...others].sort((a, b) => (a.id < b.id ? -1 : 1)),
        },
        state.version,
      );
    } catch (error) {
      if (packageCommit !== null) await this.rollbackPackage(packageCommit);
      throw error;
    }
    if (packageCommit !== null) await this.finalizePackage(packageCommit);
    await this.record('upgrade', manifest.id, `${current.version} -> ${manifest.version}`);
    return next;
  }

  async uninstall(pluginId: string): Promise<void> {
    const state = await this.readState();
    const lock = state.lockfile;
    const current = lock.plugins.find((entry) => entry.id === pluginId);
    if (!current) {
      throw new PackageError(`plugin '${pluginId}' is not installed`, 'not-installed');
    }
    // Reject when another installed plugin non-optionally depends on it.
    for (const entry of lock.plugins) {
      if (entry.id === pluginId) continue;
      for (const dep of entry.dependencies ?? []) {
        if (dep.id === pluginId && !dep.optional) {
          throw new PackageError(
            `cannot uninstall '${pluginId}': required by '${entry.id}'`,
            'dependency',
          );
        }
      }
    }
    await this.store.snapshotLockfile?.();
    let packageCommit: unknown | null = null;
    if (this.store.prepareRemovePackage) {
      try {
        packageCommit = await this.store.prepareRemovePackage(pluginId);
      } catch (error) {
        throw new PackageError(
          `cannot stage removal of '${pluginId}': ${(error as Error).message}`,
          'storage',
        );
      }
    }
    try {
      await this.write(
        {
          schema: 'logicpilot.plugin-lock/v1',
          contractVersion: 1,
          plugins: lock.plugins.filter((entry) => entry.id !== pluginId),
        },
        state.version,
      );
    } catch (error) {
      if (packageCommit !== null) await this.rollbackPackage(packageCommit);
      throw error;
    }
    if (packageCommit !== null) await this.finalizePackage(packageCommit);
    await this.record('uninstall', pluginId, `version=${current.version}`);
  }

  /** Restores the previous lockfile snapshot (best effort). */
  async rollback(): Promise<boolean> {
    if (!this.store.snapshotLockfile) return false;
    // Snapshotting semantics are store-defined; the default contract is
    // snapshot-then-write, so rollback re-reads the last snapshot through a
    // store-provided hook when available.
    if (!('readSnapshot' in this.store)) return false;
    const snapshot = await (
      this.store as PackageStore & { readSnapshot(): Promise<PluginLockfile | null> }
    ).readSnapshot();
    if (!snapshot) return false;
    await this.store.writeLockfile(snapshot);
    await this.record(
      'rollback',
      undefined,
      `restored snapshot with ${snapshot.plugins.length} plugins`,
    );
    return true;
  }

  /** Records a permission grant decision (audit + lockfile update). */
  async setGrant(pluginId: string, grant: PermissionGrant): Promise<void> {
    const state = await this.readState();
    const lock = state.lockfile;
    const entry = lock.plugins.find((candidate) => candidate.id === pluginId);
    if (!entry) {
      throw new PackageError(`plugin '${pluginId}' is not installed`, 'not-installed');
    }
    const permissions = [
      ...entry.permissions.filter((existing) => existing.permissionId !== grant.permissionId),
      grant,
    ];
    await this.write(
      {
        schema: 'logicpilot.plugin-lock/v1',
        contractVersion: 1,
        plugins: lock.plugins.map((candidate) =>
          candidate.id === pluginId ? { ...candidate, permissions } : candidate,
        ),
      },
      state.version,
    );
    await this.record(grant.granted ? 'grant' : 'deny', pluginId, grant.permissionId);
  }
}

/** Adapt a lock entry to the resolver input shape (version + provides). */
function toLockResolution(entry: PluginLockEntry): {
  id: string;
  version: string;
  provides: readonly string[];
  requires: readonly { id: string; range?: string; optional?: boolean }[];
} {
  return {
    id: entry.id,
    version: entry.version,
    // Lock entries do not carry `provides`; dependency ids reference plugin
    // ids, so each entry provides itself.
    provides: [entry.id],
    requires: entry.dependencies ?? [],
  };
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string): readonly number[] => {
    const parts = v.split('-')[0]?.split('.') ?? [];
    return [0, 1, 2].map((i) => Number.parseInt(parts[i] ?? '0', 10) || 0);
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function assertDependencyVersions(entries: readonly PluginLockEntry[], operation: string): void {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    for (const dependency of entry.dependencies ?? []) {
      const target = byId.get(dependency.id);
      if (!target) continue;
      if (!satisfiesRange(target.version, dependency.range)) {
        throw new PackageError(
          `${operation} leaves '${entry.id}' requiring ${dependency.id}@${dependency.range ?? '*'}, but ${target.version} is installed`,
          'dependency',
        );
      }
    }
  }
}

// Re-export for convenience so shells can validate manifests before install.
export { isRecord as isJsonObject };
