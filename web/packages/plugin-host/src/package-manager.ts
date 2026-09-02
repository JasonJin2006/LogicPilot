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
import type { AuditLog } from './host.js';
import {
  isSupportedPluginApiVersion,
  resolveActivationOrder,
  satisfiesRange,
  validateContract,
} from '@logicpilot/contracts';

export interface PackageStore {
  /** Read the whole lockfile, or null when absent. */
  readLockfile(): PluginLockfile | null | Promise<PluginLockfile | null>;
  writeLockfile(lockfile: PluginLockfile): void | Promise<void>;
  /** Optional rollback snapshot kept by the store itself. */
  snapshotLockfile?(): void | Promise<void>;
}

export interface InstallInput {
  /** Raw manifest JSON as found in the package's plugin.json. */
  readonly manifestJson: unknown;
  /** Content digest of the package payload (sha256 hex). Required unless the
   *  manifest already carries integrity information. */
  readonly sha256?: string;
  readonly source?: string;
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
      | 'integrity-missing',
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
    return (
      (await this.store.readLockfile()) ?? {
        schema: 'logicpilot.plugin-lock/v1',
        contractVersion: 1,
        plugins: [],
      }
    );
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
    const lock = await this.lockfile();

    if (lock.plugins.some((entry) => entry.id === manifest.id)) {
      throw new PackageError(`plugin '${manifest.id}' is already installed`, 'already-installed');
    }
    if (!isSupportedPluginApiVersion(manifest.apiVersion)) {
      this.audit.append(
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

    await this.store.writeLockfile({
      schema: 'logicpilot.plugin-lock/v1',
      contractVersion: 1,
      plugins: [...lock.plugins, projected].sort((a, b) => (a.id < b.id ? -1 : 1)),
    });
    this.audit.append('install', manifest.id, `version=${manifest.version}`);
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
    const lock = await this.lockfile();
    const current = lock.plugins.find((entry) => entry.id === manifest.id);
    if (!current) {
      throw new PackageError(`plugin '${manifest.id}' is not installed`, 'not-installed');
    }
    if (!isSupportedPluginApiVersion(manifest.apiVersion)) {
      this.audit.append(
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
    await this.store.writeLockfile({
      schema: 'logicpilot.plugin-lock/v1',
      contractVersion: 1,
      plugins: [next, ...others].sort((a, b) => (a.id < b.id ? -1 : 1)),
    });
    this.audit.append('upgrade', manifest.id, `${current.version} -> ${manifest.version}`);
    return next;
  }

  async uninstall(pluginId: string): Promise<void> {
    const lock = await this.lockfile();
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
    await this.store.writeLockfile({
      schema: 'logicpilot.plugin-lock/v1',
      contractVersion: 1,
      plugins: lock.plugins.filter((entry) => entry.id !== pluginId),
    });
    this.audit.append('uninstall', pluginId, `version=${current.version}`);
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
    this.audit.append(
      'rollback',
      undefined,
      `restored snapshot with ${snapshot.plugins.length} plugins`,
    );
    return true;
  }

  /** Records a permission grant decision (audit + lockfile update). */
  async setGrant(pluginId: string, grant: PermissionGrant): Promise<void> {
    const lock = await this.lockfile();
    const entry = lock.plugins.find((candidate) => candidate.id === pluginId);
    if (!entry) {
      throw new PackageError(`plugin '${pluginId}' is not installed`, 'not-installed');
    }
    const permissions = [
      ...entry.permissions.filter((existing) => existing.permissionId !== grant.permissionId),
      grant,
    ];
    await this.store.writeLockfile({
      schema: 'logicpilot.plugin-lock/v1',
      contractVersion: 1,
      plugins: lock.plugins.map((candidate) =>
        candidate.id === pluginId ? { ...candidate, permissions } : candidate,
      ),
    });
    this.audit.append(grant.granted ? 'grant' : 'deny', pluginId, grant.permissionId);
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
