// Read-only plugin catalog scanner (Phase 2B-1, ADR-0071). Walks configured
// plugin roots, strictly validates every plugin.json against the frozen
// PluginManifest v2 contract, computes the canonical payload digest, and
// isolates corrupt packages as structured diagnostics - one broken package
// never blocks the others and never reaches the transactional host.
//
// The scanner is read-only: no writes, moves or deletes. Symbolic links are
// never followed and containment is enforced with realpath so a package can
// never escape its plugin root.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  isSupportedPluginApiVersion,
  resolveActivationOrder,
  toResolutionInput,
  validateContract,
} from '@logicpilot/contracts';
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
}

const DEFAULT_MAX_MANIFEST_BYTES = 256 * 1024;
const SCOPE_ORDER: readonly PluginScope[] = ['system', 'user', 'workspace'];

/** Scans every configured root and returns the contract-shaped catalog.
 *  Never throws for package-level defects; a broken root/package is a
 *  diagnostic. Throws only on programming errors in the config itself. */
export async function scanPluginCatalog(config: PluginCatalogScanConfig): Promise<PluginCatalog> {
  const maxManifestBytes = config.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES;
  const roots: PluginCatalogRoot[] = [];
  const diagnostics: PluginCatalogDiagnostic[] = [];
  const entries: PluginCatalogEntry[] = [];

  for (const scope of SCOPE_ORDER) {
    const scopeRoots = config.roots.filter((root) => root.scope === scope);
    for (const [index, rootConfig] of scopeRoots.entries()) {
      const rootId = `${scope}:${index + 1}`;
      roots.push({ id: rootId, scope });
      scanRoot(rootConfig, rootId, maxManifestBytes, entries, diagnostics);
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
  maxManifestBytes: number,
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
        message: `plugin root '${rootId}' does not exist at '${rootAbs}'`,
        scope: rootConfig.scope,
        rootId,
      });
      return;
    }
    realRoot = realpathSync(rootAbs);
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `cannot resolve plugin root '${rootId}': ${(error as Error).message}`,
      scope: rootConfig.scope,
      rootId,
    });
    return;
  }

  let dirEntries;
  try {
    dirEntries = readdirSync(realRoot, { withFileTypes: true });
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `cannot read plugin root '${rootId}': ${(error as Error).message}`,
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
      maxManifestBytes,
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
  maxManifestBytes: number,
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
      message: `package '${relPath}' escapes plugin root '${rootId}' (target: '${realPackage}') and is excluded`,
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
  if (manifestStat.size > maxManifestBytes) {
    diagnostics.push({
      severity: 'error',
      kind: 'schema',
      message: `package '${relPath}': plugin.json exceeds ${maxManifestBytes} bytes`,
      scope,
      rootId,
      path: relPath,
    });
    return;
  }

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `package '${relPath}': cannot read plugin.json: ${(error as Error).message}`,
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
    sha256 = payloadDigest(realPackage);
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      kind: 'filesystem',
      message: `package '${relPath}': cannot compute payload digest: ${(error as Error).message}`,
      scope,
      rootId,
      path: relPath,
      pluginId: manifest.id,
    });
    return;
  }
  const declared = manifest.integrity?.sha256;
  if (declared !== undefined && declared !== sha256) {
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
// Canonical payload digest (ADR-0071 §4): every regular file under the
// package except plugin.json, sorted by posix relative path, framed as
// "<len(path)>:<path><len(content)>:<content>" (lengths in bytes), sha256 hex.
// Symlinks are never followed and never hashed.
// ---------------------------------------------------------------------------

function payloadDigest(packageDir: string): string {
  const hash = createHash('sha256');
  for (const file of walkPackageFiles(packageDir)) {
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

function walkPackageFiles(directory: string, prefix = ''): { rel: string; absolute: string }[] {
  const files: { rel: string; absolute: string }[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      files.push(...walkPackageFiles(absolute, rel));
    } else if (stat.isFile()) {
      files.push({ rel, absolute });
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
