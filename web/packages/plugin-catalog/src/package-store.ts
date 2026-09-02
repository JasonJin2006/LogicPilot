// File-system PackageStore implementation (Phase 2B-2). This module is
// Node-only: the browser receives catalog data through the bridge and never
// receives a filesystem handle.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AuditEntry, PackageStore } from '@logicpilot/plugin-host';
import type { PluginLockfile, PluginManifest } from '@logicpilot/contracts';
import { validateContract } from '@logicpilot/contracts';
import { computePackageDigest } from './catalog.js';

export interface FileSystemPackageStoreOptions {
  /** Dedicated directory containing lockfile, snapshots and audit data. */
  readonly rootDir: string;
  readonly lockfileName?: string;
  readonly snapshotName?: string;
  readonly auditName?: string;
  readonly packagesDirName?: string;
  readonly stagingDirName?: string;
}

export class FileSystemPackageStoreError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid-lockfile' | 'conflict' | 'path' | 'io',
  ) {
    super(message);
    this.name = 'FileSystemPackageStoreError';
  }
}

let tempSequence = 0;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSafeName(name: string): boolean {
  return (
    name.length > 0 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
  );
}

/** A lockfile-backed store with crash-recoverable atomic replacement. */
export class FileSystemPackageStore implements PackageStore {
  private readonly rootDir: string;
  private readonly lockfilePath: string;
  private readonly snapshotPath: string;
  private readonly auditPath: string;
  private readonly mutexPath: string;
  private readonly packagesDir: string;
  private readonly stagingDir: string;

  constructor(options: FileSystemPackageStoreOptions) {
    this.rootDir = resolve(options.rootDir);
    const lockfileName = options.lockfileName ?? 'logicpilot.lock';
    const snapshotName = options.snapshotName ?? 'logicpilot.lock.snapshot';
    const auditName = options.auditName ?? 'plugin-audit.jsonl';
    const packagesDirName = options.packagesDirName ?? 'plugins';
    const stagingDirName = options.stagingDirName ?? '.plugin-staging';
    const names = [lockfileName, snapshotName, auditName, packagesDirName, stagingDirName];
    if (!names.every(isSafeName) || new Set(names).size !== names.length) {
      throw new FileSystemPackageStoreError('store filenames must be simple child names', 'path');
    }
    this.lockfilePath = join(this.rootDir, lockfileName);
    this.snapshotPath = join(this.rootDir, snapshotName);
    this.auditPath = join(this.rootDir, auditName);
    this.mutexPath = join(this.rootDir, `${lockfileName}.mutex`);
    this.packagesDir = join(this.rootDir, packagesDirName);
    this.stagingDir = join(this.rootDir, stagingDirName);
  }

  readLockfile(): PluginLockfile | null {
    return this.readLockfileState().lockfile;
  }

  readLockfileState(): {
    readonly lockfile: PluginLockfile | null;
    readonly version: string | null;
  } {
    if (!existsSync(this.lockfilePath)) return { lockfile: null, version: null };
    const raw = this.readText(this.lockfilePath, 'lockfile');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new FileSystemPackageStoreError('lockfile is not valid JSON', 'invalid-lockfile');
    }
    const validated = validateContract('PluginLockfile', parsed);
    if (!validated.ok) {
      throw new FileSystemPackageStoreError(
        `lockfile does not satisfy its contract: ${validated.errors.join('; ')}`,
        'invalid-lockfile',
      );
    }
    return { lockfile: validated.value, version: hashText(stableJson(validated.value)) };
  }

  writeLockfile(lockfile: PluginLockfile): void {
    this.writeValidatedLockfile(lockfile);
  }

  readLockfileVersion(): string | null {
    return this.readLockfileState().version;
  }

  writeLockfileIfVersion(lockfile: PluginLockfile, expectedVersion: string | null): void {
    this.ensureRoot();
    try {
      writeFileSync(this.mutexPath, '', { encoding: 'utf8', flag: 'wx' });
    } catch {
      throw new FileSystemPackageStoreError(
        'lockfile is being written by another process',
        'conflict',
      );
    }
    try {
      const currentVersion = this.readLockfileVersion();
      if (currentVersion !== expectedVersion) {
        throw new FileSystemPackageStoreError(
          `lockfile changed concurrently (expected ${expectedVersion ?? 'empty'}, found ${currentVersion ?? 'empty'})`,
          'conflict',
        );
      }
      this.writeValidatedLockfile(lockfile);
    } finally {
      if (existsSync(this.mutexPath)) unlinkSync(this.mutexPath);
    }
  }

  snapshotLockfile(): void {
    if (!existsSync(this.lockfilePath)) {
      if (existsSync(this.snapshotPath)) unlinkSync(this.snapshotPath);
      return;
    }
    this.ensureRoot();
    this.atomicWrite(this.snapshotPath, this.readText(this.lockfilePath, 'lockfile snapshot'));
  }

  readSnapshot(): PluginLockfile | null {
    if (!existsSync(this.snapshotPath)) return null;
    const raw = this.readText(this.snapshotPath, 'lockfile snapshot');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new FileSystemPackageStoreError(
        'lockfile snapshot is not valid JSON',
        'invalid-lockfile',
      );
    }
    const validated = validateContract('PluginLockfile', parsed);
    if (!validated.ok) {
      throw new FileSystemPackageStoreError(
        `lockfile snapshot does not satisfy its contract: ${validated.errors.join('; ')}`,
        'invalid-lockfile',
      );
    }
    return validated.value;
  }

  /** Append only sanitized host audit records; the store never accepts raw paths. */
  appendAudit(entry: AuditEntry): void {
    const safe: AuditEntry = {
      seq: entry.seq,
      timestamp: entry.timestamp,
      action: entry.action,
      ...(entry.pluginId === undefined ? {} : { pluginId: entry.pluginId }),
      ...(entry.detail === undefined ? {} : { detail: entry.detail.slice(0, 512) }),
    };
    this.ensureRoot();
    appendFileSync(this.auditPath, `${JSON.stringify(safe)}\n`, 'utf8');
  }

  readAudit(maxBytes = 1 * 1024 * 1024): readonly AuditEntry[] {
    if (!existsSync(this.auditPath)) return [];
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new FileSystemPackageStoreError('maxBytes must be a positive integer', 'path');
    }
    if (statSync(this.auditPath).size > maxBytes) {
      throw new FileSystemPackageStoreError('audit log exceeds the read limit', 'io');
    }
    const raw = this.readText(this.auditPath, 'audit log');
    const entries: AuditEntry[] = [];
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (line.trim() === '') continue;
      try {
        const parsed = JSON.parse(line) as AuditEntry;
        if (!Number.isSafeInteger(parsed.seq) || typeof parsed.timestamp !== 'string')
          throw new Error('invalid audit shape');
        entries.push(parsed);
      } catch {
        throw new FileSystemPackageStoreError(`audit line ${index + 1} is invalid`, 'io');
      }
    }
    return entries;
  }

  /** Copies a package into an isolated staging directory after validating its
   * manifest and recomputing the canonical bounded payload digest. */
  stagePackage(input: {
    readonly pluginId: string;
    readonly sourcePath: string;
    readonly manifest: PluginManifest;
    readonly sha256: string;
    readonly operation: 'install' | 'upgrade';
  }): { readonly pluginId: string; readonly stagePath: string; readonly targetPath: string } {
    if (!isSafeName(input.pluginId)) {
      throw new FileSystemPackageStoreError('plugin id is not a safe package name', 'path');
    }
    if (!/^[0-9a-f]{64}$/i.test(input.sha256)) {
      throw new FileSystemPackageStoreError('package digest is not a SHA-256 value', 'path');
    }
    const source = resolve(input.sourcePath);
    let sourceReal: string;
    try {
      sourceReal = realpathSync(source);
      if (!lstatSync(sourceReal).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new FileSystemPackageStoreError('package source is not a readable directory', 'io');
    }
    const manifestPath = join(sourceReal, 'plugin.json');
    try {
      if (statSync(manifestPath).size > 256 * 1024) {
        throw new Error('manifest too large');
      }
    } catch {
      throw new FileSystemPackageStoreError('package source has no readable plugin.json', 'io');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      throw new FileSystemPackageStoreError('package source has no valid plugin.json', 'io');
    }
    const validated = validateContract('PluginManifest', parsed);
    if (!validated.ok || validated.value.id !== input.pluginId) {
      throw new FileSystemPackageStoreError(
        'package manifest does not match requested plugin',
        'path',
      );
    }
    if (stableJson(validated.value) !== stableJson(input.manifest)) {
      throw new FileSystemPackageStoreError(
        'package manifest differs from requested manifest',
        'path',
      );
    }
    let digest: string;
    try {
      digest = computePackageDigest(sourceReal, validated.value);
    } catch {
      throw new FileSystemPackageStoreError('package payload cannot be scanned', 'io');
    }
    if (digest !== input.sha256.toLowerCase()) {
      throw new FileSystemPackageStoreError(
        'package payload digest does not match lock entry',
        'path',
      );
    }

    this.ensureRoot();
    mkdirSync(this.stagingDir, { recursive: true });
    const stagePath = join(
      this.stagingDir,
      `${input.pluginId}.${process.pid}.${Date.now()}.${++tempSequence}`,
    );
    try {
      copyTree(sourceReal, stagePath);
    } catch {
      if (existsSync(stagePath)) removeTree(stagePath);
      throw new FileSystemPackageStoreError('cannot stage package payload', 'io');
    }
    return {
      pluginId: input.pluginId,
      stagePath,
      targetPath: join(this.packagesDir, input.pluginId),
    };
  }

  /** Atomically swaps a staged tree into the controlled package directory and
   * retains the previous tree until finalize/rollback. */
  commitPackage(stage: {
    readonly pluginId: string;
    readonly stagePath: string;
    readonly targetPath: string;
  }): { readonly pluginId: string; readonly targetPath: string; readonly backupPath?: string } {
    if (
      !isPathWithin(this.stagingDir, stage.stagePath) ||
      !isPathWithin(this.packagesDir, stage.targetPath)
    ) {
      throw new FileSystemPackageStoreError('package transaction path escapes store', 'path');
    }
    mkdirSync(this.packagesDir, { recursive: true });
    const backupPath = join(
      this.stagingDir,
      `${stage.pluginId}.backup.${process.pid}.${Date.now()}`,
    );
    try {
      if (existsSync(stage.targetPath)) renameSync(stage.targetPath, backupPath);
      renameSync(stage.stagePath, stage.targetPath);
    } catch {
      if (!existsSync(stage.targetPath) && existsSync(backupPath))
        renameSync(backupPath, stage.targetPath);
      if (existsSync(stage.stagePath)) removeTree(stage.stagePath);
      throw new FileSystemPackageStoreError('cannot commit package transaction', 'io');
    }
    return {
      pluginId: stage.pluginId,
      targetPath: stage.targetPath,
      ...(existsSync(backupPath) ? { backupPath } : {}),
    };
  }

  /** Moves an installed tree to a rollback-safe tombstone. */
  prepareRemovePackage(pluginId: string): {
    readonly pluginId: string;
    readonly targetPath: string;
    readonly backupPath?: string;
  } {
    if (!isSafeName(pluginId)) {
      throw new FileSystemPackageStoreError('plugin id is not a safe package name', 'path');
    }
    const targetPath = join(this.packagesDir, pluginId);
    if (!existsSync(targetPath)) return { pluginId, targetPath };
    mkdirSync(this.stagingDir, { recursive: true });
    const backupPath = join(this.stagingDir, `${pluginId}.remove.${process.pid}.${Date.now()}`);
    try {
      renameSync(targetPath, backupPath);
    } catch {
      throw new FileSystemPackageStoreError('cannot stage package removal', 'io');
    }
    return { pluginId, targetPath, backupPath };
  }

  finalizePackage(commit: { readonly targetPath: string; readonly backupPath?: string }): void {
    if (commit.backupPath && existsSync(commit.backupPath)) removeTree(commit.backupPath);
  }

  rollbackPackage(commit: { readonly targetPath: string; readonly backupPath?: string }): void {
    if (existsSync(commit.targetPath)) removeTree(commit.targetPath);
    if (commit.backupPath && existsSync(commit.backupPath)) {
      mkdirSync(resolve(commit.targetPath, '..'), { recursive: true });
      renameSync(commit.backupPath, commit.targetPath);
    }
  }

  listInstalledPackages(): readonly string[] {
    if (!existsSync(this.packagesDir)) return [];
    return readdirSync(this.packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  }

  private writeValidatedLockfile(lockfile: PluginLockfile): void {
    const validated = validateContract('PluginLockfile', lockfile);
    if (!validated.ok) {
      throw new FileSystemPackageStoreError(
        `lockfile does not satisfy its contract: ${validated.errors.join('; ')}`,
        'invalid-lockfile',
      );
    }
    this.ensureRoot();
    this.atomicWrite(this.lockfilePath, `${JSON.stringify(validated.value, null, 2)}\n`);
  }

  private ensureRoot(): void {
    mkdirSync(this.rootDir, { recursive: true });
  }

  private readText(path: string, label: string): string {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      throw new FileSystemPackageStoreError(`cannot read ${label}`, 'io');
    }
  }

  private atomicWrite(path: string, text: string): void {
    const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${++tempSequence}`;
    const backup = `${path}.bak`;
    try {
      writeFileSync(temporary, text, 'utf8');
      try {
        renameSync(temporary, path);
      } catch {
        // Windows cannot rename over an existing destination. Keep a backup
        // while replacing it and restore the backup if the second rename fails.
        if (existsSync(path)) renameSync(path, backup);
        try {
          renameSync(temporary, path);
          if (existsSync(backup)) unlinkSync(backup);
        } catch (error) {
          if (!existsSync(path) && existsSync(backup)) renameSync(backup, path);
          throw error;
        }
      }
    } catch {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw new FileSystemPackageStoreError('cannot atomically write store file', 'io');
    }
  }
}

export function isPathWithin(rootDir: string, candidate: string): boolean {
  const relativePath = relative(resolve(rootDir), resolve(candidate));
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function copyTree(source: string, target: string): void {
  const sourceStat = lstatSync(source);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error('package tree contains a non-directory root');
  }
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error('symbolic links are not allowed in packages');
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
    } else {
      throw new Error('unsupported package filesystem entry');
    }
  }
}

function removeTree(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || stat.isFile()) {
    unlinkSync(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    removeTree(join(path, entry.name));
  }
  // Directory is empty after children have been removed. unlinkSync is not
  // valid for directories in Node, so use the small rmdir shim below.
  rmdirSync(path);
}
