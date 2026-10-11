import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computePackageDigest,
  FileSystemPackageStore,
} from '../web/packages/plugin-catalog/dist/index.bundle.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const families = ['process', 'devs', 'continuous', 'agent', 'generic'];

/** Build explicitly trusted system packages. This is a release operation, not
 * a general installer: never auto-grant newly added manifest permissions. */
export function buildRuntimePlugins(destination, storeRoot) {
  const rel = relative(join(repository, 'build'), resolve(destination));
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('runtime output must be under build/');
  const plugins = families.map((family) => {
    const manifest = JSON.parse(
      readFileSync(join(repository, 'plugins/runtime', family, 'plugin.json'), 'utf8'),
    );
    if (
      manifest.id !== `logicpilot.runtime.${family}` ||
      manifest.permissions.length !== 1 ||
      manifest.permissions[0] !== 'runtime.service.call' ||
      manifest.trust.minLevel !== 't4'
    )
      throw new Error('system runtime manifest changed its release authority');
    const packageDir = join(destination, family);
    mkdirSync(packageDir, { recursive: true });
    copyFileSync(
      join(repository, 'plugins/runtime/entrypoint.mjs'),
      join(packageDir, 'runtime.mjs'),
    );
    writeFileSync(join(packageDir, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return {
      id: manifest.id,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      sha256: computePackageDigest(packageDir, manifest),
      source: 'system',
      trust: 't4',
      permissions: [{ permissionId: 'runtime.service.call', granted: true }],
      dependencies: manifest.requires,
    };
  });
  if (storeRoot)
    new FileSystemPackageStore({ rootDir: storeRoot }).writeLockfile({
      schema: 'logicpilot.plugin-lock/v1',
      contractVersion: 1,
      plugins,
    });
  return plugins;
}
