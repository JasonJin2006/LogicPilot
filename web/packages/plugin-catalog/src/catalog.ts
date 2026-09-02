// Read-only plugin catalog scanner (Phase 2B-1, ADR-0071). Walks configured
// plugin roots, strictly validates every plugin.json against the frozen
// PluginManifest v2 contract, computes the canonical content digest, and
// isolates corrupt packages as structured diagnostics - one broken package
// never blocks the others and never reaches the transactional host.
//
// The scanner is read-only: no writes, moves or deletes. Symbolic links are
// never followed and containment is enforced with realpath so a package can
// never escape its plugin root. Public diagnostics never contain filesystem
// paths or raw system error text (ADR-0071 §5): only root ids and
// root-relative package paths cross the bridge. All scan work is bounded
// (depth/file-count/size limits) so a malicious workspace package cannot
// stall the app-server event loop.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  isSupportedPluginApiVersion,
  resolveActivationOrder,
  toResolutionInput,
  validateContract,
} from '@logicpilot/contracts';
import type { PluginManifest } from '@logicpilot/contracts';
import type {
  PluginCatalog,
  PluginCatalogDiagnostic,
  PluginCatalogEntry,
  PluginCatalogRoot,
  PluginScope,
} from '@logicpilot/plugin-host';

export interface PluginRootConfig {
  readonly scope: PluginScope;
  /** Absolute path, or a path resolved against the scanner's cwd. */
  readonly path: string;
}

export interface PluginCatalogScanConfig {
  /** Roots per scope, in priority order (earlier roots win in-scope). */
  readonly roots: readonly PluginRootConfig[];
  /** plugin.json size guard (default 256 KiB). */
  readonly maxManifestBytes?: number;
  /** Maximum directory depth inside one package payload (default 16). */
  readonly maxPackageDepth?: number;
  /** Maximum number of regular files inside one package payload (default 5000). */
  readonly maxPackageFiles?: number;
  /** Maximum size of one non-manifest payload file (default 16 MiB). */
  readonly maxFileBytes?: number;
  /** Maximum total payload bytes of one package (default 64 MiB). */
  readonly maxPackageBytes?: number;
  /** Maximum directory entries in any single payload directory (default 100k). */
  readonly maxDirEntries?: number;
}

const DEFAULT_MAX_MANIFEST_BYTES = 256 * 1024;
const DEFAULT_MAX_PACKAGE_DEPTH = 16;
const DEFAULT_MAX_PACKAGE_FILES = 5000;
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_DIR_ENTRIES = 100_000;
const SCOPE_ORDER: readonly PluginScope[] = ['system', 'user', 'workspace'];

interface ScanLimits {
  readonly maxManifestBytes: number;
  readonly maxPackageDepth: number;
  readonly maxPackageFiles: number;
  readonly maxFileBytes: number;
  readonly maxPackageBytes: number;
  readonly maxDirEntries: number;
}

/** Thrown for package payloads that exceed the scan limits; the message is
 *  built from root-relative paths only and is safe to expose. */
class ScanLimitError extends Error {}

/** Scans every configured root and returns the frozen catalog envelope.
 *  Never throws for package-level defects; a broken root/package is a
 *  diagnostic. Throws only on programming errors in the config itself. */
export async function scanPluginCatalog(config: PluginCatalogScanConfig): Promise<PluginCatalog> {
  const limits: ScanLimits = {
    maxManifestBytes: config.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES,
    maxPackageDepth: config.maxPackageDepth ?? DEFAULT_MAX_PACKAGE_DEPTH,
    maxPackageFiles: config.maxPackageFiles ?? DEFAULT_MAX_PACKAGE_FILES,
    maxFileBytes: config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxPackageBytes: config.maxPackageBytes ?? DEFAULT_MAX_PACKAGE_BYTES,
    maxDirEntries: config.maxDirEntries ?? DEFAULT_MAX_DIR_ENTRIES,
  };
  const roots: PluginCatalogRoot[] = [];
  const diagnostics: PluginCatalogDiagnostic[] = [];
  const entries: PluginCatalogEntry[] = [];

  for (const scope of SCOPE_ORDER) {
    const scopeRoots = config.roots.filter((root) => root.scope === scope);
    for (const [index, rootConfig] of scopeRoots.entries()) {
      const rootId = `${scope}:${index + 1}`;
      roots.push({ id: rootId, scope });
      scanRoot(rootConfig, rootId, limits, entries, diagnostics);
    }
  }

  appendDependencyDiagnostics(entries, diagnostics);
  return {
    schema: 'logicpilot.plugin-catalog/v1',
    contractVersion: 1,
    roots,
    entries,
    diagnostics,
  };
}

function scanRoot(
  rootConfig: PluginRootConfig,
  rootId: string,
  limits: ScanLimits,
  entries: PluginCatalogEntry[],
  diagnostics: PluginCatalogDiagnostic[],
): void {
  const rootAbs = resolve(rootConfig.path);
  let realRoot: string;
  try {
    if (!existsSync(rootAbs)) {
      diagnostics.push({
        severity: 'warning',
        kind: 'filesystem',
        message: `plugin root '${rootId}' does not exist`,
        scope: rootConfig.scope,
        rootId,
      });
      return;
    }
    realRoot = realpathSync(rootAbs);
  } catch {
    // Realpath errors leak filesystem paths; keep them server-side.
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `cannot resolve plugin root '${rootId}'`,
      scope: rootConfig.scope,
      rootId,
    });
    return;
  }

  let dirEntries;
  try {
    dirEntries = readdirSync(realRoot, { withFileTypes: true });
  } catch {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `cannot read plugin root '${rootId}'`,
      scope: rootConfig.scope,
      rootId,
    });
    return;
  }
  dirEntries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  for (const dirEntry of dirEntries) {
    if (dirEntry.isSymbolicLink()) {
      // Never follow a linked package directory. Distinguish a link that would
      // escape the root (error) from one that stays inside (warning): both are
      // excluded, so containment here is informational.
      let escaped = false;
      try {
        const target = realpathSync(join(realRoot, dirEntry.name));
        const containment = relative(realRoot, target);
        escaped = containment.startsWith('..') || isAbsolute(containment);
      } catch {
        // Dangling link: excluded like any other linked directory.
      }
      diagnostics.push({
        severity: escaped ? 'error' : 'warning',
        kind: 'filesystem',
        message: escaped
          ? `package directory '${dirEntry.name}' is a symbolic link that escapes plugin root '${rootId}' and is excluded`
          : `package directory '${dirEntry.name}' is a symbolic link and is excluded from the catalog`,
        scope: rootConfig.scope,
        rootId,
        path: dirEntry.name,
      });
      continue;
    }
    if (!dirEntry.isDirectory()) continue;
    if (dirEntry.name.includes('/') || dirEntry.name.includes('\\')) {
      diagnostics.push({
        severity: 'error',
        kind: 'filesystem',
        message: `package directory name '${dirEntry.name}' contains a path separator and is excluded`,
        scope: rootConfig.scope,
        rootId,
        path: dirEntry.name,
      });
      continue;
    }
    scanPackage(
      join(realRoot, dirEntry.name),
      dirEntry.name,
      rootConfig.scope,
      rootId,
      realRoot,
      limits,
      entries,
      diagnostics,
    );
  }
}

function scanPackage(
  packageDir: string,
  relPath: string,
  scope: PluginScope,
  rootId: string,
  realRoot: string,
  limits: ScanLimits,
  entries: PluginCatalogEntry[],
  diagnostics: PluginCatalogDiagnostic[],
): void {
  let realPackage: string;
  try {
    realPackage = realpathSync(packageDir);
  } catch {
    // Also covers a dangling symlink that lstat classified as a directory.
    return;
  }
  const containment = relative(realRoot, realPackage);
  if (containment === '' || containment.startsWith('..') || isAbsolute(containment)) {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `package '${relPath}' escapes plugin root '${rootId}' and is excluded`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }

  const manifestPath = join(realPackage, 'plugin.json');
  let manifestStat;
  try {
    manifestStat = lstatSync(manifestPath);
  } catch {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `package '${relPath}' has no readable plugin.json`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }
  if (manifestStat.isSymbolicLink()) {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `package '${relPath}' has a symbolic-link plugin.json and is excluded`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }
  if (!manifestStat.isFile()) {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `package '${relPath}': plugin.json is not a regular file`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }
  if (manifestStat.size > limits.maxManifestBytes) {
    diagnostics.push({
      severity: 'error',
      kind: 'schema',
      message: `package '${relPath}': plugin.json exceeds ${limits.maxManifestBytes} bytes`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `package '${relPath}': cannot read plugin.json`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // JSON.parse errors carry no filesystem paths.
    diagnostics.push({
      severity: 'error',
      kind: 'json',
      message: `package '${relPath}': plugin.json is not valid JSON: ${(error as Error).message}`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }
  const validated = validateContract('PluginManifest', parsed);
  if (!validated.ok) {
    diagnostics.push({
      severity: 'error',
      kind: 'schema',
      message: `package '${relPath}': plugin.json is not a valid PluginManifest v2: ${validated.errors.join('; ')}`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }
  const manifest = validated.value;

  if (!isSupportedPluginApiVersion(manifest.apiVersion)) {
    // Advisory only: the host keeps the final gate (ADR-0070 §7) and skips
    // the plugin at discovery. The package stays listed so the audit trail
    // explains why it is not active.
    diagnostics.push({
      severity: 'warning',
      kind: 'api-version',
      message: `package '${relPath}' targets apiVersion ${manifest.apiVersion}, which this host does not support`,
      scope,
      rootId,
      path: relPath,
      pluginId: manifest.id,
    });
  }

  let sha256: string;
  try {
    sha256 = payloadDigest(realPackage, manifest, limits);
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message:
        error instanceof ScanLimitError
          ? error.message
          : `package '${relPath}': cannot compute payload digest`,
      scope,
      rootId,
      path: relPath,
      pluginId: manifest.id,
    });
    return;
  }
  const declared = manifest.integrity?.sha256;
  // Sha256Hex accepts lowercase or uppercase; the computed digest is canonical
  // lowercase, so compare case-insensitively (an equivalent uppercase
  // declaration is NOT drift).
  if (declared !== undefined && declared.toLowerCase() !== sha256) {
    diagnostics.push({
      severity: 'error',
      kind: 'hash-drift',
      message: `package '${relPath}': declared integrity ${declared} does not match computed payload digest ${sha256}`,
      scope,
      rootId,
      path: relPath,
      pluginId: manifest.id,
    });
    return;
  }

  if (entriesHasId(entries, scope, manifest.id)) {
    diagnostics.push({
      severity: 'error',
      kind: 'duplicate-id',
      message: `duplicate plugin id '${manifest.id}' within scope '${scope}' (kept the earlier occurrence in root '${rootId}')`,
      scope,
      rootId,
      path: relPath,
      pluginId: manifest.id,
    });
    return;
  }
  entries.push({ id: manifest.id, scope, rootId, path: relPath, sha256, manifest });
}

function entriesHasId(
  entries: readonly PluginCatalogEntry[],
  scope: PluginScope,
  id: string,
): boolean {
  return entries.some((entry) => entry.scope === scope && entry.id === id);
}

// ---------------------------------------------------------------------------
// Canonical payload digest (ADR-0071 §4): BINDS the manifest to the payload.
// Input: the canonical (key-sorted) manifest with its `integrity` field
// removed, then every regular file under the package except plugin.json,
// sorted by posix relative path. Framing: "<len(bytes)>:<bytes>" per part,
// lengths in bytes, sha256 hex. Removing integrity avoids the self-reference
// fixpoint while covering ALL manifest semantics (permissions, entrypoints,
// version, trust, ...). Symlinks are never followed and never hashed.
// ---------------------------------------------------------------------------

function payloadDigest(packageDir: string, manifest: PluginManifest, limits: ScanLimits): string {
  const hash = createHash('sha256');
  const canonicalManifest = canonicalJson(omitIntegrity(manifest));
  const manifestBytes = Buffer.from(canonicalManifest, 'utf8');
  hash.update(String(manifestBytes.length));
  hash.update(':');
  hash.update(manifestBytes);

  for (const file of collectPackageFiles(packageDir, limits)) {
    if (file.rel === 'plugin.json') continue;
    const content = readFileSync(file.absolute);
    const relBytes = Buffer.from(file.rel, 'utf8');
    hash.update(String(relBytes.length));
    hash.update(':');
    hash.update(relBytes);
    hash.update(String(content.length));
    hash.update(':');
    hash.update(content);
  }
  return hash.digest('hex');
}

function omitIntegrity(manifest: PluginManifest): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(manifest as unknown as Record<string, unknown>) };
  delete copy.integrity;
  return copy;
}

/** Deterministic byte-order JSON: object keys sorted recursively. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Collects package payload files while enforcing every size/count limit
 *  DURING the traversal - a huge tree trips the bound immediately instead of
 *  after the full recursive list has been built in memory. */
function collectPackageFiles(
  packageDir: string,
  limits: ScanLimits,
): { rel: string; absolute: string; size: number }[] {
  const budget = { count: 0, bytes: 0 };
  return walkPackageFiles(packageDir, '', 1, limits, budget);
}

function walkPackageFiles(
  directory: string,
  prefix: string,
  depth: number,
  limits: ScanLimits,
  budget: { count: number; bytes: number },
): { rel: string; absolute: string; size: number }[] {
  if (depth > limits.maxPackageDepth) {
    throw new ScanLimitError(`package payload exceeds directory depth ${limits.maxPackageDepth}`);
  }
  const files: { rel: string; absolute: string; size: number }[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.length > limits.maxDirEntries) {
    throw new ScanLimitError(`package directory exceeds ${limits.maxDirEntries} entries`);
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      files.push(...walkPackageFiles(absolute, rel, depth + 1, limits, budget));
    } else if (stat.isFile()) {
      budget.count += 1;
      if (budget.count > limits.maxPackageFiles) {
        throw new ScanLimitError(`package payload has more than ${limits.maxPackageFiles} files`);
      }
      if (stat.size > limits.maxFileBytes) {
        throw new ScanLimitError(
          `package payload file '${rel}' exceeds ${limits.maxFileBytes} bytes`,
        );
      }
      budget.bytes += stat.size;
      if (budget.bytes > limits.maxPackageBytes) {
        throw new ScanLimitError(`package payload exceeds ${limits.maxPackageBytes} bytes`);
      }
      files.push({ rel, absolute, size: stat.size });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Dependency diagnostics over the effective overlay (later scope wins by id).
// Advisory for the catalog; the activation-safe projection (plugin-host) is
// the authority that keeps the host transactional.
// ---------------------------------------------------------------------------

function appendDependencyDiagnostics(
  entries: readonly PluginCatalogEntry[],
  diagnostics: PluginCatalogDiagnostic[],
): void {
  const overlay = new Map<string, PluginCatalogEntry>();
  for (const entry of entries) overlay.set(entry.id, entry);
  const resolution = resolveActivationOrder(
    [...overlay.values()].map((entry) => toResolutionInput(entry.manifest)),
  );
  if (resolution.ok) return;
  for (const missing of resolution.missing) {
    diagnostics.push({
      severity: 'error',
      kind: 'dependency',
      message: `missing dependency: ${missing}`,
      ...contextOf(overlay, missing.split(' -> ')[0] ?? undefined),
    });
  }
  for (const cycle of resolution.cycles) {
    diagnostics.push({
      severity: 'error',
      kind: 'dependency',
      message: `dependency cycle: ${cycle}`,
      ...contextOf(overlay, cycle.split(' -> ')[0] ?? undefined),
    });
  }
}

function contextOf(
  overlay: ReadonlyMap<string, PluginCatalogEntry>,
  id: string | undefined,
): {
  pluginId?: string;
  scope?: PluginScope;
  rootId?: string;
  path?: string;
} {
  const entry = id === undefined ? undefined : overlay.get(id);
  if (!entry) return {};
  return { pluginId: entry.id, scope: entry.scope, rootId: entry.rootId, path: entry.path };
}
